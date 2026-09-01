const clone=value=>structuredClone(value);

const BUILTIN_MODES=[
  {id:'general',name:'General',nameKey:'agentModeGeneral',selectable:true,capabilities:{tools:true,skills:true,collaboration:true,workflows:true},systemPrompt:''},
  {id:'chat',name:'Chat',nameKey:'agentModeChat',selectable:true,capabilities:{tools:false,skills:false,collaboration:false,workflows:false},systemPrompt:'You are operating in Future Chat mode. Answer and reason with the user directly. Do not invoke tools, Skills, applications, delegation, or system automation. If the request requires a system action, explain that the user must start a new General-mode chat.'},
  {id:'writing',name:'Writing',nameKey:'writingMode',selectable:false,implicit:true,capabilities:{tools:false,skills:false,collaboration:false,workflows:false},systemPrompt:'You are operating in Future Writing mode. The user invoked you from an active input surface solely to provide text for that input. You have exactly one internal tool: future_writing. You MUST call it exactly once and produce no ordinary assistant answer before or after the call. Choose append to continue or insert at the current position. Choose replace only when the user asks to rewrite, translate, or replace the current content. The tool content must be the exact final text to enter. Never include planning, explanations, progress narration, simulated results, Markdown fences, or a request for confirmation. In a terminal, write only the requested shell command, never pretend to execute it and never invent its output.'},
];

export class AgentModeRegistryService{
  constructor(modes=BUILTIN_MODES){this.modes=new Map();modes.forEach(mode=>this.register(mode))}
  start(){}
  register(mode){const id=String(mode?.id||'').trim();if(!/^[a-z][a-z0-9-]*$/.test(id))throw new Error('Agent modes require a stable lowercase id.');if(this.modes.has(id))throw new Error(`Agent mode already registered: ${id}`);const capabilities={tools:false,skills:false,collaboration:false,workflows:false,...mode.capabilities},record={id,name:String(mode.name||id),nameKey:String(mode.nameKey||''),selectable:mode.selectable!==false,implicit:Boolean(mode.implicit),systemPrompt:String(mode.systemPrompt||''),capabilities};this.modes.set(id,record);return clone(record)}
  get(id='general'){return clone(this.modes.get(String(id))||this.modes.get('general'))}
  list({selectableOnly=false}={}){return[...this.modes.values()].filter(mode=>!selectableOnly||mode.selectable).map(clone)}
}
