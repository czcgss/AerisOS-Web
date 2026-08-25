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
    this.executionSequence = Math.floor(Date.now() % 1000000000);
    this.executionQueue = [];
    this.activeExecution = null;
    this.executionBuffer = '';
  }

  attach(emulator) {
    emulator.add_listener(`serial${this.port}-output-byte`, byte => {
      if(this.suspended)return;
      const data=this.decoder.decode(Uint8Array.of(byte),{stream:true});
      if(!data)return;
      this.#inspectExecution(data);
      this.pending+=data;
      if(!this.flushTimer)this.flushTimer=setTimeout(()=>this.flush(),8);
    });
  }

  write(data) {
    if(!this.machine.emulator)return;
    const value=String(data);
    this.machine.emulator.serial_send_bytes(this.port,this.encoder.encode(value));
    this.bus.emit('terminal:activity',{port:this.port,submitted:/[\r\n]/.test(value)});
  }

  replay(){this.drain(false);return this.buffer}
  clear(){this.buffer=''}
  drain(emit=true){clearTimeout(this.flushTimer);this.flushTimer=0;const data=this.pending;this.pending='';if(!data||this.suspended)return;this.buffer=(this.buffer+data).slice(-131072);if(emit)this.bus.emit('terminal:data',{port:this.port,data})}
  flush(){this.drain(true)}
  suspend(){this.suspended=true;clearTimeout(this.flushTimer);this.flushTimer=0;this.pending='';this.clear()}
  resume(){this.clear();this.suspended=false}

  execute(command,timeout=60000,signal=null){
    return new Promise((resolve,reject)=>{
      const request={id:++this.executionSequence,command:String(command),timeout,signal,resolve,reject};
      if(signal?.aborted){reject(new DOMException('System action cancelled.','AbortError'));return}
      request.abort=()=>this.#abortExecution(request);
      signal?.addEventListener('abort',request.abort,{once:true});
      this.executionQueue.push(request);this.#nextExecution();
    });
  }

  #nextExecution(){
    if(this.activeExecution||!this.executionQueue.length||!this.machine.emulator)return;
    const request=this.executionQueue.shift(),token=`${request.id}_${crypto.randomUUID().replace(/-/g,'').slice(0,8)}`;
    request.begin=`__FUTURE_TTY_BEGIN_${token}__`;request.end=`__FUTURE_TTY_END_${token}__`;
    this.activeExecution=request;this.executionBuffer='';
    // Split marker literals across shell variables so terminal echo cannot be
    // mistaken for actual framed output.
    const prefix='__FUTURE_TTY_',beginSuffix=`BEGIN_${token}__`,endSuffix=`END_${token}__`;
    const framed=`__future_prefix='${prefix}'; __future_begin='${beginSuffix}'; __future_end='${endSuffix}'; printf '\\n%s%s\\n' "$__future_prefix" "$__future_begin"; ( ${request.command} ); __future_status=$?; printf '\\n%s%s:%s\\n' "$__future_prefix" "$__future_end" "$__future_status"`;
    // VINTR flushes the TTY input queue. Sending Ctrl+C and the command in one
    // serial packet discards the command bytes that follow the interrupt.
    this.write('\u0003');
    request.startTimer=setTimeout(()=>{
      if(this.activeExecution!==request)return;
      this.write(`${framed}\r`);
      request.timer=setTimeout(()=>{this.write('\u0003');this.#finishExecution(new Error(`Terminal command timed out after ${Math.ceil(request.timeout/1000)} seconds.`))},request.timeout);
    },140);
  }

  #inspectExecution(data){
    const request=this.activeExecution;if(!request)return;
    this.executionBuffer=(this.executionBuffer+data).slice(-262144);
    const match=this.executionBuffer.match(new RegExp(`${request.end}:(\\d+)`));if(!match)return;
    const start=this.executionBuffer.lastIndexOf(request.begin),end=this.executionBuffer.lastIndexOf(request.end);
    const output=start>=0?this.executionBuffer.slice(start+request.begin.length,end).replace(/^\s+|\s+$/g,''):'';
    this.#finishExecution(null,{output,code:Number(match[1])});
  }

  #abortExecution(request){
    if(this.activeExecution===request){this.write('\u0003');this.#finishExecution(new DOMException('System action cancelled.','AbortError'));return}
    const index=this.executionQueue.indexOf(request);if(index>=0){this.executionQueue.splice(index,1);request.signal?.removeEventListener('abort',request.abort);request.reject(new DOMException('System action cancelled.','AbortError'))}
  }

  #finishExecution(error,result){
    const request=this.activeExecution;if(!request)return;
    clearTimeout(request.startTimer);clearTimeout(request.timer);request.signal?.removeEventListener('abort',request.abort);this.activeExecution=null;this.executionBuffer='';
    error?request.reject(error):request.resolve(result);setTimeout(()=>this.#nextExecution(),error?180:0);
  }
}
