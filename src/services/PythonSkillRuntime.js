const IDLE_TIMEOUT=60000;
const EXECUTION_TIMEOUT=120000;

export class PythonSkillRuntime {
  constructor(){this.worker=null;this.pending=new Map();this.idleTimer=0;this.busy=false;this.status='idle'}
  start(){}
  stop(){this.terminate('Python runtime stopped.')}
  snapshot(){return{status:this.status,busy:this.busy,active:Boolean(this.worker)}}

  async execute({skill,script,input,files,signal=null,timeout=EXECUTION_TIMEOUT}={}){
    if(this.busy)throw new Error('The Python Skill runtime is already executing a script.');
    if(signal?.aborted)throw new DOMException('Python execution cancelled.','AbortError');
    clearTimeout(this.idleTimer);this.busy=true;
    const worker=this.#worker(),id=crypto.randomUUID();
    this.#status('preparing','Preparing Python runtime',{skill,script});
    return new Promise((resolve,reject)=>{
      let settled=false;
      const finish=(callback,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);this.pending.delete(id);this.busy=false;if(this.worker){this.#status('idle','Python runtime ready',{skill,script});this.#scheduleIdle()}callback(value)};
      const cancel=(error,status)=>{this.worker?.terminate();this.worker=null;finish(reject,error);this.#status(status,error.message,{skill,script})};
      const abort=()=>cancel(new DOMException('Python execution cancelled.','AbortError'),'stopped');
      const timer=setTimeout(()=>cancel(new Error(`Python script timed out after ${Math.ceil(timeout/1000)} seconds.`),'failed'),timeout);
      this.pending.set(id,{resolve:value=>finish(resolve,value),reject:error=>finish(reject,error),skill,script});
      signal?.addEventListener('abort',abort,{once:true});
      worker.postMessage({type:'execute',id,skill,script,input,files});
    });
  }

  terminate(reason='Python runtime released.'){
    clearTimeout(this.idleTimer);this.worker?.terminate();this.worker=null;this.busy=false;
    const error=new Error(reason),requests=[...this.pending.values()];this.pending.clear();for(const request of requests)request.reject(error);
    this.#status('stopped',reason);
  }

  #worker(){
    if(this.worker)return this.worker;
    const worker=new Worker(new URL('../workers/PythonSkillWorker.js',import.meta.url),{type:'module',name:'future-python-skill-runtime'});
    worker.onmessage=event=>this.#message(event.data||{});
    worker.onerror=event=>{const error=new Error(event.message||'Python runtime failed.'),requests=[...this.pending.values()];this.pending.clear();this.worker?.terminate();this.worker=null;this.busy=false;for(const request of requests)request.reject(error);this.#status('failed',error.message)};
    this.worker=worker;return worker;
  }

  #message(message){
    const request=this.pending.get(message.id);
    if(message.type==='status'){this.#status(message.phase,message.message,{skill:request?.skill,script:request?.script});return}
    if(!request)return;
    if(message.type==='result')request.resolve(message.result);
    else if(message.type==='error')request.reject(new Error(message.error||'Python script failed.'));
  }

  #scheduleIdle(){clearTimeout(this.idleTimer);if(this.worker)this.idleTimer=setTimeout(()=>this.terminate('Python runtime released after 60 seconds of inactivity.'),IDLE_TIMEOUT)}
  #status(status,message,detail={}){this.status=status;this.kernel?.bus.emit('python-runtime:status',{status,message,...detail,active:Boolean(this.worker),busy:this.busy})}
}
