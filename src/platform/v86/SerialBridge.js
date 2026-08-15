const encodeCommand = value => {
  const bytes=new TextEncoder().encode(String(value));let binary='';
  for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
  return btoa(binary);
};

export class SerialBridge {
  constructor(machine, bus) {
    this.machine = machine;
    this.bus = bus;
    this.decoder = new TextDecoder();
    this.pending = [];
    this.active = null;
    // A restored VGA text buffer still contains markers from the previous page.
    // Use a per-session sequence so stale markers can never complete a new command.
    this.sequence = Math.floor(Date.now() % 1000000000);
    this.buffer = '';
    this.transport = 'vga';
  }

  attach(emulator) {
    emulator.add_listener('serial0-output-byte', byte => this.#receive(byte));
  }

  write(text) {
    if (!this.machine.emulator) return;
    if (this.transport === 'serial') this.machine.emulator.serial0_send(text);
    else if (this.transport === 'control-vga') return this.machine.sendControlInput(text,3);
    else return this.machine.sendUserInput(text,3);
  }

  activateSerial() { this.transport = 'serial'; this.buffer = ''; }
  activateVga() { this.transport = 'vga'; this.buffer = ''; }
  activateControl() { this.transport = 'control-vga'; this.buffer = ''; }

  execute(command, timeout = 12000, priority = false) {
    return new Promise((resolve, reject) => {
      const request={ id: ++this.sequence, command, timeout, resolve, reject };
      priority?this.pending.unshift(request):this.pending.push(request);
      this.#next();
    });
  }

  async #next() {
    if (this.active || !this.pending.length || !this.machine.emulator) return;
    this.active = this.pending.shift();
    this.buffer = '';
    const { id, command, timeout } = this.active;
    this.bus.emit('system:command-start', { id });
    const begin = `__AERIS_BEGIN_${id}__`, end = `__AERIS_END_${id}__`;
    this.active.begin = begin; this.active.end = end;
    const guestSeconds=Math.max(1,Math.floor((timeout-350)/1000));
    const body=this.transport==='serial'?`printf %s '${encodeCommand(command)}' | base64 -d | timeout -s KILL ${guestSeconds} /bin/ash`:command;
    await this.write(`export PATH=/usr/local/sbin:/usr/local/bin:/sbin:/usr/sbin:/bin:/usr/bin; printf '\\n${begin}\\n'; ${body}; __aeris_status=$?; printf '\\n${end}:%s\\n' "$__aeris_status"\n`);
    if(!this.active||this.active.id!==id)return;
    this.active.timer = setTimeout(() => this.#finish(new Error(`Guest command timed out: ${command}`)), timeout);
    if (this.transport !== 'serial') this.active.poll = setInterval(() => this.#inspect(this.machine.screenRows().join('\n')), 80);
  }

  #receive(byte) {
    // Serial output is a byte stream. Decoding each byte as an independent
    // character corrupts every multi-byte UTF-8 sequence (notably CJK text).
    const character = this.decoder.decode(Uint8Array.of(byte), { stream: true });
    if (!character) return;
    this.bus.emit('serial:data', character);
    if (this.transport === 'serial') this.#inspect(character, true);
  }

  #inspect(text, append = false) {
    if (!this.active) return;
    this.buffer = append ? this.buffer + text : text;
    const endMatch = this.buffer.match(new RegExp(`${this.active.end}:(\\d+)`));
    if (!endMatch) return;
    const start = this.buffer.lastIndexOf(this.active.begin);
    const end = this.buffer.lastIndexOf(this.active.end);
    const output = start >= 0 ? this.buffer.slice(start + this.active.begin.length, end).split('\n').map(line=>line.trimEnd()).join('\n').replace(/^\s+|\s+$/g, '') : '';
    this.#finish(null, { output, code: Number(endMatch[1]) });
  }

  async #finish(error, result) {
    const active = this.active;
    if (!active) return;
    const failedTransport=this.transport;
    clearTimeout(active.timer);
    clearInterval(active.poll);
    this.active = null;
    if (error && this.transport === 'control-vga') await this.machine.interruptControlConsole().catch(()=>{});
    if(error&&failedTransport==='serial'){
      // ttyS0 is the dedicated system shell. A missing frame usually means a
      // partial or interrupted command, not that VGA is ready to replace it.
      // Clear the current line and keep the next retry on the serial service;
      // switching blindly to VGA leaves Files without a usable prompt.
      await this.write('\u0003\n');
      // Ctrl+C may terminate the init-managed outer shell together with its
      // timed child. Wait for init to respawn ttyS0 before starting the next
      // queued command, otherwise every retry is sent into the same gap.
      await new Promise(resolve=>setTimeout(resolve,650));
      this.activateSerial();
    }
    if (this.transport === 'control-vga') await this.machine.activateUserConsole();
    this.bus.emit('system:command-end', { id: active.id, error: error?.message || null });
    error ? active.reject(error) : active.resolve(result);
    this.#next();
  }
}
