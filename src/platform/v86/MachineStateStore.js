export class MachineStateStore {
  constructor(databaseName = 'aeris-machine', storeName = 'snapshots') {
    this.databaseName = databaseName;
    this.storeName = storeName;
    this.database = null;
  }

  async open() {
    if (this.database) return this.database;
    this.database = await new Promise((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(this.storeName, { keyPath: 'profile' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.database;
  }

  async #decode(state, compressed) {
    if (!compressed) return state;
    if (!('DecompressionStream' in globalThis)) throw new Error('This browser cannot decompress the saved machine state.');
    return new Response(new Blob([state]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }

  async load(profile) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(profile);
      request.onsuccess = async () => {
        const record=request.result;if(!record)return resolve(null);
        try{resolve({state:await this.#decode(record.state,record.compressed),metadata:record.metadata||null,updatedAt:record.updatedAt||0,legacy:!record.metadata})}
        catch(error){reject(error)}
      };
      request.onerror = () => reject(request.error);
    });
  }

  async save(profile, state, metadata = null) {
    const database = await this.open();
    let storedState=state,compressed=false;
    if('CompressionStream' in globalThis){storedState=await new Response(new Blob([state]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();compressed=true}
    return new Promise((resolve, reject) => {
      const transaction=database.transaction(this.storeName,'readwrite'),store=transaction.objectStore(this.storeName),read=store.get(profile);
      read.onerror=()=>reject(read.error);
      read.onsuccess=()=>{
        const previous=read.result,record={profile,state:storedState,compressed,metadata,updatedAt:Date.now()};
        // Retain one known-older generation. It is deliberately kept in the
        // same record so clearing a machine profile remains an atomic action.
        if(previous?.state){record.previousState=previous.state;record.previousCompressed=!!previous.compressed;record.previousMetadata=previous.metadata||null;record.previousUpdatedAt=previous.updatedAt||0}
        const write=store.put(record);write.onerror=()=>reject(write.error);
      };
      transaction.oncomplete=()=>resolve();
      transaction.onerror=()=>reject(transaction.error);
      transaction.onabort=()=>reject(transaction.error||new Error('The machine snapshot transaction was aborted.'));
    });
  }

  async clear(profile) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(this.storeName, 'readwrite').objectStore(this.storeName).delete(profile);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async info(profile) {
    const database=await this.open();
    const record=await new Promise((resolve,reject)=>{const request=database.transaction(this.storeName,'readonly').objectStore(this.storeName).get(profile);request.onsuccess=()=>resolve(request.result||null);request.onerror=()=>reject(request.error)});
    const estimate=await navigator.storage?.estimate?.().catch(()=>null);
    return {updatedAt:record?.updatedAt||0,size:record?.state?.byteLength||0,compressed:!!record?.compressed,usage:estimate?.usage||0,quota:estimate?.quota||0};
  }
}
