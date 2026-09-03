const ROOTS=['/home/future','/home/future/Desktop','/home/future/Documents','/home/future/Downloads','/home/future/Pictures','/mnt/future'];
const cleanPath=value=>{let path=String(value||'/home/future').trim().replace(/\/{2,}/g,'/');if(!path.startsWith('/'))path=`/${path}`;return path.length>1?path.replace(/\/$/,''):path};
const parentOf=path=>path.split('/').slice(0,-1).join('/')||'/';
const basename=path=>path.split('/').filter(Boolean).at(-1)||path;
const uriFor=path=>`future://files${cleanPath(path)}`;
const pathFrom=uri=>cleanPath(String(uri).slice('future://files'.length));
const fileEntity=(path,entry={})=>{
  path=cleanPath(path);const type=entry.type==='directory'?'folder':'file',isRoot=ROOTS.includes(path)&&['/home/future','/mnt/future'].includes(path),relationships=isRoot?[]:[{predicate:'containedBy',target:uriFor(parentOf(path))}],actions=[{id:'file.open',label:'Open item',tool:'future_files',operation:'open',risk:'safe',mutates:false,parameters:{path}}];
  if(!isRoot)actions.push({id:'file.rename',label:'Rename item',tool:'future_files',operation:'rename',risk:'safe',mutates:true,parameters:{path}},{id:'file.move',label:'Move item',tool:'future_files',operation:'move',risk:'safe',mutates:true,parameters:{path}},{id:'file.delete',label:'Move item to Trash',tool:'future_files',operation:'delete',risk:'high',mutates:true,parameters:{path}});
  if(type==='file')actions.splice(1,0,{id:'file.read',label:'Read file',tool:'future_files',operation:'read_file',risk:'safe',mutates:false,parameters:{path}});
  return{uri:uriFor(path),type:`filesystem.${type}`,appId:'files',id:path,title:entry.name||basename(path),subtitle:path,properties:{path,kind:type,size:Number(entry.size)||0,modified:Number(entry.modified)||0},updatedAt:Number(entry.modified)||0,relationships,actions};
};

export const createFileEntityProviders=system=>['filesystem.file','filesystem.folder'].map(type=>({
  type,appId:'files',label:type==='filesystem.file'?'Files':'Folders',owns:uri=>String(uri).startsWith('future://files/'),
  async search({query,filters,limit}){
    const scope=cleanPath(filters.path||'/home/future'),directories=[scope,...ROOTS.filter(path=>path!==scope)],needle=String(query||'').toLowerCase(),results=[],seen=new Set();
    for(const directory of directories){
      let entries=[];try{entries=await system.list(directory,{instant:true,timeout:8000})}catch{}
      for(const entry of entries){const path=cleanPath(`${directory}/${entry.name}`),entity=fileEntity(path,entry);if(entity.type!==type||seen.has(entity.uri)||needle&&!`${entity.title} ${path}`.toLowerCase().includes(needle))continue;seen.add(entity.uri);results.push(entity);if(results.length>=limit)return results}
    }
    if(type==='filesystem.folder'&&!needle&&results.length<limit&&!seen.has(uriFor(scope)))results.unshift(fileEntity(scope,{name:basename(scope),type:'directory'}));
    return results.slice(0,limit);
  },
  async get(uri){const path=pathFrom(uri),parent=parentOf(path);if(['/home/future','/mnt/future'].includes(path))return type==='filesystem.folder'?fileEntity(path,{name:basename(path),type:'directory'}):null;let entries=[];try{entries=await system.list(parent,{instant:false,timeout:12000})}catch{return null}const entry=entries.find(item=>item.name===basename(path));if(!entry)return null;const entity=fileEntity(path,entry);return entity.type===type?entity:null},
  async related(entity){if(entity.relationships[0]?.target){const parentPath=pathFrom(entity.relationships[0].target);return[fileEntity(parentPath,{name:basename(parentPath),type:'directory'})]}return[]},
}));
