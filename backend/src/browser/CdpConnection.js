export class CdpConnection{
  constructor(url,{timeout=15000}={}){this.url=url;this.timeout=timeout;this.sequence=0;this.pending=new Map();this.listeners=new Map()}
  async connect(){
    if(this.socket?.readyState===WebSocket.OPEN)return;
    this.socket=new WebSocket(this.url);
    this.socket.onmessage=event=>this.#message(event.data);
    this.socket.onclose=()=>this.#close(new Error('Chromium CDP connection closed.'));
    this.socket.onerror=()=>this.#close(new Error('Chromium CDP connection failed.'));
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Chromium CDP connection timed out.')),this.timeout);this.socket.onopen=()=>{clearTimeout(timer);resolve()};this.socket.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('Chromium CDP connection failed.'))},{once:true})});
  }
  isOpen(){return this.socket?.readyState===WebSocket.OPEN}
  send(method,params={}){
    if(this.socket?.readyState!==WebSocket.OPEN)throw new Error('Chromium CDP is not connected.');
    const id=++this.sequence;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`Chromium CDP timed out while calling ${method}.`))},this.timeout);this.pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value)},reject:error=>{clearTimeout(timer);reject(error)}});this.socket.send(JSON.stringify({id,method,params}))})
  }
  on(method,listener){const listeners=this.listeners.get(method)||new Set();listeners.add(listener);this.listeners.set(method,listeners);return()=>{listeners.delete(listener);if(!listeners.size)this.listeners.delete(method)}}
  close(){this.socket?.close();this.socket=null;this.#close(new Error('Chromium CDP stopped.'))}
  #message(source){let message;try{message=JSON.parse(source)}catch{return}if(message.id==null){for(const listener of this.listeners.get(message.method)||[])try{listener(message.params||{})}catch{}return}const pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);if(message.error)pending.reject(new Error(message.error.message||'Chromium CDP request failed.'));else pending.resolve(message.result)}
  #close(error){for(const pending of this.pending.values())pending.reject(error);this.pending.clear()}
}
