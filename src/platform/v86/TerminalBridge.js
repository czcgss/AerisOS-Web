export class TerminalBridge {
  constructor(machine, bus, port) {
    this.machine = machine;
    this.bus = bus;
    this.port = port;
    this.decoder = new TextDecoder();
    this.encoder = new TextEncoder();
    this.buffer = '';
    this.suspended = false;
    this.pending = '';
    this.flushTimer = 0;
  }

  attach(emulator) {
    emulator.add_listener(`serial${this.port}-output-byte`, byte => {
      if(this.suspended)return;
      const data=this.decoder.decode(Uint8Array.of(byte),{stream:true});
      if(!data)return;
      this.pending+=data;
      if(!this.flushTimer)this.flushTimer=setTimeout(()=>this.flush(),8);
    });
  }

  write(data) {
    if(!this.machine.emulator)return;
    this.machine.emulator.serial_send_bytes(this.port,this.encoder.encode(String(data)));
    this.bus.emit('terminal:activity',{port:this.port});
  }

  replay(){this.drain(false);return this.buffer}
  clear(){this.buffer=''}
  drain(emit=true){clearTimeout(this.flushTimer);this.flushTimer=0;const data=this.pending;this.pending='';if(!data||this.suspended)return;this.buffer=(this.buffer+data).slice(-131072);if(emit)this.bus.emit('terminal:data',{port:this.port,data})}
  flush(){this.drain(true)}
  suspend(){this.suspended=true;clearTimeout(this.flushTimer);this.flushTimer=0;this.pending='';this.clear()}
  resume(){this.clear();this.suspended=false}
}
