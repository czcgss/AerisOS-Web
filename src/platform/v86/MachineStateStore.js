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

  async load(profile) {
    const database = await this.open();
    return new Promise((resolve, reject) => {
      const request = database.transaction(this.storeName, 'readonly').objectStore(this.storeName).get(profile);
      request.onsuccess = async () => {
        const record=request.result;if(!record)return resolve(null);
        if(!record.compressed)return resolve(record.state);
        try{resolve(await new Response(new Blob([record.state]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())}
        catch(error){reject(error)}
      };
      request.onerror = () => reject(request.error);
    });
  }

  async save(profile, state) {
    const database = await this.open();
    let storedState=state,compressed=false;
    if('CompressionStream' in globalThis){storedState=await new Response(new Blob([state]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();compressed=true}
    return new Promise((resolve, reject) => {
      const request = database.transaction(this.storeName, 'readwrite').objectStore(this.storeName).put({ profile, state:storedState, compressed, updatedAt: Date.now() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
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
