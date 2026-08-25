import { SerialBridge } from './SerialBridge.js';
import { TerminalBridge } from './TerminalBridge.js';
import { MachineStateStore } from './MachineStateStore.js';

const IMAGE_VERSION = 'alpine-3.24.1-x86-native-terminal-v12';
const SNAPSHOT_SCHEMA_VERSION = 2;
const V86_STATE_FORMAT_VERSION = 'v86-state-v6-future-uart3-v1';
const V86_ASSET_VERSION = 'b80fba71-abd51298';
const MACHINE_CONFIGURATION_VERSION = 'virtio-9p-net-uart0-3-no-speaker-v1';

class MachineRestoreError extends Error {
  constructor(message, cause, code = 'SNAPSHOT_RESTORE_FAILED') {
    super(message, { cause });
    this.name = 'MachineRestoreError';
    this.code = code;
    this.technicalDetails = cause?.stack || cause?.message || String(cause || 'Unknown v86 restore failure');
  }
}

export class V86Machine {
  constructor(settings) {
    this.settings = settings;
    this.emulator = null;
    this.status = 'stopped';
    this.startedAt = 0;
    this.serial = null;
    this.terminals = new Map();
    this.terminalResets = new Map();
    this.controlConsole = 1;
    this.stateStore = new MachineStateStore();
    this.guestReady = false;
    this.saving = false;
    this.lastBootLabel = null;
    this.lastConsoleSignature = '';
    this.restoreOverride = null;
  }

  get profile() { return `${IMAGE_VERSION}-${this.settings.get('memory')}mb`; }
  get snapshotMetadata() { return {schema:SNAPSHOT_SCHEMA_VERSION,stateFormat:V86_STATE_FORMAT_VERSION,assets:V86_ASSET_VERSION,machine:MACHINE_CONFIGURATION_VERSION,image:IMAGE_VERSION,memory:this.settings.get('memory')}; }

  async start() {
    if (this.emulator) return;
    this.bootProgress = 0;
    this.#bootStage('checkingSystem', 3, 'checking');
    this.#setStatus('booting');
    let loadingProgress=3;
    const loadingPulse=setInterval(()=>this.#bootStage('checkingSystem',Math.min(17,++loadingProgress),'checking'),700);
    let V86,snapshotRecord;
    const snapshotLoad=(this.restoreOverride?Promise.resolve(this.restoreOverride):this.stateStore.load(this.profile)).catch(error=>{throw new MachineRestoreError('The saved virtual computer state could not be read. Your saved state has not been erased.',error,'SNAPSHOT_READ_FAILED')});this.restoreOverride=null;
    try{[V86,snapshotRecord]=await Promise.all([this.#loadRuntime(),snapshotLoad])}
    finally{clearInterval(loadingPulse)}
    this.bootMode = snapshotRecord ? 'restore' : 'install';
    this.#validateSnapshot(snapshotRecord);
    const snapshot=snapshotRecord?.state||null;
    this.#bootStage(snapshot ? 'restoringSystem' : 'loadingInstallationMedia', snapshot ? 18 : 8, this.bootMode);
    const base = this.base, screen = document.querySelector('#guest-screen-persistent');
    if (!screen) throw new Error('Guest screen device is not mounted');
    const machineOptions = {
      wasm_path: `${base}/v86.wasm?v=${V86_ASSET_VERSION}`, memory_size: this.settings.get('memory') * 1024 * 1024,
      vga_memory_size: 8 * 1024 * 1024, screen_container: screen,
      bios: { url: `${base}/seabios.bin` }, vga_bios: { url: `${base}/vgabios.bin` },
      filesystem: {}, autostart: false,
      network_relay_url: 'fetch', net_device: { type: 'virtio' },
      uart1: true, uart2: true, uart3: true,
      // Future does not expose guest audio yet. Leaving v86's host speaker
      // adapter enabled can restore a latched PC-speaker oscillator from a
      // snapshot, producing a continuous tone until the page is closed.
      disable_speaker: true,
    };
    if (!snapshot) machineOptions.cdrom = { url: `${base}/alpine.iso` };
    this.emulator = new V86(machineOptions);
    this.serial = new SerialBridge(this, this.kernel.bus);
    this.serial.attach(this.emulator);
    this.terminals=new Map([1,2,3].map(port=>{const bridge=new TerminalBridge(this,this.kernel.bus,port);bridge.attach(this.emulator);return[port,bridge]}));
    this.emulator.add_listener('download-progress', progress => this.#downloadProgress(progress));
    this.emulator.add_listener('download-error', error => this.kernel.bus.emit('guest:error', new Error(`Installation media could not be loaded: ${error?.file_name || 'unknown file'}`)));
    this.emulator.add_listener('emulator-ready', async () => {
      this.startedAt = Date.now();
      try {
        if (snapshot) {
          this.#bootStage('restoringVirtualHardware', 72, 'restore');
          let restoreProgress=72;
          const restorePulse=setInterval(()=>this.#bootStage('restoringVirtualHardware',Math.min(89,++restoreProgress),'restore'),900);
          try{await this.#restoreSnapshot(snapshot)}finally{clearInterval(restorePulse)}
          this.emulator.run();
          // Restoring CPU state completes before every emulated device and
          // guest tty has necessarily resumed. Give the UART and init process
          // time to settle before probing the control plane.
          await new Promise(resolve => setTimeout(resolve, 1100));
          this.#bootStage('reconnectingLinuxServices',91,'restore');
          await this.#resumeControlPlane();
          await this.#installTerminalServices();
          this.#bootStage('validatingRestoredSystem',97,'restore');
          this.#setStatus('running');
          await this.#emitGuestReady(true);
          if(snapshotRecord?.fallback)await this.stateStore.promotePrevious(this.profile).catch(error=>this.kernel.bus.emit('machine:checkpoint-error',error));
        } else {
          this.#bootStage('startingInstaller', 58, 'install');
          this.emulator.run();
          this.#setStatus('running');
          this.#startBootActivityMonitor();
          this.#prepareAlpine();
        }
        this.#startPersistence();
      } catch (error) {
        if(snapshot&&await this.#retrySnapshot(snapshotRecord))return;
        if(snapshot)await this.#disposeFailedRestore();
        this.kernel.bus.emit('guest:error', error);
      }
    });
    this.emulator.add_listener('emulator-stopped', () => { if (this.status !== 'paused') this.#setStatus('stopped'); });
  }

  #prepareAlpine() {
    let bootAttempts = 0, bootSubmitting = false, lastBootAttempt = 0, loginSent = false;
    const detect = () => {
      const screen = this.screenRows().join('\n');
      if (/(?:^|\n)boot:/m.test(screen) && !bootSubmitting && bootAttempts < 4 && Date.now()-lastBootAttempt>1800) { bootAttempts++;lastBootAttempt=Date.now();if(bootAttempts===1){bootSubmitting=true;this.#bootActivity({ key: 'continuingAlpineBoot', kind: 'console' });this.#submitBootProfile().finally(()=>{bootSubmitting=false;lastBootAttempt=Date.now()})}else this.emulator?.keyboard_send_keys([13],25);return; }
      if (!loginSent && /localhost login:\s*$|login:\s*$/m.test(screen)) { loginSent = true; this.#bootStage('configuringSystem', 70, 'install'); this.sendUserInput('root\n'); return; }
      if (!/(?:localhost:)?~\s*#\s*$|\/#\s*$/m.test(screen)) return;
      clearInterval(this._promptTimer);
      this.#bootstrapAlpine().catch(error => this.kernel.bus.emit('guest:error', error));
    };
    this._promptTimer = setInterval(detect, 160);
  }

  async #submitBootProfile() {
    await this.emulator?.keyboard_send_text('lts nomodeset acpi=off pci=nocrs', 28);
    await this.emulator?.keyboard_send_keys([13], 28);
  }

  async #bootstrapAlpine() {
    this.#bootStage('creatingAccount', 78, 'install');
    const commands = [
      "mkdir -p /mnt/future /home/future/Desktop /home/future/Documents/Notes /home/future/Downloads /home/future/Pictures /home/future/.local/share/Trash/files",
      "id future >/dev/null 2>&1 || adduser -D -h /home/future -s /bin/ash future; passwd -d future >/dev/null 2>&1 || true",
      "printf \"export PS1='future@future:\\\\w\\\\$ '\\n\" > /home/future/.profile; chown -R future:future /home/future /mnt/future",
      "mount -t 9p host9p /mnt/future -o trans=virtio,version=9p2000.L 2>/dev/null || true; mkdir -p /mnt/future/Music; chown future:future /mnt/future/Music",
    ];
    await this.sendUserInput(`${commands.join('; ')}\n`, 3);
    await new Promise(resolve => setTimeout(resolve, 1200));
    await this.#connectRootControlPlane();
    await this.#installTerminalServices();
    await this.#launchControlPlane();
  }

  async #connectRootControlPlane() {
    this.serial.activateVga();
    try {
      await this.#interruptConsole();
      const result = await this.serial.execute("printf 'root-control-ready'", 5000);
      if (result.code !== 0 || !result.output.replace(/\s+/g,'').includes('root-control-ready')) throw new Error('Root control service did not answer');
      this.controlReady = true;
      await this.#resumeControlPlane();
    } catch (error) {
      this.controlReady = false;
      throw new Error(`Unable to connect to the Future system service: ${error.message}`);
    }
  }

  async #restoreSnapshot(snapshot, timeout = 90000) {
    let timer,capturedError=null,rejectDeviceFailure;
    const deviceFailure=new Promise((_,reject)=>{rejectDeviceFailure=reject});
    const capture=event=>{
      const reason=event?.reason||event?.error||event?.message;
      if(!this.#isSnapshotRestoreFailure(reason))return;
      capturedError=reason instanceof Error?reason:new Error(String(reason));
      // v86 can report device restore failures through the browser event loop
      // instead of rejecting restore_state(). Route those failures into the
      // Future recovery UI rather than leaving them as ordinary browser errors.
      event?.preventDefault?.();
      rejectDeviceFailure(capturedError);
    };
    addEventListener('error',capture,true);
    addEventListener('unhandledrejection',capture,true);
    try {
      await Promise.race([
        Promise.resolve(this.emulator.restore_state(snapshot)),
        deviceFailure,
        new Promise((_, reject) => { timer=setTimeout(() => reject(new Error('The saved computer did not finish restoring within 90 seconds. Try again, or reinstall only if the saved state can no longer be recovered.')), timeout); }),
      ]);
      // Some v86 device restore failures are reported on the window event loop
      // instead of rejecting restore_state(). Keep a short, bounded settling
      // window before probing Linux so the device error cannot be replaced by
      // a later and misleading control-service timeout.
      await Promise.race([
        new Promise(resolve=>setTimeout(resolve,450)),
        deviceFailure,
      ]);
      if(capturedError)throw capturedError;
    } catch(error) {
      try{this.emulator?.stop()}catch{}
      throw new MachineRestoreError('The saved virtual computer state could not be restored. Your saved state has not been erased.',error);
    } finally {
      clearTimeout(timer);
      removeEventListener('error',capture,true);
      removeEventListener('unhandledrejection',capture,true);
    }
  }

  #isSnapshotRestoreFailure(reason){return /(?:set_state|restore_state|saved (?:machine|computer)|snapshot|virtual hardware)/i.test(reason?.message||String(reason||''))}

  async #retrySnapshot(record){
    const attempt=Number(record?.restoreAttempt)||0;
    let next=null;
    if(attempt===0)next={...record,restoreAttempt:1};
    else if(attempt===1&&record?.hasPrevious){const previous=await this.stateStore.loadPrevious(this.profile).catch(()=>null);if(previous)next={...previous,restoreAttempt:2,fallback:true}}
    if(!next)return false;
    await this.#disposeFailedRestore();
    this.restoreOverride=next;
    queueMicrotask(()=>this.start().catch(error=>{this.#setStatus('stopped');this.kernel.bus.emit('guest:error',error)}));
    return true;
  }

  async #disposeFailedRestore(){
    clearInterval(this._checkpointInterval);clearTimeout(this._checkpointTimer);this.#stopBootActivityMonitor();clearInterval(this._promptTimer);
    const emulator=this.emulator;this.emulator=null;
    try{emulator?.stop()}catch{}
    try{await emulator?.destroy()}catch{}
    this.serial=null;this.terminals.clear();this.terminalResets.clear();this.guestReady=false;this.controlReady=false;this.#setStatus('stopped');
  }

  #validateSnapshot(record){
    if(!record?.metadata)return;
    const expected=this.snapshotMetadata,actual=record.metadata;
    // Schema 1 used the HTTP cache token as its runtime compatibility value.
    // That token did not describe the serialized v86 state format, so those
    // records remain valid when their actual machine topology still matches.
    const comparable=['machine','image','memory'];
    if(Number(actual.schema||1)>=2)comparable.push('schema','stateFormat');
    const mismatch=comparable.find(key=>actual[key]!==expected[key]);
    if(!mismatch)return;
    const cause=new Error(`Snapshot ${mismatch} is ${JSON.stringify(actual[mismatch])}; this build requires ${JSON.stringify(expected[mismatch])}.`);
    throw new MachineRestoreError('The saved virtual computer was created by an incompatible Future runtime. Your saved state has not been erased.',cause,'SNAPSHOT_INCOMPATIBLE');
  }

  async #resumeControlPlane(){
    // A normal refresh restores the already-running serial shell. Probe it
    // first so recovery never waits on inactive VGA consoles.
    for(const timeout of [1600,2600,4000]){
      this.#bootActivity({key:'reconnectingLinuxServices',kind:'service'});
      if(await this.#connectSerialControlPlane(timeout)){await this.#installControlHelpers();this.controlReady=true;return}
      // A failed framed probe interrupts ttyS0 in SerialBridge. Give init time
      // to respawn the dedicated shell before the next probe.
      await new Promise(resolve=>setTimeout(resolve,650));
    }

    // Older snapshots do not contain the serial service. Recover one root VGA
    // console with a single bounded attempt, then install the fast path.
    this.#bootActivity({key:'recoveringLinuxConsole',kind:'service'});
    let rootConsole=await this.#connectVgaConsole(1,{login:true,timeout:5200});
    if(!rootConsole)rootConsole=await this.#connectVgaConsole(3,{login:true,timeout:5200});
    if(!rootConsole)rootConsole=await this.#connectVgaConsole(4,{login:true,timeout:5200});
    if(!rootConsole){
      if(await this.#connectVgaConsole(2,{login:false,timeout:4200})){
        this.serial.activateControl();
        this.controlReady=true;
        return;
      }
      // A snapshot can preserve ttyS0 between init respawns. Recreate the
      // service directly from a VGA root console without touching disk data.
      for(const consoleNumber of [1,3,4])if(await this.#forceSerialRecovery(consoleNumber)){
        await this.#installControlHelpers();this.controlReady=true;return;
      }
      throw new Error('The Linux control service did not respond after serial and console recovery');
    }

    await this.serial.execute('mkdir -p /home/future/.local/share/Trash/files; chown -R future:future /home/future/.local',5000,true);
    await this.#installControlHelpers();
    const serialService=`serial_rule='ttyS0::respawn:/bin/ash -s'; sed -i '/^ttyS0::/d' /etc/inittab; printf '%s\\n' "$serial_rule" >> /etc/inittab; kill -HUP 1; for serial_pid in $(ps -eo pid,args 2>/dev/null | awk '((/getty/ && /ttyS0/) || /\/bin\/ash -s/) && !/awk/ {print $1}'); do kill -9 "$serial_pid" 2>/dev/null || true; done; stty -F /dev/ttyS0 115200 raw -echo 2>/dev/null || true`;
    await this.serial.execute(serialService,5000,true);
    await new Promise(resolve=>setTimeout(resolve,300));
    if(!await this.#connectSerialControlPlane(1800)){
      await new Promise(resolve=>setTimeout(resolve,250));
      if(!await this.#connectSerialControlPlane(1800))this.serial.activateControl();
    }
    this.controlReady=true;
    if(this.serial.transport!=='serial')await this.activateUserConsole();
  }

  async #connectVgaConsole(number,{login=false,timeout=3000}={}){
    this.controlConsole=number;
    this.serial.activateVga();
    try{
      await this.activateControlConsole();
      await new Promise(resolve=>setTimeout(resolve,180));
      const lastLine=()=>this.screenRows().map(row=>row.trim()).filter(Boolean).at(-1)||'';
      let current=lastLine();
      if(login&&/login:\s*$/i.test(current)){await this.sendUserInput('root\n');await new Promise(resolve=>setTimeout(resolve,450));current=lastLine()}
      if(login&&/password:\s*$/i.test(current)){await this.sendUserInput('\n');await new Promise(resolve=>setTimeout(resolve,350))}
      await this.#interruptConsole();
      current=lastLine();
      if(!login&&/[$#]\s*$/.test(current))return true;
      const result=await this.serial.execute("printf 'control-ready'",timeout,true);
      return result.code===0&&result.output.replace(/\s+/g,'').includes('control-ready');
    }catch{return false}
  }

  async #connectSerialControlPlane(timeout=1200){
    if(!this.serial||!this.emulator)return false;
    this.#activateSerialLines();
    this.serial.activateSerial();
    try{
      // Clear a partial canonical input line without sending SIGINT. Ctrl+C
      // can terminate the init-managed /bin/ash -s process and make every
      // quick restore probe race against its respawn.
      this.emulator.serial0_send('\u0015\n');
      await new Promise(resolve=>setTimeout(resolve,120));
      const handshake=await this.serial.execute("printf 'future-serial-ready'",timeout,true);
      return handshake.code===0&&handshake.output.replace(/\s+/g,'').includes('future-serial-ready');
    }catch{return false}
  }

  async #forceSerialRecovery(consoleNumber){
    try{
      this.controlConsole=consoleNumber;this.serial.activateVga();await this.activateControlConsole();await new Promise(resolve=>setTimeout(resolve,260));
      await this.#interruptConsole();let current=this.screenRows().map(row=>row.trim()).filter(Boolean).at(-1)||'';
      if(/login:\s*$/i.test(current)){await this.sendUserInput('root\n');await new Promise(resolve=>setTimeout(resolve,650));current=this.screenRows().map(row=>row.trim()).filter(Boolean).at(-1)||''}
      if(/password:\s*$/i.test(current)){await this.sendUserInput('\n');await new Promise(resolve=>setTimeout(resolve,450))}
      await this.#interruptConsole();
      const command=`serial_rule='ttyS0::respawn:/bin/ash -s'; sed -i '/^ttyS0::/d' /etc/inittab; printf '%s\\n' "$serial_rule" >> /etc/inittab; kill -HUP 1; for serial_pid in $(ps -eo pid,args 2>/dev/null | awk '((/getty/ && /ttyS0/) || /\\/bin\\/ash -s/) && !/awk/ {print $1}'); do kill -9 "$serial_pid" 2>/dev/null || true; done; stty -F /dev/ttyS0 115200 raw -echo 2>/dev/null || true`;
      await this.sendUserInput(`${command}\n`,1);await new Promise(resolve=>setTimeout(resolve,800));
      for(const timeout of [1800,2800]){if(await this.#connectSerialControlPlane(timeout))return true;await new Promise(resolve=>setTimeout(resolve,300))}
    }catch{}
    return false;
  }

  async #installControlHelpers(){
    const check='[ -x /usr/local/bin/future_list ]';
    const installed=await this.#probeGuest(check,4000);
    if(installed.passed||(!installed.answered&&this.bootMode==='restore'))return;
    const fileHelper=`#!/bin/ash\n# FUTURE_LIST_V1\np="$1"\n[ -d "$p" ] || exit 44\nfor f in "$p"/*; do\n  [ -e "$f" ] || continue\n  n=\${f##*/}\n  meta=$(stat -c '%s|%Y' "$f" 2>/dev/null || printf '0|0')\n  s=\${meta%%|*}; m=\${meta#*|}\n  if [ -d "$f" ]; then t=directory; s=0; else t=file; fi\n  printf '__FUTURE_FILE__%s__FUTURE_FIELD__%s__FUTURE_FIELD__%s__FUTURE_FIELD__%s__FUTURE_ROW__' "$n" "$t" "$s" "$m"\ndone`;
    const fileHelperPayload=btoa(fileHelper);
    await this.#ensureGuestSetup(`mkdir -p /usr/local/bin; printf %s '${fileHelperPayload}' | base64 -d > /usr/local/bin/.future_list.new; chmod 755 /usr/local/bin/.future_list.new; mv /usr/local/bin/.future_list.new /usr/local/bin/future_list`,check,'Linux file helper');
  }

  async #installTerminalServices(){
    this.#activateTerminalLines();
    const check=`[ -x /usr/local/bin/future-terminal-login ] && grep -q FUTURE_TERMINAL_PROFILE /home/future/.profile 2>/dev/null || exit 1; for terminal_port in 1 2 3; do grep -q "^ttyS\${terminal_port}::respawn:/sbin/getty -n -l /usr/local/bin/future-terminal-login " /etc/inittab || exit 1; done`;
    const installed=await this.#probeGuest(check,5000);
    if(installed.passed)return;
    // A successfully created snapshot already contains these services. A
    // missing response during restore is transport uncertainty, not evidence
    // that guest files are absent; rewriting them here can turn a transient
    // UART delay into a boot failure.
    if(!installed.answered&&this.bootMode==='restore')return;
    const loginHelper=`#!/bin/ash\nexport TERM=xterm-256color COLORTERM=truecolor\nexec /bin/login -f future`;
    const profile=`\n# FUTURE_TERMINAL_PROFILE\nexport TERM=xterm-256color\nexport COLORTERM=truecolor\nalias ls='ls --color=auto'\nalias ll='ls -lah --color=auto'\nPS1='\\[\\033[38;5;75m\\]future@future \\[\\033[38;5;110m\\]\\w \\[\\033[38;5;78m\\]❯ \\[\\033[0m\\]'\n`;
    const encode=value=>{const bytes=new TextEncoder().encode(value);return btoa(String.fromCharCode(...bytes))};
    const helperPayload=encode(loginHelper),profilePayload=encode(profile);
    await this.#ensureGuestSetup(
      `mkdir -p /usr/local/bin; printf %s '${helperPayload}' | base64 -d > /usr/local/bin/.future-terminal-login.new; chmod 755 /usr/local/bin/.future-terminal-login.new; mv /usr/local/bin/.future-terminal-login.new /usr/local/bin/future-terminal-login`,
      '[ -x /usr/local/bin/future-terminal-login ]',
      'terminal login helper',
    );
    await this.#ensureGuestSetup(
      `touch /home/future/.profile; grep -q FUTURE_TERMINAL_PROFILE /home/future/.profile 2>/dev/null || printf %s '${profilePayload}' | base64 -d >> /home/future/.profile; chown future:future /home/future/.profile`,
      'grep -q FUTURE_TERMINAL_PROFILE /home/future/.profile 2>/dev/null',
      'terminal profile',
    );
    const terminalRules=`for terminal_port in 1 2 3; do grep -q "^ttyS\${terminal_port}::respawn:/sbin/getty -n -l /usr/local/bin/future-terminal-login " /etc/inittab || exit 1; done`;
    await this.#ensureGuestSetup(
      `sed '/^ttyS[123]::/d' /etc/inittab > /tmp/future-inittab.new; for terminal_port in 1 2 3; do printf 'ttyS%s::respawn:/sbin/getty -n -l /usr/local/bin/future-terminal-login 115200 ttyS%s xterm-256color\\n' "$terminal_port" "$terminal_port" >> /tmp/future-inittab.new; done; cat /tmp/future-inittab.new > /etc/inittab; rm -f /tmp/future-inittab.new`,
      terminalRules,
      'terminal service rules',
    );
    // Finish the framed setup command before restarting init-managed TTYs.
    // Otherwise their output can hide the end marker and falsely fail restore.
    try{await this.serial.execute(`( sleep 1; kill -HUP 1; for terminal_pid in $(ps -eo pid,tty 2>/dev/null | awk '$2 ~ /^ttyS[123]$/ {print $1}'); do kill -HUP "$terminal_pid" 2>/dev/null || true; done ) >/dev/null 2>&1 &`,5000,true)}catch(error){if(!await this.#guestCheck(check,6000))throw error}
    await new Promise(resolve=>setTimeout(resolve,350));
  }

  async #guestCheck(command,timeout=5000){
    return (await this.#probeGuest(command,timeout)).passed;
  }

  async #probeGuest(command,timeout=5000){
    try{const result=await this.serial.execute(command,timeout,true);return{answered:true,passed:result.code===0,result}}
    catch(error){return{answered:false,passed:false,error}}
  }

  async #ensureGuestSetup(command,check,label){
    let lastError;
    for(const timeout of [10000,18000]){
      try{const result=await this.serial.execute(command,timeout,true);if(result.code!==0)lastError=new Error(result.output||`${label} exited with status ${result.code}`)}catch(error){lastError=error}
      await new Promise(resolve=>setTimeout(resolve,180));
      if(await this.#guestCheck(check,6000))return;
    }
    const timedOut=/timed out/i.test(lastError?.message||'');
    throw new Error(timedOut?`The Future ${label} could not be verified after the Linux guest stopped responding.`:`Unable to configure the Future ${label}: ${lastError?.message||'unknown error'}`);
  }

  async #launchControlPlane() {
    this.#bootStage('startingServices', 86, 'install');
    await this.sendUserInput('chvt 2\n', 5);
    await new Promise(resolve => setTimeout(resolve, 700));
    await this.sendUserInput('future\n', 5);
    await new Promise(resolve => setTimeout(resolve, 500));
    await this.sendUserInput('clear\n', 5);
    setTimeout(() => this.#emitGuestReady(false).catch(error => this.kernel.bus.emit('guest:error', error)), 500);
  }

  #startPersistence() {
    clearInterval(this._checkpointInterval);
    this._checkpointInterval = setInterval(() => this.checkpoint(), 60000);
    if (!this._persistenceBound) {
      this._persistenceBound = true;
      this.kernel.bus.on('filesystem:changed', () => this.scheduleCheckpoint(3000));
      this.kernel.bus.on('terminal:activity', () => this.scheduleCheckpoint(8000));
      this._visibilityHandler = () => { if (document.visibilityState === 'hidden') this.checkpoint(); };
      this._pageHideHandler = () => this.checkpoint();
      document.addEventListener('visibilitychange', this._visibilityHandler);
      addEventListener('pagehide', this._pageHideHandler);
    }
  }

  scheduleCheckpoint(delay = 1500) { clearTimeout(this._checkpointTimer);this._checkpointTimer=setTimeout(async()=>{const saved=await this.checkpoint();if(!saved&&this.guestReady&&this.status==='running')this.scheduleCheckpoint(1800)},delay); }
  async checkpoint() {
    if (!this.emulator || !this.guestReady || this.saving || this.status !== 'running' || this.serial?.active || this.serial?.pending?.length) return false;
    this.saving = true;
    try { const state = await this.emulator.save_state(); await this.stateStore.save(this.profile, state, this.snapshotMetadata); this.kernel.bus.emit('machine:checkpoint', Date.now()); return true; }
    catch (error) { this.kernel.bus.emit('machine:checkpoint-error', error); return false; }
    finally { this.saving = false; }
  }

  async clearPersistedState() { clearTimeout(this._checkpointTimer); await this.stateStore.clear(this.profile); }
  async deletePersistedState() { clearTimeout(this._checkpointTimer); await this.stateStore.deleteDatabase(); }
  persistenceInfo(){return this.stateStore.info(this.profile)}
  async #emitGuestReady(restored) {
    this.#stopBootActivityMonitor();
    this.guestReady = true;
    if (!restored) {
      this.#bootStage('creatingSnapshot', 94, 'install');
      this.emulator.eject_cdrom();
      const saved = await this.checkpoint();
      if (!saved) throw new Error('The initial system snapshot could not be saved');
    }
    this.#bootStage('systemReady', 100, restored ? 'restore' : 'install');
    this.kernel.bus.emit('guest:ready', { restored });
    if (restored) this.scheduleCheckpoint(2000);
  }
  #bootStage(label, progress, mode = this.bootMode || 'checking') {
    this.bootProgress=Math.max(this.bootProgress||0,progress||0);
    this.kernel?.bus.emit('machine:boot-stage', { label, progress:this.bootProgress, mode });
    if (label !== this.lastBootLabel) {
      this.lastBootLabel = label;
      this.#bootActivity({ key: label, kind: 'stage' });
    }
  }
  #bootActivity({ key = null, message = null, kind = 'console' } = {}) {
    this.kernel?.bus.emit('machine:boot-activity', { key, message, kind, timestamp: Date.now(), progress: this.bootProgress || 0 });
  }
  #startBootActivityMonitor() {
    this.#stopBootActivityMonitor();
    this.lastConsoleSignature = '';
    const inspect = () => {
      const rows = this.screenRows()
        .map(row => row.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim())
        .filter(row => row && !/^[|/\\_.-]+$/.test(row));
      if (!rows.length) return;
      const recent = rows.slice(-4);
      const signature = recent.join('\n');
      if (signature === this.lastConsoleSignature) return;
      this.lastConsoleSignature = signature;
      const message = recent.at(-1).slice(0, 150);
      if (message) this.#bootActivity({ message, kind: 'console' });
      this.#applyConsoleMilestone(signature);
    };
    inspect();
    this._bootActivityTimer = setInterval(inspect, 350);
  }
  #stopBootActivityMonitor() { clearInterval(this._bootActivityTimer); this._bootActivityTimer = null; }
  #applyConsoleMilestone(text) {
    const milestones = [
      [/SeaBIOS|iPXE|ISOLINUX|SYSLINUX/i, 59],
      [/Loading|initramfs|Linux version/i, 61],
      [/Mounting \/run|Caching service dependencies/i, 63],
      [/devtmpfs|dev\/mqueue/i, 65],
      [/busybox mdev|Scanning hardware/i, 67],
      [/(?:localhost )?login:/i, 70],
    ];
    for (const [pattern, progress] of milestones) {
      if (pattern.test(text) && progress > (this.bootProgress || 0)) {
        this.bootProgress = progress;
        this.kernel?.bus.emit('machine:boot-stage', { label: 'startingInstaller', progress, mode: 'install' });
      }
    }
  }
  #downloadProgress(detail) {
    const name=String(detail?.file_name||''),computable=detail?.lengthComputable&&detail.total>0;
    const ratio=computable?Math.min(1,detail.loaded/detail.total):0,isMedia=name.endsWith('alpine.iso');
    const label=isMedia?'loadingInstallationMedia':'loadingRuntime',progress=isMedia?10+Math.round(ratio*44):5+Math.round(ratio*5);
    this.#bootStage(label,progress,this.bootMode);
    if (progress !== this.lastDownloadActivityProgress) { this.lastDownloadActivityProgress=progress;this.#bootActivity({key:label,kind:'progress'}); }
  }
  #activateSerialLines() { this.emulator?.serial_set_carrier_detect(0,true);this.emulator?.serial_set_data_set_ready(0,true);this.emulator?.serial_set_clear_to_send(0,true); }
  #activateTerminalLines(){for(const port of [1,2,3]){this.emulator?.serial_set_carrier_detect(port,true);this.emulator?.serial_set_data_set_ready(port,true);this.emulator?.serial_set_clear_to_send(port,true)}}

  terminalWrite(port,data){
    const tty=Number(port),bridge=this.terminals.get(tty),reset=this.terminalResets.get(tty);
    if(reset)return reset.finally(()=>bridge?.write(data));
    bridge?.write(data)
  }
  terminalReplay(port){return this.terminals.get(Number(port))?.replay()||''}
  terminalPorts(){return[1].sort((a,b)=>Number(this.terminalResets.has(a))-Number(this.terminalResets.has(b)))}
  executeAgentTerminal(command,timeout,signal){
    const terminal=this.terminals.get(2);
    if(!terminal)return Promise.reject(new Error('The Future agent terminal is not available.'));
    return terminal.execute(command,timeout,signal);
  }
  resizeTerminal(port,columns,rows){
    const tty=Number(port),cols=Math.max(20,Math.min(400,Number(columns)||80)),lines=Math.max(5,Math.min(200,Number(rows)||24));
    if(!this.serial||!this.guestReady)return Promise.resolve();
    return this.serial.execute(`stty -F /dev/ttyS${tty} cols ${cols} rows ${lines} 2>/dev/null || true`,5000,true).catch(()=>{});
  }
  resetTerminal(port){
    const tty=Number(port),bridge=this.terminals.get(tty);
    if(this.terminalResets.has(tty))return this.terminalResets.get(tty);
    bridge?.suspend();
    if(!bridge||!this.guestReady){bridge?.resume();return Promise.resolve()}
    // Reset the interactive shell on its own TTY. The previous implementation
    // used the system control queue and polled /proc for up to four seconds,
    // which made a newly opened Terminal appear blank whenever that queue was
    // busy. Ctrl+C followed by exit gives init a clean, normal shell teardown
    // without coupling Terminal startup to filesystem or monitoring commands.
    const task=(async()=>{
      bridge.write('\u0003');
      await new Promise(resolve=>setTimeout(resolve,70));
      bridge.write('exit\r');
      await new Promise(resolve=>setTimeout(resolve,360));
    })().finally(()=>{bridge.resume();if(this.terminalResets.get(tty)===task)this.terminalResets.delete(tty)});
    this.terminalResets.set(tty,task);
    return task;
  }

  pause() { this.emulator?.stop(); this.#setStatus('paused'); }
  resume() { this.emulator?.run(); this.#setStatus('running'); }
  async restart() { if(!this.emulator)return this.start();await this.checkpoint();await this.stop(false);await this.start(); }
  async stop(save = true) { if(!this.emulator)return;if(save)await this.checkpoint();clearInterval(this._checkpointInterval);clearTimeout(this._checkpointTimer);this.#stopBootActivityMonitor();clearInterval(this._promptTimer);this.emulator.stop();await this.emulator.destroy();this.emulator=null;this.serial=null;this.terminalResets.clear();this.terminals.clear();this.guestReady=false;this.controlReady=false;this.#setStatus('stopped'); }
  uptime() { return this.startedAt ? Date.now()-this.startedAt : 0; }
  instructionCount() { return this.emulator?.get_instruction_counter?.() || 0; }
  screenText() { return this.screenRows().join('\n'); }
  screenRows() {
    const strip=row=>String(row||'').replace(/\x1b\[[0-9;]*m/g,'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,'').trimEnd();
    try {
      const rows=this.emulator?.screen_adapter?.get_text_screen?.();
      if(Array.isArray(rows)&&rows.length)return rows.map(strip);
    } catch {}
    const text=document.querySelector('#guest-screen-persistent>div')?.innerText||'';
    if(!text)return[];
    const lines=text.replace(/\r/g,'').split('\n'),rows=[];
    for(const line of lines){if(!line.length){rows.push('');continue}for(let offset=0;offset<line.length;offset+=80)rows.push(strip(line.slice(offset,offset+80)))}
    return rows;
  }
  async sendUserInput(text, delay = 3) {
    if (!this.emulator) return;
    const chunks=String(text).replace(/\r\n/g,'\n').split('\n');
    for(let index=0;index<chunks.length;index++){if(chunks[index])await this.emulator.keyboard_send_text(chunks[index],delay);if(index<chunks.length-1)await this.emulator.keyboard_send_keys([13],delay)}
  }
  async #interruptConsole(){if(!this.emulator)return;await this.emulator.keyboard_send_scancodes([0x1d,0x2e,0xae,0x9d],12);await this.emulator.keyboard_send_keys([13],12);await new Promise(resolve=>setTimeout(resolve,350))}
  async #switchConsole(number) {
    if(!this.emulator)return;
    const functionKey=0x3A+Math.max(1,Math.min(10,number));
    await this.emulator.keyboard_send_scancodes([0x38,functionKey,functionKey|0x80,0xB8],10);
    await new Promise(resolve=>setTimeout(resolve,160));
  }
  activateControlConsole(){return this.#switchConsole(this.controlConsole||1)}
  activateUserConsole(){return this.#switchConsole(2)}
  async interruptControlConsole(){await this.activateControlConsole();await this.#interruptConsole()}
  async sendControlInput(text,delay=3){await this.activateControlConsole();await this.sendUserInput(text,delay)}
  listShared(path='/') { const fs=this.emulator?.fs9p;if(!fs)return null;return(fs.read_dir(path)||[]).map(name=>{const target=`${path.replace(/\/$/,'')}/${name}`,found=fs.SearchPath(target),inode=found.id>=0?fs.GetInode(found.id):null;return{name,type:inode&&fs.IsDirectory(found.id)?'directory':'file',size:inode?.size||0,modified:inode?.mtime||0}}); }
  async writeSharedBytes(path,bytes) { await this.emulator?.create_file(path,bytes instanceof Uint8Array?bytes:new Uint8Array(bytes)); }
  async readSharedBytes(path) { const data=await this.emulator?.read_file(path);return data?new Uint8Array(data):new Uint8Array(); }
  async readShared(path) { const data=await this.emulator?.read_file(path);return data?new TextDecoder().decode(data):''; }
  #setStatus(status) { this.status=status;this.kernel?.bus.emit('machine:status',status); }

  async #loadRuntime() {
    if(window.V86&&window.__futureV86RuntimeVersion===V86_ASSET_VERSION){const loaded=[...document.scripts].reverse().find(script=>/\/libv86\.js(?:\?|$)/.test(script.src));this.base=window.__futureV86Base||(loaded?new URL('.',loaded.src).pathname.replace(/\/$/,''):'/v86');return window.V86;}
    for(const base of ['/v86','/public/v86']){try{await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=`${base}/libv86.js?v=${V86_ASSET_VERSION}`;script.onload=resolve;script.onerror=reject;document.head.appendChild(script)});this.base=base;window.__futureV86Base=base;window.__futureV86RuntimeVersion=V86_ASSET_VERSION;return window.V86}catch{}}
    throw new Error('Unable to load the v86 runtime');
  }
}
