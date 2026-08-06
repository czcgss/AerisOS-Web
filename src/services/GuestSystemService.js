const quote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`;

export class GuestSystemService {
  constructor(machine) { this.machine = machine; this._ready = false; this.listInflight=new Map();this.directoryRevision=new Map();this.directoryCache=this.#loadDirectoryCache();this.#seedDirectoryCache();this.networkTask=null;this.networkState={status:'offline',interface:'eth0',address:'',gateway:'',dns:'',error:''}; }
  get ready(){return this._ready||!!(this.machine.guestReady&&this.machine.status==='running')}
  set ready(value){this._ready=!!value}
  start() {
    this.kernel.bus.on('guest:ready', () => { this.ready = true; this.kernel.bus.emit('system:ready');setTimeout(()=>this.#warmDirectories(),250);setTimeout(()=>this.ensureNetwork({updateRepositories:false}).catch(()=>{}),700); });
    this.kernel.bus.on('machine:status', status => { if (status !== 'running') {this.ready = false;this.#setNetwork({status:'offline',address:'',gateway:'',dns:'',error:''});} });
    addEventListener('online',()=>{if(this.ready)this.ensureNetwork({updateRepositories:false}).catch(()=>{})});
    addEventListener('offline',()=>this.#setNetwork({status:'offline',error:'Host network unavailable'}));
  }
  requireReady() { if (!this.ready || !this.machine.serial) throw new Error(`Linux system service is not ready (${this.machine.status}, guest=${this.machine.guestReady?'yes':'no'})`); }
  async exec(command, timeout) { this.requireReady(); return this.machine.serial.execute(command, timeout); }
  async execInteractive(command, timeout) { this.requireReady(); return this.machine.serial.execute(command, timeout, true); }
  async execChecked(command, timeout) { const result=await this.exec(command,timeout);if(result.code!==0)throw new Error(result.output||`Linux command failed (${result.code})`);return result; }
  writeTerminal(data) { this.machine.sendUserInput(data); this.kernel.bus.emit('terminal:activity'); }

  async processes() {
    const {output}=await this.exec("ps -o pid,stat,comm 2>/dev/null | awk 'NR>1 && NR<34 {printf \"%s,%s,%s;\", $1,$2,$3}'");
    return output.replace(/\s+/g,'').split(';').filter(Boolean).map(row=>row.split(',',3)).filter(x=>x.length===3)
      .map(([pid,status,name])=>({pid,status,name}));
  }

  async list(path = '/mnt/aeris', { priority = false, timeout = 12000, fresh = false, instant = false } = {}) {
    const key=String(path);
    const shared=this.#sharedPath(key);
    if(shared!==null)try{
      const entries=this.machine.listShared(shared);
      if(entries){this.#cacheDirectory(key,entries);return structuredClone(entries)}
    }catch{}
    const cached=this.directoryCache.get(key);
    if(cached&&!fresh){this.#refreshDirectory(key,{priority,timeout}).catch(()=>{});return structuredClone(cached.entries)}
    if(instant&&!fresh){this.#refreshDirectory(key,{priority,timeout}).catch(()=>{});return[]}
    return this.#refreshDirectory(key,{priority,timeout,fresh});
  }

  cachedList(path){const cached=this.directoryCache.get(String(path));return cached?structuredClone(cached.entries):null}
  async #refreshDirectory(path,options={}){const active=this.listInflight.get(path);if(active){if(!options.fresh)return active;await active.catch(()=>{})}const revision=this.directoryRevision.get(path)||0;const request=this.#readDirectory(path,options).then(entries=>{if((this.directoryRevision.get(path)||0)===revision){this.#cacheDirectory(path,entries);this.kernel?.bus.emit('filesystem:list-updated',{path,entries:structuredClone(entries)})}return structuredClone(entries)}).catch(error=>{this.kernel?.bus.emit('filesystem:list-error',{path,error:error.message});throw error}).finally(()=>{if(this.listInflight.get(path)===request)this.listInflight.delete(path)});this.listInflight.set(path,request);return request}
  #loadDirectoryCache(){try{const stored=JSON.parse(localStorage.getItem('aeris.files.directory-cache')||'{}');return new Map(Object.entries(stored).filter(([,value])=>Array.isArray(value?.entries)))}catch{return new Map()}}
  #seedDirectoryCache(){const directory=(name)=>({name,type:'directory',size:0,modified:0}),seeds={'/home/aeris':['Desktop','Documents','Downloads','Pictures'].map(directory),'/home/aeris/Desktop':[],'/home/aeris/Documents':[],'/home/aeris/Downloads':[],'/home/aeris/Pictures':[],'/home/aeris/.local/share/Trash/files':[]};for(const [path,entries] of Object.entries(seeds))if(!this.directoryCache.has(path))this.directoryCache.set(path,{entries,updatedAt:0})}
  #cacheDirectory(path,entries){this.directoryCache.set(path,{entries:structuredClone(entries),updatedAt:Date.now()});const recent=[...this.directoryCache.entries()].sort((a,b)=>(b[1].updatedAt||0)-(a[1].updatedAt||0)).slice(0,60);try{localStorage.setItem('aeris.files.directory-cache',JSON.stringify(Object.fromEntries(recent)))}catch{}}
  #invalidateDirectory(path){const cached=this.directoryCache.get(path);if(cached){cached.updatedAt=0;this.#cacheDirectory(path,cached.entries)}}
  async #warmDirectories(){for(const path of ['/home/aeris','/home/aeris/Desktop','/home/aeris/Documents','/home/aeris/Downloads','/home/aeris/Pictures']){if(!this.ready)break;await this.#refreshDirectory(path,{priority:false,timeout:8000}).catch(()=>{});await new Promise(resolve=>setTimeout(resolve,80))}}

  async #readDirectory(path,{priority,timeout}) {
    const command = `/usr/local/bin/aeris_list ${quote(path)}`;
    let lastError;
    for(let attempt=0;attempt<2;attempt++)try{
      const result=priority?await this.execInteractive(command,timeout+attempt*5000):await this.exec(command,timeout+attempt*5000);
      if(result.code===44)throw new Error(`Directory not found: ${path}`);
      if(result.code!==0)throw new Error(result.output||`Unable to read directory: ${path}`);
      // VGA is a fixed-width text transport, so it may insert visual line wraps
      // in the middle of a filename or protocol marker. aeris_list itself emits
      // no record newlines; removing those wraps restores the original payload.
      const payload=result.output.replace(/[\r\n]/g,'');
      return payload.split('__AERIS_FILE__').slice(1).map(row=>row.split('__AERIS_ROW__')[0]).map(row => { const [name,type,size,modified]=row.split('__AERIS_FIELD__',4); return {name:name?.trim() || '',type:type?.trim(),size:Number(size)||0,modified:Number(modified)||0}; }).filter(entry=>entry.name);
    }catch(error){lastError=error;if(!/timed out/i.test(error.message)||attempt===1)throw error}
    throw lastError;
  }

  async read(path) {
    const shared=this.#sharedPath(path);if(shared!==null)try{return await this.machine.readShared(shared)}catch{}
    // Keep the control channel ASCII-only and decode file bytes explicitly.
    // This works on both the serial and VGA recovery transports.
    const {output}=await this.execChecked(`base64 < ${quote(path)} | tr -d '\n'`,30000),encoded=output.replace(/\s+/g,'');
    const binary=atob(encoded),bytes=new Uint8Array(binary.length);
    for(let index=0;index<binary.length;index++)bytes[index]=binary.charCodeAt(index);
    return new TextDecoder().decode(bytes);
  }
  async write(path, content) { const result=await this.execChecked(`mkdir -p ${quote(path.split('/').slice(0,-1).join('/')||'/')}; printf %s ${quote(content)} > ${quote(path)}`);this.#changed(path);return result; }
  async writeChunked(path, content, chunkSize = 6000) {
    const directory=path.split('/').slice(0,-1).join('/')||'/',temporary=`${path}.aeris-writing`,encodedPath=`${temporary}.b64`;
    const bytes=new TextEncoder().encode(String(content));let binary='';
    for(let offset=0;offset<bytes.length;offset+=32768)binary+=String.fromCharCode(...bytes.subarray(offset,offset+32768));
    const encoded=btoa(binary);
    await this.execChecked(`mkdir -p ${quote(directory)}; : > ${quote(encodedPath)}`,20000);
    try {
      for(let offset=0;offset<encoded.length;offset+=chunkSize)await this.execChecked(`printf %s ${quote(encoded.slice(offset,offset+chunkSize))} >> ${quote(encodedPath)}`,20000);
      const result=await this.execChecked(`base64 -d ${quote(encodedPath)} > ${quote(temporary)} && mv ${quote(temporary)} ${quote(path)} && rm -f ${quote(encodedPath)}`,30000);
      this.#changed(path);return result;
    } catch(error) {
      this.exec(`rm -f ${quote(temporary)} ${quote(encodedPath)}`,5000).catch(()=>{});
      throw error;
    }
  }
  async mkdir(path) { const result=await this.execChecked(`mkdir -p ${quote(path)}`);this.#changed(path);return result; }
  async rename(path, name) { const parent=path.split('/').slice(0,-1).join('/')||'/';const target=`${parent}/${name}`;const result=await this.execChecked(`[ ! -e ${quote(target)} ] && mv ${quote(path)} ${quote(target)}`);this.#changed(target);return target; }
  async copy(path) { const parent=path.split('/').slice(0,-1).join('/')||'/',name=path.split('/').at(-1),stem=name.replace(/(\.[^.]*)$/,''),ext=name.slice(stem.length);let target=`${parent}/${stem} copy${ext}`,index=2;while((await this.exec(`[ -e ${quote(target)} ]`)).code===0)target=`${parent}/${stem} copy ${index++}${ext}`;await this.execChecked(`cp -a ${quote(path)} ${quote(target)}`);this.#changed(target);return target; }
  async move(path, directory) { const target=`${directory}/${path.split('/').at(-1)}`;await this.execChecked(`[ ! -e ${quote(target)} ] && mv ${quote(path)} ${quote(target)}`);this.#changed(path);this.#changed(target);return target; }
  async copyTo(path,directory){let name=path.split('/').at(-1),target=`${directory}/${name}`,index=2;while((await this.exec(`[ -e ${quote(target)} ]`)).code===0){const dot=name.lastIndexOf('.'),stem=dot>0?name.slice(0,dot):name,ext=dot>0?name.slice(dot):'';target=`${directory}/${stem} ${index++}${ext}`}await this.execChecked(`mkdir -p ${quote(directory)}; cp -a ${quote(path)} ${quote(target)}`);this.#changed(target);return target}
  #trashOrigins(){try{return JSON.parse(localStorage.getItem('aeris.trash.origins')||'{}')}catch{return{}}}
  #saveTrashOrigins(value){localStorage.setItem('aeris.trash.origins',JSON.stringify(value))}
  trashOrigin(name){return this.#trashOrigins()[name]||''}
  async trash(path) { const trash='/home/aeris/.local/share/Trash/files',name=path.split('/').at(-1);let target=`${trash}/${name}`,index=2;while((await this.exec(`[ -e ${quote(target)} ]`)).code===0)target=`${trash}/${name} ${index++}`;await this.execChecked(`mkdir -p ${quote(trash)}; mv ${quote(path)} ${quote(target)} && [ ! -e ${quote(path)} ] && [ -e ${quote(target)} ]`);const origins=this.#trashOrigins();origins[target.split('/').at(-1)]=path;this.#saveTrashOrigins(origins);this.#changed(path);this.#changed(target);return target; }
  async restoreTrash(path){const name=path.split('/').at(-1),origins=this.#trashOrigins(),original=origins[name]||`/home/aeris/Desktop/${name}`,parent=original.split('/').slice(0,-1).join('/')||'/';let target=original,index=2;while((await this.exec(`[ -e ${quote(target)} ]`)).code===0)target=`${parent}/${name} restored ${index++}`;await this.execChecked(`mkdir -p ${quote(parent)}; mv ${quote(path)} ${quote(target)}`);delete origins[name];this.#saveTrashOrigins(origins);this.#changed(path);this.#changed(target);return target}
  async emptyTrash(){const trash='/home/aeris/.local/share/Trash/files';await this.execChecked(`find ${quote(trash)} -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +`);this.#saveTrashOrigins({});this.#changed(`${trash}/item`)}
  async remove(path) { const result=await this.execChecked(`rm -rf ${quote(path)}`);this.#changed(path);return result; }
  #sharedPath(path){const value=String(path);if(value==='/mnt/aeris')return'/';if(value.startsWith('/mnt/aeris/'))return value.slice('/mnt/aeris'.length);return null}
  #changed(path){const parent=path.split('/').slice(0,-1).join('/')||'/';this.directoryRevision.set(parent,(this.directoryRevision.get(parent)||0)+1);this.#invalidateDirectory(parent);this.kernel.bus.emit('filesystem:changed',{path:parent});}

  async ensureNetwork({updateRepositories=false}={}) {
    if(this.networkTask)return this.networkTask;
    this.#setNetwork({status:'connecting',error:''});
    const relayPort=/^\d+$/.test(location.port)?location.port:(location.protocol==='http:'?'80':'443'),relayBase=`http://${relayPort}.external/alpine/v3.24`;
    const repositories=`printf '%s\\n' '${relayBase}/main' '${relayBase}/community' > /etc/apk/repositories`;
    const command=`ip link set eth0 up 2>/dev/null || true; ip route | grep -q '^default ' || udhcpc -i eth0 -q -n -t 5 >/dev/null 2>&1; ${repositories}; ip route | grep -q '^default ' ${updateRepositories?'&& apk update >/dev/null':''}`;
    this.networkTask=(async()=>{try{const result=await this.execInteractive(command,updateRepositories?90000:15000);if(result.code!==0)throw new Error(result.output||`Linux network setup failed (${result.code})`);const state=await this.networkInfo();if(state.status!=='connected')throw new Error('The Linux guest did not receive a network route');return state}catch(error){this.#setNetwork({status:'offline',address:'',gateway:'',dns:'',error:error.message});throw error}finally{this.networkTask=null}})();
    return this.networkTask;
  }
  async networkInfo(){
    const command="address=$(ip -4 addr show dev eth0 2>/dev/null | awk '/inet / {sub(/\\/.*/,\"\",$2); print $2; exit}'); gateway=$(ip route 2>/dev/null | awk '/^default / {print $3; exit}'); dns=$(awk '/^nameserver / {print $2; exit}' /etc/resolv.conf 2>/dev/null); printf '__AERIS_NET__%s|%s|%s' \"$address\" \"$gateway\" \"$dns\"";
    try{const {output}=await this.execInteractive(command,8000),payload=output.split('__AERIS_NET__').at(-1)||'', [address='',gateway='',dns='']=payload.trim().split('|',3),status=address&&gateway?'connected':'offline';return this.#setNetwork({status,address,gateway,dns,error:''})}catch(error){return this.#setNetwork({status:'offline',address:'',gateway:'',dns:'',error:error.message})}
  }
  async networkStatus(){return (await this.networkInfo()).status==='connected';}
  #setNetwork(next){this.networkState={...this.networkState,...next};this.kernel?.bus.emit('network:change',{...this.networkState});return {...this.networkState}}
  async installPackage(name){await this.ensureNetwork();return this.execChecked(`apk update >/dev/null && apk add ${quote(name)}`,180000);}
  async configureProfile(profile) {
    const safe={fullName:profile.fullName,region:profile.region,timezone:profile.timezone,keyboardLayout:profile.keyboardLayout,analytics:!!profile.analytics,location:!!profile.location,theme:profile.theme,reduceMotion:!!profile.reduceMotion,completedAt:new Date().toISOString()};
    await this.mkdir('/home/aeris/.config/aeris');await this.write('/home/aeris/.config/aeris/profile.json',JSON.stringify(safe,null,2));
    if(profile.password)await this.exec(`printf '%s:%s\\n' aeris ${quote(profile.password)} | chpasswd 2>/dev/null || true`);
    await this.exec(`[ -w /etc ] && [ -e /usr/share/zoneinfo/${String(profile.timezone).replace(/[^A-Za-z0-9_+\/-]/g,'')} ] && ln -sf /usr/share/zoneinfo/${String(profile.timezone).replace(/[^A-Za-z0-9_+\/-]/g,'')} /etc/localtime || true`);
    return safe;
  }
}
