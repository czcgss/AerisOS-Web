const FUTURE_STORAGE_PREFIX='future';

const clearNamespacedStorage=storage=>{
  if(!storage)return;
  const keys=[];
  for(let index=0;index<storage.length;index++){
    const key=storage.key(index);
    if(key===FUTURE_STORAGE_PREFIX||key?.startsWith(`${FUTURE_STORAGE_PREFIX}.`)||key?.startsWith(`${FUTURE_STORAGE_PREFIX}-`))keys.push(key);
  }
  for(const key of keys)storage.removeItem(key);
};

export class FactoryResetService{
  constructor({machine,skillRegistry,browserAutomation,storage=globalThis.localStorage,sessionStorage=globalThis.sessionStorage,reload=()=>globalThis.location.reload()}={}){
    Object.assign(this,{machine,skillRegistry,browserAutomation,storage,sessionStorage,reload});
    this.running=false;
  }

  async reset(){
    if(this.running)return false;
    this.running=true;
    this.kernel?.bus.emit('factory-reset:state',{status:'starting'});
    try{
      await this.browserAutomation?.disconnect?.().catch(()=>{});
      await this.machine?.stop?.(false);
      this.kernel?.bus.emit('factory-reset:state',{status:'clearing-machine'});
      await this.machine?.deletePersistedState?.();
      this.kernel?.bus.emit('factory-reset:state',{status:'clearing-data'});
      await this.skillRegistry?.deleteData?.();
      clearNamespacedStorage(this.storage);
      clearNamespacedStorage(this.sessionStorage);
      this.kernel?.bus.emit('factory-reset:state',{status:'complete'});
      this.reload();
      return true;
    }catch(error){
      this.running=false;
      this.kernel?.bus.emit('factory-reset:state',{status:'failed',error});
      throw error;
    }
  }
}

export {clearNamespacedStorage};
