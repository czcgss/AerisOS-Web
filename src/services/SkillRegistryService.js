import { Type } from '@earendil-works/pi-ai';
import { formatSkillInvocation, formatSkillsForSystemPrompt } from '@earendil-works/pi-agent-core';

const STORAGE_KEY='future.ai.skills.v1';
const MAX_FILES=250;
const MAX_FILE_BYTES=5*1024*1024;
const MAX_PACKAGE_BYTES=15*1024*1024;
const TEXT_FILE=/\.(?:md|markdown|txt|py|json|ya?ml|toml|csv|tsv|xml|html?|css|js|mjs|cjs|svg)$/i;
const result=(text,details={})=>({content:[{type:'text',text}],details});
const safePath=value=>{
  const path=String(value||'').replace(/\\/g,'/').replace(/^\/+|\/+$/g,''),parts=path.split('/');
  if(!path||parts.some(part=>!part||part==='.'||part==='..'))throw new Error(`Invalid Skill file path: ${value}`);
  return path;
};
const parseSkill=raw=>{
  const source=String(raw||'').replace(/\r\n?/g,'\n'),match=source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if(!match)throw new Error('Skill file requires YAML frontmatter.');
  const field=key=>match[1].match(new RegExp(`^${key}:\\s*(.+)$`,'m'))?.[1]?.trim().replace(/^['"]|['"]$/g,'')||'';
  const name=field('name'),description=field('description'),content=match[2].trim();
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)||!description||!content)throw new Error('Skill requires a lowercase hyphenated name, description, and instructions.');
  return{name,description,content};
};

export class SkillRegistryService {
  constructor({storage=globalThis.localStorage,bundledSkills=[],packageStore=null,pythonRuntime=null}={}){
    this.storage=storage;this.packageStore=packageStore;this.pythonRuntime=pythonRuntime;this.approvalService=null;
    this.skills=new Map(bundledSkills.map(skill=>[skill.name,{...skill,bundled:true,enabled:true,files:null,pythonScripts:[],legacy:false}]));this.loadedBySession=new Map();
  }

  async start(){
    const raw=this.storage?.getItem(STORAGE_KEY);let saved={};try{saved=JSON.parse(raw||'{}')}catch{}
    const disabled=new Set(saved.disabled||[]);
    for(const skill of this.skills.values())skill.enabled=!disabled.has(skill.name);
    for(const skill of saved.imported||[])if(skill?.name&&!this.skills.has(skill.name))this.skills.set(skill.name,{...skill,bundled:false,enabled:!disabled.has(skill.name),tools:[],files:null,pythonScripts:[],legacy:true});
    let packages=saved.packages||[],migrated=false;
    if(raw&&saved.packagesVersion!==1&&this.packageStore)try{packages=await this.packageStore.legacyMetadata();migrated=true}catch(error){this.kernel?.bus.emit('skill:storage-error',{error:error.message})}
    for(const metadata of packages){const skill=this.#record({...metadata,content:null},!disabled.has(metadata.name));if(!this.skills.get(skill.name)?.bundled)this.skills.set(skill.name,skill)}
    if(migrated)this.#persist();
  }

  setApprovalService(service){this.approvalService=service}
  registerBundled(skill){if(!skill?.name)throw new Error('Built-in Skill requires a name.');if(this.skills.has(skill.name))throw new Error(`Skill is already registered: ${skill.name}`);this.skills.set(skill.name,{...skill,bundled:true,enabled:true,files:null,pythonScripts:[],legacy:false});return skill}
  list(){return [...this.skills.values()].map(skill=>({name:skill.name,description:skill.description,filePath:skill.filePath,bundled:skill.bundled,enabled:skill.enabled,toolCount:(skill.tools?.length||0)+(this.#hasResources(skill)?1:0)+(skill.pythonScripts?.length?1:0),fileCount:skill.files?Object.keys(skill.files).length:1,python:!!skill.pythonScripts?.length}));}
  toolMetadata(name){
    if(name==='future_load_skill')return{kind:'loader',skillName:'',label:'Load Skill'};
    for(const skill of this.skills.values()){
      if(this.#pythonToolName(skill)===name&&skill.pythonScripts?.length)return{kind:'skill',skillName:skill.name,label:`${skill.name} Python`};
      if(this.#resourceToolName(skill)===name&&this.#hasResources(skill))return{kind:'skill',skillName:skill.name,label:`${skill.name} resources`};
      const tool=(skill.tools||[]).find(item=>item.name===name);if(tool)return{kind:'skill',skillName:skill.name,label:tool.label||name};
    }
    return null;
  }
  enabledSkills(){return [...this.skills.values()].filter(skill=>skill.enabled).sort((a,b)=>a.name.localeCompare(b.name)).map(skill=>({name:skill.name,description:skill.description,content:skill.content,filePath:skill.filePath,disableModelInvocation:false}));}
  prompt(){const catalog=formatSkillsForSystemPrompt(this.enabledSkills());return catalog?`${catalog}\n\nUse the future_load_skill tool to read a matching skill before following it. Skill-owned tools become available only after that load completes.`:'';}
  loadedPrompt(sessionId){return [...(this.loadedBySession.get(sessionId)||[])].sort().map(name=>this.skills.get(name)).filter(skill=>skill?.enabled&&skill.content).map(skill=>formatSkillInvocation({...skill,content:this.#invocationContent(skill)})).join('\n\n');}

  async load(sessionId,name){
    const skill=this.skills.get(String(name));if(!skill?.enabled)throw new Error(`Skill is unavailable or disabled: ${name}`);
    if(!skill.content){const source=await this.readText(skill.name,'SKILL.md'),parsed=parseSkill(source);skill.content=parsed.content}
    const loaded=this.loadedBySession.get(sessionId)||new Set();loaded.add(skill.name);this.loadedBySession.set(sessionId,loaded);this.kernel?.bus.emit('skill:loaded',{sessionId,name:skill.name});return skill;
  }

  async ensureSession(sessionId){for(const name of this.loadedBySession.get(sessionId)||[])await this.load(sessionId,name)}

  restoreSession(sessionId,names=[]){
    const loaded=new Set((names||[]).map(String).filter(name=>this.skills.get(name)?.enabled));
    if(loaded.size)this.loadedBySession.set(sessionId,loaded);else this.loadedBySession.delete(sessionId);
    return [...loaded];
  }

  setEnabled(name,enabled){
    const skill=this.skills.get(name);if(!skill)throw new Error(`Unknown skill: ${name}`);skill.enabled=!!enabled;
    if(!skill.enabled)for(const loaded of this.loadedBySession.values())loaded.delete(name);
    this.#persist();this.kernel?.bus.emit('skill:changed',{name,enabled:skill.enabled});return skill.enabled;
  }

  install(raw){
    const parsed=parseSkill(raw);if(this.skills.has(parsed.name))throw new Error(`Skill is already installed: ${parsed.name}`);
    this.skills.set(parsed.name,{name:parsed.name,description:parsed.description,content:parsed.content,filePath:`future://skills/${parsed.name}/SKILL.md`,bundled:false,enabled:true,tools:[],files:null,pythonScripts:[],legacy:true});this.#persist();this.kernel?.bus.emit('skill:changed',{name:parsed.name,enabled:true,installed:true});return parsed.name;
  }

  async installPackage(entries){
    if(!this.packageStore)throw new Error('Skill package storage is unavailable.');
    const files=this.#normalisePackage(entries),skillFile=files['SKILL.md'];
    if(!skillFile)throw new Error('The selected folder must contain SKILL.md at its root.');
    const parsed=parseSkill(new TextDecoder().decode(skillFile.bytes)),existing=this.skills.get(parsed.name);
    if(existing?.bundled)throw new Error(`A built-in Skill already uses this name: ${parsed.name}`);
    const skillPackage={name:parsed.name,description:parsed.description,content:parsed.content,filePath:`future://skills/${parsed.name}/SKILL.md`,files,installedAt:Date.now()};
    const enabled=existing?.enabled??true;await this.packageStore.put(skillPackage);this.skills.set(parsed.name,this.#record(skillPackage,enabled));this.#persist();this.kernel?.bus.emit('skill:changed',{name:parsed.name,enabled,installed:!existing,updated:!!existing,package:true});return parsed.name;
  }

  async uninstall(name){
    const skill=this.skills.get(String(name));if(!skill)throw new Error(`Unknown skill: ${name}`);if(skill.bundled)throw new Error('Built-in Skills cannot be uninstalled.');
    if(skill.files&&this.packageStore)await this.packageStore.delete(skill.name);this.skills.delete(skill.name);for(const loaded of this.loadedBySession.values())loaded.delete(skill.name);this.#persist();this.kernel?.bus.emit('skill:changed',{name:skill.name,uninstalled:true});
  }

  async readText(name,path){
    const skill=this.skills.get(String(name));if(!skill)throw new Error(`Unknown skill: ${name}`);const relative=safePath(path),metadata=skill.files?.[relative];if(!metadata)throw new Error(`Skill resource was not found: ${relative}`);if(!TEXT_FILE.test(relative))throw new Error(`Skill resource is not a text file: ${relative}`);const file=await this.packageStore?.read(skill.name,relative);if(!file)throw new Error(`Skill resource was not found: ${relative}`);return new TextDecoder().decode(file.bytes);
  }

  async inspectPackage(name,path=''){
    const skill=this.skills.get(String(name));if(!skill)throw new Error(`Unknown skill: ${name}`);const relative=String(path||'').trim();
    if(relative){if(relative==='SKILL.md'){if(skill.content)return`---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n${skill.content}`;return this.readText(skill.name,'SKILL.md')}if(!skill.files)throw new Error(`Built-in Skill resource inspection is unavailable: ${relative}`);return this.readText(skill.name,relative)}
    if(skill.bundled||skill.legacy)return{name:skill.name,description:skill.description,instructions:skill.content,files:{},builtIn:skill.bundled};
    const stored=await this.packageStore.readAll(skill.name),files={};for(const [file,entry] of Object.entries(stored)){if(file==='SKILL.md')continue;files[file]=TEXT_FILE.test(file)?new TextDecoder().decode(entry.bytes):{binary:true,type:entry.type,size:entry.size}}
    return{name:skill.name,description:skill.description,instructions:skill.content||parseSkill(new TextDecoder().decode(stored['SKILL.md']?.bytes||new Uint8Array())).content,files,builtIn:false};
  }

  agentTools(sessionId,onChanged,owner={}){
    const loaded=this.loadedBySession.get(sessionId)||new Set();this.loadedBySession.set(sessionId,loaded);
    const loadTool={name:'future_load_skill',label:'Load Future skill',description:'Load the full instructions and native tools for one enabled Future skill before performing the matching specialized task.',parameters:Type.Object({name:Type.String({description:'Exact skill name from available_skills.'})},{additionalProperties:false}),executionMode:'sequential',execute:async(_toolCallId,{name})=>{const skill=await this.load(sessionId,name);onChanged?.();const tools=[...(skill.tools||[]).map(tool=>tool.name),...(this.#hasResources(skill)?[this.#resourceToolName(skill)]:[]),...(skill.pythonScripts?.length?[this.#pythonToolName(skill)]:[])];return result(formatSkillInvocation({...skill,content:this.#invocationContent(skill)}),{skillId:skill.name,operation:'load',phase:'completed',result:{name:skill.name,tools}})}};
    const active=[...loaded].map(name=>this.skills.get(name)).filter(skill=>skill?.enabled),owned=active.flatMap(skill=>skill.tools||[]).map(tool=>typeof tool.forSession==='function'?tool.forSession(sessionId):tool),resources=active.filter(skill=>this.#hasResources(skill)).map(skill=>this.#resourceTool(skill)),python=active.filter(skill=>skill.pythonScripts?.length).map(skill=>this.#pythonTool(skill));
    const tools=[loadTool,...owned,...resources,...python];return this.approvalService?.bindOwner?tools.map(tool=>this.approvalService.bindOwner(tool,{sessionId,...owner})):tools;
  }

  clearSession(sessionId){this.loadedBySession.delete(sessionId)}

  async clearData(){
    this.loadedBySession.clear();for(const [name,skill] of [...this.skills]){if(skill.bundled)skill.enabled=true;else this.skills.delete(name)}
    await this.packageStore?.clear?.();this.storage?.removeItem(STORAGE_KEY);this.kernel?.bus.emit('skill:changed',{cleared:true})
  }

  async deleteData(){
    this.loadedBySession.clear();
    await this.packageStore?.deleteDatabase?.();
    this.storage?.removeItem(STORAGE_KEY);
    this.kernel?.bus.emit('skill:changed',{cleared:true});
  }

  #pythonTool(skill){
    const name=this.#pythonToolName(skill),scripts=skill.pythonScripts.join(', '),optional=description=>Type.Optional(Type.String({description}));
    return{name,label:`Run ${skill.name} Python`,description:`Run one Python script included with the loaded ${skill.name} Skill. Available scripts: ${scripts}. Input and output use JSON.`,executionMode:'sequential',parameters:Type.Object({script:Type.String({description:`Exact script path. Available: ${scripts}`}),inputJson:optional('JSON value passed to main(input). Defaults to an empty object.')},{additionalProperties:false}),execute:async(toolCallId,{script,inputJson},signal,onUpdate)=>{
      const path=safePath(script);if(!skill.pythonScripts.includes(path))throw new Error(`Python script is not available in ${skill.name}: ${path}`);if(!this.pythonRuntime)throw new Error('The Future Python runtime is unavailable.');
      let input={};if(inputJson)try{input=JSON.parse(inputJson)}catch{throw new Error('Python Skill inputJson must contain valid JSON.');}
      if(!this.approvalService)throw new Error('Future approval service is unavailable.');
      const outcome=await this.approvalService.runProtected({toolCallId,name,label:`Run ${skill.name} Python`,appId:'ai',operation:'run_python',params:{skill:skill.name,script:path,input},approvalMessage:`Allow the “${skill.name}” Skill to run ${path} in the browser Python sandbox?`},signal,onUpdate,async()=>{const stored=await this.packageStore.readAll(skill.name);return this.pythonRuntime.execute({skill:skill.name,script:path,input,files:Object.fromEntries(Object.entries(stored).map(([file,entry])=>[file,entry.bytes])),signal})});
      if(!outcome.approved)return result('The user denied the Python Skill execution request.',{...outcome.state,skillId:skill.name});
      const value=outcome.value,output=JSON.stringify(value.value,null,2),logs=[value.stdout&&`stdout:\n${value.stdout}`,value.stderr&&`stderr:\n${value.stderr}`].filter(Boolean).join('\n\n');
      return result([output,logs].filter(Boolean).join('\n\n'),{...outcome.state,skillId:skill.name,result:{skill:skill.name,script:path,value:value.value,stdout:value.stdout,stderr:value.stderr}});
    }};
  }

  #resourceTool(skill){
    const name=this.#resourceToolName(skill),paths=Object.keys(skill.files).filter(path=>path!=='SKILL.md').sort(),optional=description=>Type.Optional(Type.String({description}));
    return{name,label:`Read ${skill.name} resources`,description:`List or read files included with the loaded ${skill.name} Skill.`,executionMode:'parallel',parameters:Type.Object({type:Type.Union([Type.Literal('list'),Type.Literal('read')]),path:optional('Exact package-relative path required for read.')},{additionalProperties:false}),execute:async(_toolCallId,{type,path})=>{
      if(type==='list'){const files=paths.map(file=>({path:file,size:skill.files[file].size,type:skill.files[file].type,text:TEXT_FILE.test(file)}));return result(JSON.stringify(files,null,2),{skillId:skill.name,operation:'list_resources',phase:'completed',result:{files}})}
      const relative=safePath(path);if(relative==='SKILL.md')throw new Error('SKILL.md is already loaded.');const content=await this.readText(skill.name,relative),truncated=content.length>20000;return result(`${content.slice(0,20000)}${truncated?'\n\n[Resource truncated]':''}`,{skillId:skill.name,operation:'read_resource',phase:'completed',result:{path:relative,characters:content.length,truncated}});
    }};
  }

  #pythonToolName(skill){return`future_python_${String(skill.name||'skill').replace(/-/g,'_').slice(0,42)}`}
  #resourceToolName(skill){return`future_resources_${String(skill.name||'skill').replace(/-/g,'_').slice(0,39)}`}
  #hasResources(skill){return Boolean(skill.files&&Object.keys(skill.files).some(path=>path!=='SKILL.md'))}
  #invocationContent(skill){let content=skill.content||'';if(this.#hasResources(skill)){const resources=Object.keys(skill.files).filter(path=>path!=='SKILL.md').sort();content+=`\n\n## Future Skill Resources\nThis Skill package includes: ${resources.join(', ')}. Use the ${this.#resourceToolName(skill)} tool to list or read referenced text resources.`}if(skill.pythonScripts?.length)content+=`\n\n## Future Python Runtime\nThis Skill includes browser-hosted Python scripts: ${skill.pythonScripts.join(', ')}. Use the ${this.#pythonToolName(skill)} tool to run them. Pass the script's input as JSON in inputJson. Python starts only when invoked and is released after 60 seconds of inactivity.`;return content}
  #record(skillPackage,enabled){const files=Object.fromEntries(Object.entries(skillPackage.files||{}).map(([path,file])=>[path,{type:file.type,size:file.size}])),pythonScripts=Object.keys(files).filter(path=>/^scripts\/.+\.py$/i.test(path)).sort();return{...skillPackage,bundled:false,enabled,tools:[],files,pythonScripts,legacy:false}}
  #normalisePackage(entries){
    const source=[...(entries||[])].map(entry=>({path:String(entry.path||entry.webkitRelativePath||entry.name||''),bytes:entry.bytes instanceof Uint8Array?entry.bytes:new Uint8Array(entry.bytes||[]),type:String(entry.type||'application/octet-stream')})).filter(entry=>entry.path&&!/(^|\/)(?:\.git|node_modules|__pycache__)(?:\/|$)|(^|\/)\.DS_Store$/i.test(entry.path));
    if(!source.length)throw new Error('The selected Skill folder is empty.');if(source.length>MAX_FILES)throw new Error(`A Skill package may contain at most ${MAX_FILES} files.`);
    const first=source[0].path.replace(/\\/g,'/').split('/')[0],stripRoot=source.every(entry=>entry.path.replace(/\\/g,'/').startsWith(`${first}/`));let total=0;const files={};
    for(const entry of source){const path=safePath(stripRoot?entry.path.replace(/\\/g,'/').slice(first.length+1):entry.path);if(entry.bytes.byteLength>MAX_FILE_BYTES)throw new Error(`Skill file exceeds 5 MB: ${path}`);total+=entry.bytes.byteLength;if(total>MAX_PACKAGE_BYTES)throw new Error('Skill package exceeds 15 MB.');if(files[path])throw new Error(`Duplicate Skill file: ${path}`);files[path]={bytes:entry.bytes,type:entry.type,size:entry.bytes.byteLength}}
    return files;
  }
  #persist(){const disabled=[...this.skills.values()].filter(skill=>!skill.enabled).map(skill=>skill.name),imported=[...this.skills.values()].filter(skill=>!skill.bundled&&skill.legacy).map(({name,description,content,filePath})=>({name,description,content,filePath})),packages=[...this.skills.values()].filter(skill=>!skill.bundled&&!skill.legacy).map(({name,description,filePath,files})=>({name,description,filePath,files}));this.storage?.setItem(STORAGE_KEY,JSON.stringify({disabled,imported,packages,packagesVersion:1}))}
}
