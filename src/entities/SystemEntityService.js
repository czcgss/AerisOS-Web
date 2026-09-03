const ENTITY_URI=/^future:\/\/[a-z0-9][a-z0-9._-]*(?:\/[^\u0000-\u001f]*)?$/i;
const clone=value=>structuredClone(value);
const clean=value=>String(value??'').trim();
const bounded=(value,limit=12000)=>{const text=clean(value);return text.length>limit?`${text.slice(0,limit)}…`:text};
const plain=value=>value&&typeof value==='object'&&!Array.isArray(value)?clone(value):{};

const normalizeAction=(action,entity)=>{
  if(!action||typeof action!=='object')return null;
  const id=clean(action.id),tool=clean(action.tool),operation=clean(action.operation);
  if(!id||!tool||!operation)return null;
  return{id,label:clean(action.label||id),tool,operation,risk:action.risk==='high'?'high':'safe',mutates:action.mutates!==false,parameters:{...plain(action.parameters),...(action.targetParam?{[clean(action.targetParam)]:entity.id}:{})}};
};

const normalizeRelationship=relationship=>{
  if(!relationship||typeof relationship!=='object')return null;
  const predicate=clean(relationship.predicate),target=clean(relationship.target);
  if(!predicate||!ENTITY_URI.test(target))return null;
  return{predicate,target,...(relationship.label?{label:clean(relationship.label)}:{})};
};

export const normalizeEntity=(value,provider)=>{
  if(!value||typeof value!=='object')throw new Error('Entity providers must return objects.');
  const uri=clean(value.uri),type=clean(value.type||provider.type),appId=clean(value.appId||provider.appId),id=clean(value.id);
  if(!ENTITY_URI.test(uri))throw new Error(`Invalid Future entity URI: ${uri||'(empty)'}`);
  if(!type||!appId||!id)throw new Error(`Entity ${uri} is missing type, appId, or id.`);
  const entity={uri,type,appId,id,title:bounded(value.title||value.name||id,300),subtitle:bounded(value.subtitle,500),properties:plain(value.properties),relationships:(value.relationships||[]).map(normalizeRelationship).filter(Boolean),actions:[]};
  entity.actions=(value.actions||[]).map(action=>normalizeAction(action,entity)).filter(Boolean);
  if(value.updatedAt)entity.updatedAt=Number(value.updatedAt)||0;
  if(value.createdAt)entity.createdAt=Number(value.createdAt)||0;
  return entity;
};

export class SystemEntityService{
  constructor(){this.providers=new Map();this.revision=0}

  start(){
    const changed=(appId,reason,detail={})=>{const types=this.listTypes({appIds:[appId]}).map(item=>item.type);if(!types.length)return;this.revision+=1;this.kernel?.bus.emit('entities:changed',{revision:this.revision,appId,types,reason,...detail})};
    this.offUserdata=this.kernel?.bus.on('userdata:change',detail=>{const appId={calendar:'calendar',notes:'notes',reminders:'reminders',contacts:'contacts',photos:'photos'}[detail?.name];if(appId)changed(appId,'data',{source:detail.source||''})});
    this.offFiles=this.kernel?.bus.on('filesystem:changed',detail=>{const path=clean(detail?.path);changed('files','filesystem',{path});if(path.startsWith('/home/future/Pictures'))changed('photos','filesystem',{path});if(path.startsWith('/mnt/future/Music'))changed('music','filesystem',{path})});
    this.offBrowser=this.kernel?.bus.on('browser:changed',detail=>changed('browser','state',{change:detail?.type||''}));
    this.offMusic=this.kernel?.bus.on('music:changed',()=>changed('music','state'));
    this.offWeather=this.kernel?.bus.on('weather:update',()=>changed('weather','state'));
    this.kernel?.bus.emit('entities:ready',this.snapshot());
  }
  stop(){this.offUserdata?.();this.offFiles?.();this.offBrowser?.();this.offMusic?.();this.offWeather?.();this.offUserdata=null;this.offFiles=null;this.offBrowser=null;this.offMusic=null;this.offWeather=null}
  snapshot(){return{revision:this.revision,types:this.listTypes()}}

  register(provider){
    const type=clean(provider?.type),appId=clean(provider?.appId);
    if(!type||!appId||typeof provider.search!=='function'||typeof provider.get!=='function'||typeof provider.owns!=='function')throw new Error('Entity providers require type, appId, owns, search, and get.');
    if(this.providers.has(type))throw new Error(`Entity provider already registered: ${type}`);
    this.providers.set(type,{...provider,type,appId});this.revision+=1;this.kernel?.bus.emit('entities:changed',{revision:this.revision,appId,types:[type],reason:'provider-registered'});return()=>this.unregister(type);
  }

  unregister(type){type=clean(type);const provider=this.providers.get(type),removed=this.providers.delete(type);if(removed){this.revision+=1;this.kernel?.bus.emit('entities:changed',{revision:this.revision,appId:provider.appId,types:[type],reason:'provider-unregistered'})}return removed}
  listTypes({appIds=[]}={}){const allowed=new Set((appIds||[]).map(String));return[...this.providers.values()].filter(provider=>!allowed.size||allowed.has(provider.appId)).map(provider=>({type:provider.type,appId:provider.appId,label:clean(provider.label||provider.type)})).sort((a,b)=>a.type.localeCompare(b.type))}

  async search({query='',types=[],appIds=[],filters={},limit=20}={}){
    const selected=this.#selectProviders({types,appIds}),boundedLimit=Math.max(1,Math.min(50,Number(limit)||20)),perProvider=Math.max(boundedLimit,Math.ceil(boundedLimit/Math.max(1,selected.length)));
    const settled=await Promise.allSettled(selected.map(async provider=>(await provider.search({query:clean(query),filters:plain(filters),limit:perProvider})).map(value=>normalizeEntity(value,provider))));
    const entities=[],errors=[];
    settled.forEach((result,index)=>{if(result.status==='fulfilled')entities.push(...result.value);else errors.push({type:selected[index].type,message:result.reason?.message||String(result.reason)})});
    const needle=clean(query).toLowerCase(),rank=entity=>{if(!needle)return Number(entity.updatedAt)||0;const title=entity.title.toLowerCase(),subtitle=entity.subtitle.toLowerCase();return title===needle?1e12:title.startsWith(needle)?1e11:title.includes(needle)?1e10:subtitle.includes(needle)?1e9:0};
    entities.sort((a,b)=>rank(b)-rank(a)||a.title.localeCompare(b.title));
    return{entities:entities.slice(0,boundedLimit),types:this.listTypes({appIds}),errors,truncated:entities.length>boundedLimit};
  }

  async get(uri,{appIds=[]}={}){
    const providers=this.#providersFor(uri,appIds);
    if(!providers.length)throw new Error(`No permitted entity provider owns ${clean(uri)}.`);
    for(const provider of providers){const value=await provider.get(clean(uri));if(value)return normalizeEntity(value,provider)}
    throw new Error(`Future entity not found: ${uri}`);
  }

  async related(uri,{relationship='',appIds=[],limit=20}={}){
    const source=await this.get(uri,{appIds}),provider=this.providers.get(source.type),allowed=new Set((appIds||[]).map(String)),predicate=clean(relationship);
    let direct=[];
    if(typeof provider.related==='function')direct=await provider.related(source,{relationship:predicate,limit});
    const normalized=[];
    for(const value of direct){const targetProvider=this.providers.get(value.type)||this.#providersFor(value.uri,appIds)[0];if(!targetProvider||allowed.size&&!allowed.has(targetProvider.appId))continue;normalized.push(normalizeEntity(value,targetProvider))}
    const seen=new Set(normalized.map(entity=>entity.uri)),targets=source.relationships.filter(item=>!predicate||item.predicate===predicate).map(item=>item.target);
    for(const target of targets){
      if(seen.has(target))continue;
      try{const entity=await this.get(target,{appIds:[...allowed]});normalized.push(entity);seen.add(target)}catch{}
      if(normalized.length>=Math.max(1,Math.min(50,Number(limit)||20)))break;
    }
    return{source,entities:normalized.slice(0,Math.max(1,Math.min(50,Number(limit)||20))),relationship:predicate};
  }

  #selectProviders({types=[],appIds=[]}={}){
    const requestedTypes=new Set((types||[]).map(String)),allowedApps=new Set((appIds||[]).map(String));
    return[...this.providers.values()].filter(provider=>(!requestedTypes.size||requestedTypes.has(provider.type))&&(!allowedApps.size||allowedApps.has(provider.appId)));
  }

  #providersFor(uri,appIds=[]){const value=clean(uri),allowed=new Set((appIds||[]).map(String));return[...this.providers.values()].filter(item=>(!allowed.size||allowed.has(item.appId))&&item.owns(value))}
}
