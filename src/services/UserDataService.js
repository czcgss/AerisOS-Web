const BASE='/home/aeris/.local/share/aeris';
export class UserDataService {
  constructor(system,storage=localStorage){this.system=system;this.storage=storage;this.cache=new Map()}
  async start(){this.kernel.bus.emit('userdata:ready')}
  #key(name){return `aeris.userdata.${name}`}
  async load(name,fallback=[]){
    if(this.cache.has(name))return structuredClone(this.cache.get(name));
    let value=fallback,found=false;
    try{const stored=this.storage.getItem(this.#key(name));if(stored!==null){value=JSON.parse(stored);found=true}}catch{}
    if(!found&&this.system.ready)try{value=JSON.parse(await this.system.read(`${BASE}/${name}.json`));this.storage.setItem(this.#key(name),JSON.stringify(value))}catch{}
    this.cache.set(name,structuredClone(value));return structuredClone(value)
  }
  async save(name,value,{source='system'}={}){
    const copy=structuredClone(value);this.cache.set(name,copy);this.storage.setItem(this.#key(name),JSON.stringify(copy));
    this.kernel.bus.emit('userdata:change',{name,source});return structuredClone(copy)
  }
}
