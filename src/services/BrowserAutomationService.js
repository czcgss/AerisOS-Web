const DEFAULT_ENDPOINT='/api/browser';

export class BrowserAutomationService{
  constructor({endpoint=DEFAULT_ENDPOINT,fetcher=globalThis.fetch}={}){this.endpoint=endpoint.replace(/\/$/,'');this.fetcher=fetcher;this.state={state:'idle',operations:[],tools:[],error:''}}
  start(){}
  snapshot(){return structuredClone(this.state)}
  async capabilities({connect=false,signal}={}){return this.#request(`/capabilities${connect?'?connect=1':''}`,{signal})}
  async execute(operation,args={},signal){
    this.#set({...this.state,state:'connecting',error:''});
    try{const result=await this.#request('/actions',{method:'POST',body:JSON.stringify({operation,args}),signal});this.#set({...this.state,state:'ready',error:''});return result}
    catch(error){this.#set({...this.state,state:'failed',error:error.message});throw error}
  }
  async disconnect(signal){const result=await this.#request('/session',{method:'DELETE',signal});this.#set({state:'idle',operations:[],tools:[],error:''});return result}
  async #request(path,options={}){
    let response;try{response=await this.fetcher(`${this.endpoint}${path}`,{headers:{'content-type':'application/json'},...options})}catch(error){throw new Error(`Aeris backend is unavailable: ${error.message}`)}
    const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload?.error?.message||`Aeris backend request failed (${response.status}).`);
    if(path.startsWith('/capabilities'))this.#set(payload);return payload;
  }
  #set(value){this.state={...this.state,...value};this.kernel?.bus.emit('browser-automation:changed',this.snapshot())}
}

export const BROWSER_AUTOMATION_ENDPOINT=DEFAULT_ENDPOINT;
