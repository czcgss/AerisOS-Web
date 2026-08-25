const STORAGE_KEY='aeris.operation-history.v1';
const MAX_RECORDS=300;
const clone=value=>structuredClone(value);

export class OperationHistoryService{
  constructor(storage=globalThis.localStorage){this.storage=storage;this.records=[];this.undoHandlers=new Map()}
  start(){try{const value=JSON.parse(this.storage?.getItem(STORAGE_KEY)||'[]');this.records=Array.isArray(value)?value.slice(0,MAX_RECORDS):[]}catch{this.records=[]}this.#emit()}
  register(name,handler){if(typeof handler==='function')this.undoHandlers.set(String(name),handler)}
  snapshot(){return{records:clone(this.records),undoable:this.records.filter(record=>record.undoable&&record.status==='completed').length}}
  record(value={}){const stamp=Date.now(),record={id:crypto.randomUUID(),status:'completed',source:'agent',createdAt:stamp,updatedAt:stamp,undoable:false,...clone(value)};this.records.unshift(record);this.records=this.records.slice(0,MAX_RECORDS);this.#save();return clone(record)}
  async undo(id){const record=this.records.find(item=>item.id===id);if(!record||!record.undoable||record.status!=='completed')throw new Error('This operation can no longer be undone.');const handler=this.undoHandlers.get(record.definitionName);if(!handler)throw new Error('The undo handler is unavailable.');record.status='undoing';record.updatedAt=Date.now();this.#save();try{const result=await handler(clone(record.result),clone(record.params),clone(record));record.status='undone';record.undoneAt=Date.now();record.undoResult=clone(result);record.updatedAt=Date.now();this.#save();return clone(record)}catch(error){record.status='undo_failed';record.error=error.message||String(error);record.updatedAt=Date.now();this.#save();throw error}}
  clear(){this.records=[];this.#save()}
  #save(){try{this.storage?.setItem(STORAGE_KEY,JSON.stringify(this.records))}catch(error){this.kernel?.bus.emit('operation-history:storage-error',{error:error.message||String(error)})}this.#emit()}
  #emit(){this.kernel?.bus.emit('operation-history:changed',this.snapshot())}
}
