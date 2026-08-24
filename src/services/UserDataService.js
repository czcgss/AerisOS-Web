const BASE='/home/aeris/.local/share/aeris';
const PENDING_DELETE_KEY='aeris.userdata.pending-delete.v1';
export class UserDataService {
  constructor(system,storage=localStorage){this.system=system;this.storage=storage;this.cache=new Map()}
  async start(){this.offGuestReady=this.kernel.bus.on('guest:ready',()=>this.#flushDeletes());this.#flushDeletes();this.kernel.bus.emit('userdata:ready')}
  stop(){this.offGuestReady?.();this.offGuestReady=null}
  #key(name){return `aeris.userdata.${name}`}
  #pending(){try{return new Set(JSON.parse(this.storage.getItem(PENDING_DELETE_KEY)||'[]'))}catch{return new Set()}}
  #savePending(value){value.size?this.storage.setItem(PENDING_DELETE_KEY,JSON.stringify([...value])):this.storage.removeItem(PENDING_DELETE_KEY)}
  async load(name,fallback=[]){
    if(this.cache.has(name))return structuredClone(this.cache.get(name));
    let value=fallback,found=false;
    try{const stored=this.storage.getItem(this.#key(name));if(stored!==null){value=JSON.parse(stored);found=true}}catch{}
    if(!found&&this.system.ready&&!this.#pending().has(name))try{value=JSON.parse(await this.system.read(`${BASE}/${name}.json`));this.storage.setItem(this.#key(name),JSON.stringify(value))}catch{}
    this.cache.set(name,structuredClone(value));return structuredClone(value)
  }
  async save(name,value,{source='system'}={}){
    const copy=structuredClone(value);this.cache.set(name,copy);this.storage.setItem(this.#key(name),JSON.stringify(copy));
    this.kernel.bus.emit('userdata:change',{name,source});return structuredClone(copy)
  }
  async remove(name,{source='app-uninstall'}={}){
    name=String(name);this.cache.delete(name);this.storage.removeItem(this.#key(name));const pending=this.#pending();pending.add(name);this.#savePending(pending);
    await this.#flushDeletes();this.kernel?.bus.emit('userdata:change',{name,source,removed:true});return true
  }
  async #flushDeletes(){
    if(!this.system.ready)return;const pending=this.#pending();
    for(const name of [...pending])try{await this.system.remove(`${BASE}/${name}.json`);pending.delete(name)}catch{}
    this.#savePending(pending)
  }
}
