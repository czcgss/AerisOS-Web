const STORAGE_KEY='aeris.ai.agents.v1';
const COLORS=new Set(['blue','purple','green','orange','pink','red','grey','teal']);
const AGENT_ICONS=new Set(['agentGeneral','agentPlanner','agentProductivity','agentWorkspace','agentComputer','agentCreator']);
const DEFAULT_AGENTS=[
  {id:'planner',name:'Planner',description:'Breaks complex goals into coordinated, verifiable work.',icon:'agentPlanner',color:'purple',systemPrompt:'You are the Aeris planning specialist. Decompose the assigned objective, identify dependencies, and return a precise plan or decision. Do not claim work performed by other agents.',toolApps:[],skills:[],modelKey:'',enabled:true,builtIn:true},
  {id:'productivity',name:'Productivity',description:'Works with calendars, reminders, notes, contacts, and weather.',icon:'agentProductivity',color:'blue',systemPrompt:'You are the Aeris productivity specialist. Complete the assigned task using only your available Aeris tools. Preserve dates, names, and user intent exactly.',toolApps:['calendar','reminders','notes','contacts','weather','clock'],skills:[],modelKey:'',enabled:true,builtIn:true},
  {id:'workspace',name:'Workspace',description:'Manages documents, files, photos, and local content.',icon:'agentWorkspace',color:'teal',systemPrompt:'You are the Aeris workspace specialist. Inspect and modify the assigned files or documents carefully. Report exact paths and concrete results.',toolApps:['files','textedit','preview','photos','trash'],skills:[],modelKey:'',enabled:true,builtIn:true},
  {id:'computer',name:'Computer',description:'Operates the Linux guest and inspects system state.',icon:'agentComputer',color:'green',systemPrompt:'You are the Aeris computer specialist. Use finite, non-interactive commands and system tools. Explain risky operations and return concise command evidence.',toolApps:['terminal','monitor','diskutility','machine','settings'],skills:[],modelKey:'',enabled:true,builtIn:true},
  {id:'creator',name:'Creator',description:'Builds Aeris apps, widgets, themes, and Skills.',icon:'agentCreator',color:'pink',systemPrompt:'You are the Aeris extension specialist. Load the relevant creation Skill before building or modifying an extension. Follow the Aeris design and runtime contracts exactly and validate the result.',toolApps:[],skills:['create-app','create-widget','create-theme','skill-creator'],modelKey:'',enabled:true,builtIn:true},
];
const clone=value=>structuredClone(value);
const safeId=value=>String(value||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48);

export class AgentRegistryService{
  constructor({storage=globalThis.localStorage}={}){this.storage=storage;this.agents=new Map()}
  start(){
    let saved=[];try{saved=JSON.parse(this.storage?.getItem(STORAGE_KEY)||'[]')}catch{}
    const byId=new Map((Array.isArray(saved)?saved:[]).filter(item=>item?.id).map(item=>[String(item.id),item]));
    for(const definition of DEFAULT_AGENTS){const override=byId.get(definition.id);this.agents.set(definition.id,this.#normalise({...definition,...override,id:definition.id,icon:definition.icon,builtIn:true}))}
    for(const item of byId.values())if(!this.agents.has(String(item.id)))this.agents.set(String(item.id),this.#normalise({...item,builtIn:false}));
    this.#persist();
  }
  list({enabledOnly=false}={}){return[...this.agents.values()].filter(item=>!enabledOnly||item.enabled).map(clone)}
  get(id){const item=this.agents.get(String(id));return item?clone(item):null}
  create(input){const id=safeId(input?.id||input?.name);if(!id)throw new Error('Agent name is required.');if(id==='main'||this.agents.has(id))throw new Error(`Agent already exists: ${id}`);const item=this.#normalise({...input,id,builtIn:false});this.agents.set(id,item);this.#changed({type:'created',agent:clone(item)});return clone(item)}
  update(id,changes){const current=this.agents.get(String(id));if(!current)throw new Error(`Unknown Agent: ${id}`);const item=this.#normalise({...current,...changes,id:current.id,builtIn:current.builtIn});this.agents.set(item.id,item);this.#changed({type:'updated',agent:clone(item)});return clone(item)}
  remove(id){const item=this.agents.get(String(id));if(!item)throw new Error(`Unknown Agent: ${id}`);if(item.builtIn)throw new Error('Built-in Agents cannot be removed.');this.agents.delete(item.id);this.#changed({type:'removed',agentId:item.id});return true}
  setEnabled(id,enabled){return this.update(id,{enabled:!!enabled})}
  #normalise(item){return{id:safeId(item.id),name:String(item.name||item.id||'Agent').trim().slice(0,60),description:String(item.description||'').trim().slice(0,240),icon:AGENT_ICONS.has(item.icon)?item.icon:'agentGeneral',color:COLORS.has(item.color)?item.color:'blue',systemPrompt:String(item.systemPrompt||'').trim().slice(0,12000),toolApps:[...new Set((item.toolApps||[]).map(String))],skills:[...new Set((item.skills||[]).map(String))],modelKey:String(item.modelKey||''),enabled:item.enabled!==false,builtIn:!!item.builtIn}}
  #changed(detail){this.#persist();this.kernel?.bus.emit('agents:changed',{...detail,agents:this.list()})}
  #persist(){try{this.storage?.setItem(STORAGE_KEY,JSON.stringify(this.list()))}catch(error){this.kernel?.bus.emit('agents:storage-error',{error:error.message||String(error)})}}
}

export const AGENT_REGISTRY_STORAGE_KEY=STORAGE_KEY;
