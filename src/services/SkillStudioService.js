import { Type } from '@earendil-works/pi-ai';

const MAX_FILES=250;
const MAX_FILE_BYTES=5*1024*1024;
const MAX_PACKAGE_BYTES=15*1024*1024;
const NAME=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FORBIDDEN_IMPORT=/(^|\n)\s*(?:from|import)\s+(?:js|pyodide|micropip|webbrowser|socket|subprocess)(?:\s|\.|$)/m;
const result=(text,details={})=>({content:[{type:'text',text}],details});
const required=(input,key)=>{const value=String(input[key]||'').trim();if(!value)throw new Error(`Skill Studio requires ${key}.`);return value};
const safePath=value=>{const path=String(value||'').replace(/\\/g,'/').replace(/^\/+|\/+$/g,''),parts=path.split('/');if(!path||parts.some(part=>!part||part==='.'||part==='..'))throw new Error(`Invalid Skill file path: ${value}`);return path};

export class SkillStudioService {
  constructor(skillRegistry){this.skillRegistry=skillRegistry;this.approvalService=null;this.drafts=new Map()}
  start(){}
  setApprovalService(service){this.approvalService=service}

  tool(){
    const optional=description=>Type.Optional(Type.String({description}));
    return{name:'future_skill_studio',label:'Future Skill Studio',description:'Create, inspect, validate, install, update, list, and enable or disable Future Skill packages. Available only after loading the skill-creator Skill.',parameters:Type.Object({
      type:Type.Union([Type.Literal('validate'),Type.Literal('install'),Type.Literal('update'),Type.Literal('list'),Type.Literal('inspect'),Type.Literal('set_enabled')],{description:'Skill Studio operation.'}),
      draftId:optional('Validated draft id returned by validate.'),name:optional('Exact lowercase hyphenated Skill name.'),path:optional('For inspect, an exact package-relative file path. Omit to inspect the complete text package.'),packageJson:optional('For validate, the complete Future Skill source package as JSON.'),enabled:Type.Optional(Type.Boolean({description:'For set_enabled, whether the installed Skill is available to Agent.'})),
    },{additionalProperties:false}),executionMode:'sequential',execute:async(toolCallId,input,signal,onUpdate)=>{
      if(input.type==='list'){const skills=this.skillRegistry.list();return result(JSON.stringify(skills,null,2),{skillId:'skill-creator',operation:'list',phase:'completed',result:{skills}})}
      if(input.type==='inspect'){const name=required(input,'name'),source=await this.skillRegistry.inspectPackage(name,String(input.path||''));return result(typeof source==='string'?source:JSON.stringify(source,null,2),{skillId:'skill-creator',operation:'inspect',phase:'completed',result:{name,path:String(input.path||''),source}})}
      if(input.type==='set_enabled'){const name=required(input,'name');if(typeof input.enabled!=='boolean')throw new Error('Skill Studio requires enabled for set_enabled.');const enabled=this.skillRegistry.setEnabled(name,input.enabled);return result(`${enabled?'Enabled':'Disabled'} “${name}”. Its files remain installed.`,{skillId:'skill-creator',operation:'set_enabled',phase:'completed',result:{name,enabled}})}
      if(input.type==='install'||input.type==='update'){
        const draft=this.#draft(input),name=draft.source.name,current=this.skillRegistry.list().find(skill=>skill.name===name);
        if(input.type==='install'&&current)throw new Error(`Skill is already installed: ${name}`);
        if(input.type==='update'&&!current)throw new Error(`Skill is not installed: ${name}`);
        if(current?.bundled)throw new Error(`Built-in Skill cannot be updated: ${name}`);
        if(input.type==='install'){await this.skillRegistry.installPackage(draft.entries);this.drafts.delete(draft.id);return result(`Installed “${name}”. It is enabled and available from Agent Skill selection.`,{skillId:'skill-creator',operation:'install',phase:'completed',result:{name,installed:true}})}
        if(!this.approvalService)throw new Error('Future approval service is unavailable.');
        const outcome=await this.approvalService.runProtected({toolCallId,name:'future_skill_studio',label:`Update ${name}`,appId:'ai',operation:'update_skill',params:{name,files:Object.keys(draft.source.files)},approvalMessage:`Update the installed Skill “${name}”?\n\nIts validated instructions, references, assets, and scripts will be replaced. Its enabled state will be preserved.`},signal,onUpdate,()=>this.skillRegistry.installPackage(draft.entries));
        if(!outcome.approved)return result('The user denied the Skill update request.',{...outcome.state,skillId:'skill-creator'});
        this.drafts.delete(draft.id);return result(`Updated “${name}”. Loaded Agent sessions now use the revised package.`,{...outcome.state,skillId:'skill-creator',result:{name,updated:true}});
      }
      const source=this.#parsePackage(required(input,'packageJson')),entries=this.#entries(source),draftId=crypto.randomUUID();
      this.drafts.set(draftId,{id:draftId,source,entries,createdAt:Date.now()});
      return result(`Validated “${source.name}”. SKILL.md, ${Object.keys(source.files).length} supporting files, file limits, resource references, and Python entry points passed. Use type “install” with draftId “${draftId}” to install it.`,{skillId:'skill-creator',operation:'validate',phase:'completed',result:{draftId,name:source.name,description:source.description,files:Object.keys(source.files),pythonScripts:Object.keys(source.files).filter(path=>/^scripts\/.+\.py$/i.test(path))}});
    }};
  }

  #draft(input){const draft=this.drafts.get(String(input.draftId||''));if(!draft)throw new Error('The validated Skill Studio draft was not found. Validate the complete Skill again.');return draft}
  #parsePackage(raw){
    let source;try{source=JSON.parse(raw)}catch{throw new Error('packageJson must be valid JSON.')}
    if(!source||typeof source!=='object'||Array.isArray(source))throw new Error('packageJson must contain one JSON object.');
    const name=String(source.name||'').trim(),description=String(source.description||'').trim(),instructions=String(source.instructions||'').trim(),files=source.files??{};
    if(!NAME.test(name)||name.length>64)throw new Error('Skill name must use lowercase letters, numbers, and hyphens and contain at most 64 characters.');
    if(!description||description.includes('\n')||description.length>240)throw new Error('Skill description must be one concise line of at most 240 characters.');
    if(!instructions)throw new Error('Skill instructions cannot be empty.');
    if(!files||typeof files!=='object'||Array.isArray(files))throw new Error('Skill files must be a JSON object of path-to-text entries.');
    const normalized={};let total=new TextEncoder().encode(instructions).length;
    for(const [rawPath,rawContent] of Object.entries(files)){
      const path=safePath(rawPath);if(typeof rawContent!=='string')throw new Error(`Skill Studio can update only UTF-8 text files. Preserve binary assets by importing the folder again: ${path}`);const content=rawContent;
      if(path==='SKILL.md')throw new Error('Do not include SKILL.md in files; Skill Studio generates it from name, description, and instructions.');
      if(!/^(?:references|scripts|assets)\//.test(path))throw new Error(`Supporting file must be under references/, scripts/, or assets/: ${path}`);
      if(path.startsWith('scripts/')&&!/\.py$/i.test(path))throw new Error(`Future Skill scripts must be Python files: ${path}`);
      const bytes=new TextEncoder().encode(content).length;if(bytes>MAX_FILE_BYTES)throw new Error(`Skill file exceeds 5 MB: ${path}`);total+=bytes;
      if(normalized[path]!=null)throw new Error(`Duplicate Skill file: ${path}`);normalized[path]=content;
      if(!instructions.includes(path))throw new Error(`Skill instructions must reference supporting file by its exact path: ${path}`);
      if(/\.py$/i.test(path)){if(!/(?:async\s+def|def)\s+main\s*\(/.test(content))throw new Error(`Python Skill script must define main(input): ${path}`);if(FORBIDDEN_IMPORT.test(content))throw new Error(`Python Skill script imports a capability Future does not expose: ${path}`)}
    }
    if(Object.keys(normalized).length+1>MAX_FILES)throw new Error(`A Skill package may contain at most ${MAX_FILES} files.`);if(total>MAX_PACKAGE_BYTES)throw new Error('Skill package exceeds 15 MB.');
    return{name,description,instructions,files:normalized};
  }
  #entries(source){const encoder=new TextEncoder(),skillFile=`---\nname: ${source.name}\ndescription: ${JSON.stringify(source.description)}\n---\n\n${source.instructions}\n`,mime=path=>path.endsWith('.py')?'text/x-python':path.endsWith('.md')?'text/markdown':path.endsWith('.json')?'application/json':path.endsWith('.svg')?'image/svg+xml':'text/plain';return[{path:`${source.name}/SKILL.md`,type:'text/markdown',bytes:encoder.encode(skillFile)},...Object.entries(source.files).map(([path,content])=>({path:`${source.name}/${path}`,type:mime(path),bytes:encoder.encode(content)}))]}
}
