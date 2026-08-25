const DEFAULT_ENDPOINT='/api/browser';

export class BrowserAutomationService{
  constructor({endpoint=DEFAULT_ENDPOINT,fetcher=globalThis.fetch,WebSocketImpl=globalThis.WebSocket}={}){this.endpoint=endpoint.replace(/\/$/,'');this.fetcher=fetcher===globalThis.fetch?fetcher.bind(globalThis):fetcher;this.WebSocketImpl=WebSocketImpl;this.state={state:'idle',operations:[],tools:[],error:''};this.streamListeners=new Set();this.streamAttempts=0}
  start(){}
  snapshot(){return structuredClone(this.state)}
  async capabilities({connect=false,signal}={}){return this.#request(`/capabilities${connect?'?connect=1':''}`,{signal})}
  async execute(operation,args={},signal){
    this.#set({...this.state,state:'connecting',error:''});
    try{const result=await this.#request('/actions',{method:'POST',body:JSON.stringify({operation,args}),signal});this.#set({...this.state,state:'ready',error:''});return result}
    catch(error){this.#set({...this.state,state:'failed',error:error.message});throw error}
  }
  view(signal){return this.#request('/view',{signal})}
  async navigate(url,signal){this.#set({...this.state,state:'connecting',error:''});try{const result=await this.#request('/view/navigate',{method:'POST',body:JSON.stringify({url}),signal});this.#set({...this.state,state:'ready',error:''});return result}catch(error){this.#set({...this.state,state:'failed',error:error.message});throw error}}
  pointer(input,signal){return this.#request('/view/pointer',{method:'POST',body:JSON.stringify(input),signal})}
  key(input,signal){return this.#request('/view/key',{method:'POST',body:JSON.stringify(input),signal})}
  history(direction,signal){return this.#request('/view/history',{method:'POST',body:JSON.stringify({direction}),signal})}
  reload(signal){return this.#request('/view/reload',{method:'POST',body:'{}',signal})}
  async disconnect(signal){const result=await this.#request('/session',{method:'DELETE',signal});this.#set({state:'idle',operations:[],tools:[],error:''});return result}
  subscribe(listener){this.streamListeners.add(listener);this.#connectStream();return()=>{this.streamListeners.delete(listener);if(!this.streamListeners.size)this.#closeStream()}}
  async #request(path,options={}){
    let response;try{response=await this.fetcher(`${this.endpoint}${path}`,{headers:{'content-type':'application/json'},...options})}catch(error){throw new Error(`Future backend is unavailable: ${error.message}`)}
    const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload?.error?.message||`Future backend request failed (${response.status}).`);
    if(path.startsWith('/capabilities'))this.#set(payload);return payload;
  }
  #set(value){this.state={...this.state,...value};this.kernel?.bus.emit('browser-automation:changed',this.snapshot())}
  #connectStream(){
    if(!this.streamListeners.size||[this.WebSocketImpl?.OPEN,this.WebSocketImpl?.CONNECTING].includes(this.socket?.readyState))return;
    const url=new URL(`${this.endpoint}/stream`,globalThis.location?.href||'http://127.0.0.1');url.protocol=url.protocol==='https:'?'wss:':'ws:';this.#set({...this.state,state:'connecting',error:''});
    const socket=this.socket=new this.WebSocketImpl(url);socket.onopen=()=>{this.streamAttempts=0};socket.onmessage=event=>{let message;try{message=JSON.parse(event.data)}catch{return}if(message.type==='error'){this.#set({...this.state,state:'failed',error:message.message||'Browser stream failed.'});return}this.#set({...this.state,state:'ready',error:''});for(const listener of this.streamListeners)listener(message)};
    socket.onerror=()=>this.#set({...this.state,state:'failed',error:'Browser stream connection failed.'});socket.onclose=()=>{if(this.socket===socket)this.socket=null;if(this.streamListeners.size){const delay=Math.min(5000,500*2**this.streamAttempts++);clearTimeout(this.streamTimer);this.streamTimer=setTimeout(()=>this.#connectStream(),delay)}};
  }
  #closeStream(){clearTimeout(this.streamTimer);this.streamTimer=0;const socket=this.socket;this.socket=null;if(socket&&socket.readyState<2)socket.close()}
}

export const BROWSER_AUTOMATION_ENDPOINT=DEFAULT_ENDPOINT;
