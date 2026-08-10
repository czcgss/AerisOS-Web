export class TerminalBridge {
  constructor(machine, bus, port) {
    this.machine = machine;
    this.bus = bus;
    this.port = port;
    this.decoder = new TextDecoder();
    this.encoder = new TextEncoder();
    this.buffer = '';
    this.suspended = false;
  }

  attach(emulator) {
    emulator.add_listener(`serial${this.port}-output-byte`, byte => {
      if(this.suspended)return;
      const data=this.decoder.decode(Uint8Array.of(byte),{stream:true});
      if(!data)return;
      this.buffer=(this.buffer+data).slice(-131072);
      this.bus.emit('terminal:data',{port:this.port,data});
    });
  }

  write(data) {
    if(!this.machine.emulator)return;
    this.machine.emulator.serial_send_bytes(this.port,this.encoder.encode(String(data)));
    this.bus.emit('terminal:activity',{port:this.port});
  }

  replay(){return this.buffer}
  clear(){this.buffer=''}
  suspend(){this.suspended=true;this.clear()}
  resume(){this.clear();this.suspended=false}
}
