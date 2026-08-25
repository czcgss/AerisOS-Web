const DATABASE='future-skill-packages';
const LEGACY_STORE='packages';
const FILE_STORE='files';

const transactionDone=transaction=>new Promise((resolve,reject)=>{
  transaction.oncomplete=()=>resolve();
  transaction.onerror=()=>reject(transaction.error);
  transaction.onabort=()=>reject(transaction.error||new Error('Skill file transaction was aborted.'));
});
const requestResult=request=>new Promise((resolve,reject)=>{
  request.onsuccess=()=>resolve(request.result||null);
  request.onerror=()=>reject(request.error);
});
const fileId=(skill,path)=>`${skill}\u0000${path}`;

export class SkillPackageStore {
  constructor({databaseName=DATABASE}={}){this.databaseName=databaseName;this.database=null}

  async open(){
    if(this.database)return this.database;
    this.database=await new Promise((resolve,reject)=>{
      const request=indexedDB.open(this.databaseName,2);
      request.onupgradeneeded=()=>{
        const database=request.result,transaction=request.transaction;
        if(!database.objectStoreNames.contains(LEGACY_STORE))database.createObjectStore(LEGACY_STORE,{keyPath:'name'});
        const files=database.objectStoreNames.contains(FILE_STORE)?transaction.objectStore(FILE_STORE):database.createObjectStore(FILE_STORE,{keyPath:'id'});
        if(!files.indexNames.contains('skill'))files.createIndex('skill','skill',{unique:false});
        if(request.oldVersion<2&&database.objectStoreNames.contains(LEGACY_STORE))transaction.objectStore(LEGACY_STORE).openCursor().onsuccess=event=>{
          const cursor=event.target.result;if(!cursor)return;
          for(const [path,file] of Object.entries(cursor.value.files||{}))files.put({id:fileId(cursor.value.name,path),skill:cursor.value.name,path,bytes:file.bytes,type:file.type,size:file.size});
          cursor.continue();
        };
      };
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
    });
    return this.database;
  }

  async legacyMetadata(){
    const database=await this.open();
    if(!database.objectStoreNames.contains(LEGACY_STORE))return[];
    const packages=await requestResult(database.transaction(LEGACY_STORE,'readonly').objectStore(LEGACY_STORE).getAll())||[];
    return packages.map(skill=>({name:skill.name,description:skill.description,filePath:skill.filePath,files:Object.fromEntries(Object.entries(skill.files||{}).map(([path,file])=>[path,{type:file.type,size:file.size}]))}));
  }

  async put(skillPackage){
    const database=await this.open(),transaction=database.transaction(FILE_STORE,'readwrite'),store=transaction.objectStore(FILE_STORE);
    const done=transactionDone(transaction),request=store.index('skill').openKeyCursor(IDBKeyRange.only(skillPackage.name));
    request.onsuccess=()=>{const cursor=request.result;if(cursor){store.delete(cursor.primaryKey);cursor.continue();return}for(const [path,file] of Object.entries(skillPackage.files||{}))store.put({id:fileId(skillPackage.name,path),skill:skillPackage.name,path,bytes:file.bytes,type:file.type,size:file.size})};
    await done;return skillPackage.name;
  }

  async read(skill,path){
    const database=await this.open(),record=await requestResult(database.transaction(FILE_STORE,'readonly').objectStore(FILE_STORE).get(fileId(String(skill),String(path))));
    return record?{bytes:record.bytes,type:record.type,size:record.size}:null;
  }

  async readAll(skill){
    const database=await this.open(),records=await requestResult(database.transaction(FILE_STORE,'readonly').objectStore(FILE_STORE).index('skill').getAll(IDBKeyRange.only(String(skill))))||[];
    return Object.fromEntries(records.map(record=>[record.path,{bytes:record.bytes,type:record.type,size:record.size}]));
  }

  async delete(name){
    const database=await this.open(),transaction=database.transaction(FILE_STORE,'readwrite'),store=transaction.objectStore(FILE_STORE),request=store.index('skill').openKeyCursor(IDBKeyRange.only(String(name)));
    request.onsuccess=()=>{const cursor=request.result;if(!cursor)return;store.delete(cursor.primaryKey);cursor.continue()};
    await transactionDone(transaction);
  }

  async clear(){
    const database=await this.open(),stores=[LEGACY_STORE,FILE_STORE].filter(name=>database.objectStoreNames.contains(name)),transaction=database.transaction(stores,'readwrite');
    for(const name of stores)transaction.objectStore(name).clear();await transactionDone(transaction)
  }

  async deleteDatabase(){
    this.database?.close();this.database=null;
    return new Promise((resolve,reject)=>{const request=indexedDB.deleteDatabase(this.databaseName);request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);request.onblocked=()=>reject(new Error('Close other FutureOS tabs before clearing Skill data.'))})
  }
}
