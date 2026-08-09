import { SerialBridge } from './SerialBridge.js';
import { MachineStateStore } from './MachineStateStore.js';

const IMAGE_VERSION = 'alpine-3.24.1-x86-compatible-v11';

export class V86Machine {
  constructor(settings) {
    this.settings = settings;
    this.emulator = null;
    this.status = 'stopped';
    this.startedAt = 0;
    this.serial = null;
    this.controlConsole = 1;
    this.stateStore = new MachineStateStore();
    this.guestReady = false;
    this.saving = false;
    this.lastBootLabel = null;
    this.lastConsoleSignature = '';
  }

  get profile() { return `${IMAGE_VERSION}-${this.settings.get('memory')}mb`; }

  async start() {
    if (this.emulator) return;
    this.bootProgress = 0;
    this.#bootStage('checkingSystem', 3, 'checking');
    this.#setStatus('booting');
    let loadingProgress=3;
    const loadingPulse=setInterval(()=>this.#bootStage('checkingSystem',Math.min(17,++loadingProgress),'checking'),700);
    let V86,snapshot;
    try{[V86,snapshot]=await Promise.all([this.#loadRuntime(),this.stateStore.load(this.profile).catch(()=>null)])}
    finally{clearInterval(loadingPulse)}
    this.bootMode = snapshot ? 'restore' : 'install';
    this.#bootStage(snapshot ? 'restoringSystem' : 'loadingInstallationMedia', snapshot ? 18 : 8, this.bootMode);
    const base = this.base, screen = document.querySelector('#guest-screen-persistent');
    if (!screen) throw new Error('Guest screen device is not mounted');
    const machineOptions = {
      wasm_path: `${base}/v86.wasm`, memory_size: this.settings.get('memory') * 1024 * 1024,
      vga_memory_size: 8 * 1024 * 1024, screen_container: screen,
      bios: { url: `${base}/seabios.bin` }, vga_bios: { url: `${base}/vgabios.bin` },
      filesystem: {}, autostart: false,
      network_relay_url: 'fetch', net_device: { type: 'virtio' },
    };
    if (!snapshot) machineOptions.cdrom = { url: `${base}/alpine.iso` };
    this.emulator = new V86(machineOptions);
    this.serial = new SerialBridge(this, this.kernel.bus);
    this.serial.attach(this.emulator);
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
          this.#bootStage('validatingRestoredSystem',97,'restore');
          this.#setStatus('running');
          await this.#emitGuestReady(true);
        } else {
          this.#bootStage('startingInstaller', 58, 'install');
          this.emulator.run();
          this.#setStatus('running');
          this.#startBootActivityMonitor();
          this.#prepareAlpine();
        }
        this.#startPersistence();
      } catch (error) {
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
      "mkdir -p /mnt/aeris /home/aeris/Desktop /home/aeris/Documents/Notes /home/aeris/Downloads /home/aeris/Pictures /home/aeris/.local/share/Trash/files",
      "id aeris >/dev/null 2>&1 || adduser -D -h /home/aeris -s /bin/ash aeris; passwd -d aeris >/dev/null 2>&1 || true",
      "printf \"export PS1='aeris@aeris:\\\\w\\\\$ '\\n\" > /home/aeris/.profile; chown -R aeris:aeris /home/aeris /mnt/aeris",
      "mount -t 9p host9p /mnt/aeris -o trans=virtio,version=9p2000.L 2>/dev/null || true",
    ];
    await this.sendUserInput(`${commands.join('; ')}\n`, 3);
    await new Promise(resolve => setTimeout(resolve, 1200));
    await this.#connectRootControlPlane();
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
      throw new Error(`Unable to connect to the Aeris system service: ${error.message}`);
    }
  }

  async #restoreSnapshot(snapshot, timeout = 90000) {
    let timer;
    try {
      await Promise.race([
        this.emulator.restore_state(snapshot),
        new Promise((_, reject) => { timer=setTimeout(() => reject(new Error('The saved computer did not finish restoring within 90 seconds. Try again, or reinstall only if the saved state can no longer be recovered.')), timeout); }),
      ]);
    } finally { clearTimeout(timer); }
  }

  async #resumeControlPlane(){
    // A normal refresh restores the already-running serial shell. Probe it
    // first so recovery never waits on inactive VGA consoles.
    for(const timeout of [1200,1800,2600]){
      this.#bootActivity({key:'reconnectingLinuxServices',kind:'service'});
      if(await this.#connectSerialControlPlane(timeout)){await this.#installControlHelpers();this.controlReady=true;return}
      await new Promise(resolve=>setTimeout(resolve,320));
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

    await this.serial.execute('mkdir -p /home/aeris/.local/share/Trash/files; chown -R aeris:aeris /home/aeris/.local',5000,true);
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
      // Cancel a partial line captured in the snapshot, then start a clean
      // framed command. This is safe for the dedicated /bin/ash -s service.
      this.emulator.serial0_send('\u0003\n');
      await new Promise(resolve=>setTimeout(resolve,90));
      const handshake=await this.serial.execute("printf 'aeris-serial-ready'",timeout,true);
      return handshake.code===0&&handshake.output.replace(/\s+/g,'').includes('aeris-serial-ready');
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
    const fileHelper=`#!/bin/ash\np="$1"\n[ -d "$p" ] || exit 44\nfor f in "$p"/*; do\n  [ -e "$f" ] || continue\n  n=\${f##*/}\n  meta=$(stat -c '%s|%Y' "$f" 2>/dev/null || printf '0|0')\n  s=\${meta%%|*}; m=\${meta#*|}\n  if [ -d "$f" ]; then t=directory; s=0; else t=file; fi\n  printf '__AERIS_FILE__%s__AERIS_FIELD__%s__AERIS_FIELD__%s__AERIS_FIELD__%s__AERIS_ROW__' "$n" "$t" "$s" "$m"\ndone`;
    const fileHelperPayload=btoa(fileHelper);
    await this.serial.execute(`mkdir -p /usr/local/bin; printf %s '${fileHelperPayload}' | base64 -d > /usr/local/bin/aeris_list; chmod 755 /usr/local/bin/aeris_list`,5000,true);
  }

  async #launchControlPlane() {
    this.#bootStage('startingServices', 86, 'install');
    await this.sendUserInput('chvt 2\n', 5);
    await new Promise(resolve => setTimeout(resolve, 700));
    await this.sendUserInput('aeris\n', 5);
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
    try { const state = await this.emulator.save_state(); await this.stateStore.save(this.profile, state); this.kernel.bus.emit('machine:checkpoint', Date.now()); return true; }
    catch (error) { this.kernel.bus.emit('machine:checkpoint-error', error); return false; }
    finally { this.saving = false; }
  }

  async clearPersistedState() { clearTimeout(this._checkpointTimer); await this.stateStore.clear(this.profile); }
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

  pause() { this.emulator?.stop(); this.#setStatus('paused'); }
  resume() { this.emulator?.run(); this.#setStatus('running'); }
  async restart() { if(!this.emulator)return this.start();await this.checkpoint();await this.stop(false);await this.start(); }
  async stop(save = true) { if(!this.emulator)return;if(save)await this.checkpoint();clearInterval(this._checkpointInterval);clearTimeout(this._checkpointTimer);this.#stopBootActivityMonitor();clearInterval(this._promptTimer);this.emulator.stop();await this.emulator.destroy();this.emulator=null;this.serial=null;this.guestReady=false;this.controlReady=false;this.#setStatus('stopped'); }
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
  async readShared(path) { const data=await this.emulator?.read_file(path);return data?new TextDecoder().decode(data):''; }
  #setStatus(status) { this.status=status;this.kernel?.bus.emit('machine:status',status); }

  async #loadRuntime() {
    if(window.V86){const loaded=[...document.scripts].reverse().find(script=>/\/libv86\.js(?:\?|$)/.test(script.src));this.base=window.__aerisV86Base||(loaded?new URL('.',loaded.src).pathname.replace(/\/$/,''):'/v86');return window.V86;}
    for(const base of ['/v86','/public/v86']){try{await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src=`${base}/libv86.js`;script.onload=resolve;script.onerror=reject;document.head.appendChild(script)});this.base=base;window.__aerisV86Base=base;return window.V86}catch{}}
    throw new Error('Unable to load the v86 runtime');
  }
}
