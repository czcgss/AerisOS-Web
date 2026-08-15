import { Type } from '@earendil-works/pi-ai';
import { formatSkillInvocation, formatSkillsForSystemPrompt } from '@earendil-works/pi-agent-core';

const STORAGE_KEY='aeris.ai.skills.v1';
const clone=value=>structuredClone(value);
const result=(text,details={})=>({content:[{type:'text',text}],details});

export class SkillRegistryService {
  constructor({storage=globalThis.localStorage,bundledSkills=[]}={}){
    this.storage=storage;this.skills=new Map(bundledSkills.map(skill=>[skill.name,{...skill,bundled:true,enabled:true}]));this.loadedBySession=new Map();
  }

  start(){
    try{
      const saved=JSON.parse(this.storage?.getItem(STORAGE_KEY)||'{}'),disabled=new Set(saved.disabled||[]);
      for(const skill of this.skills.values())skill.enabled=!disabled.has(skill.name);
      for(const skill of saved.imported||[])if(skill?.name&&!this.skills.has(skill.name))this.skills.set(skill.name,{...skill,bundled:false,enabled:!disabled.has(skill.name),tools:[]});
    }catch{}
  }

  list(){return [...this.skills.values()].map(skill=>({name:skill.name,description:skill.description,filePath:skill.filePath,bundled:skill.bundled,enabled:skill.enabled,toolCount:skill.tools?.length||0}));}
  toolMetadata(name){
    if(name==='aeris_load_skill')return{kind:'loader',skillName:'',label:'Load Skill'};
    for(const skill of this.skills.values())if((skill.tools||[]).some(tool=>tool.name===name))return{kind:'skill',skillName:skill.name,label:(skill.tools||[]).find(tool=>tool.name===name)?.label||name};
    return null;
  }
  enabledSkills(){return [...this.skills.values()].filter(skill=>skill.enabled).map(skill=>({name:skill.name,description:skill.description,content:skill.content,filePath:skill.filePath,disableModelInvocation:false}));}
  prompt(){const catalog=formatSkillsForSystemPrompt(this.enabledSkills());return catalog?`${catalog}\n\nUse the aeris_load_skill tool to read a matching skill before following it. Skill-owned tools become available only after that load completes.`:'';}
  loadedPrompt(sessionId){return [...(this.loadedBySession.get(sessionId)||[])].map(name=>this.skills.get(name)).filter(skill=>skill?.enabled).map(skill=>formatSkillInvocation(skill)).join('\n\n');}

  load(sessionId,name){
    const skill=this.skills.get(String(name));if(!skill?.enabled)throw new Error(`Skill is unavailable or disabled: ${name}`);
    const loaded=this.loadedBySession.get(sessionId)||new Set();loaded.add(skill.name);this.loadedBySession.set(sessionId,loaded);return skill;
  }

  setEnabled(name,enabled){
    const skill=this.skills.get(name);if(!skill)throw new Error(`Unknown skill: ${name}`);skill.enabled=!!enabled;
    if(!skill.enabled)for(const loaded of this.loadedBySession.values())loaded.delete(name);
    this.#persist();this.kernel?.bus.emit('skill:changed',{name,enabled:skill.enabled});return skill.enabled;
  }

  install(raw){
    const source=String(raw||'').replace(/\r\n?/g,'\n'),match=source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);if(!match)throw new Error('Skill file requires YAML frontmatter.');
    const field=key=>match[1].match(new RegExp(`^${key}:\\s*(.+)$`,'m'))?.[1]?.trim().replace(/^['"]|['"]$/g,'')||'';
    const name=field('name'),description=field('description'),content=match[2].trim();
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)||!description||!content)throw new Error('Skill requires a lowercase hyphenated name, description, and instructions.');
    if(this.skills.has(name))throw new Error(`Skill is already installed: ${name}`);
    this.skills.set(name,{name,description,content,filePath:`aeris://skills/${name}/SKILL.md`,bundled:false,enabled:true,tools:[]});this.#persist();this.kernel?.bus.emit('skill:changed',{name,enabled:true,installed:true});return name;
  }

  agentTools(sessionId,onChanged){
    const loaded=this.loadedBySession.get(sessionId)||new Set();this.loadedBySession.set(sessionId,loaded);
    const loadTool={
      name:'aeris_load_skill',label:'Load Aeris skill',description:'Load the full instructions and native tools for one enabled Aeris skill before performing the matching specialized task.',
      parameters:Type.Object({name:Type.String({description:'Exact skill name from available_skills.'})},{additionalProperties:false}),executionMode:'sequential',
      execute:async(_toolCallId,{name})=>{
        const skill=this.load(sessionId,name);onChanged?.();
        return result(formatSkillInvocation(skill),{skillId:skill.name,operation:'load',phase:'completed',result:{name:skill.name,tools:(skill.tools||[]).map(tool=>tool.name)}});
      },
    };
    const owned=[...loaded].flatMap(name=>{const skill=this.skills.get(name);return skill?.enabled?(skill.tools||[]):[]});
    return [loadTool,...owned];
  }

  clearSession(sessionId){this.loadedBySession.delete(sessionId)}
  #persist(){
    const disabled=[...this.skills.values()].filter(skill=>!skill.enabled).map(skill=>skill.name),imported=[...this.skills.values()].filter(skill=>!skill.bundled).map(({name,description,content,filePath})=>({name,description,content,filePath}));
    this.storage?.setItem(STORAGE_KEY,JSON.stringify({disabled,imported}));
  }
}
