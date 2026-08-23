import { Type } from '@earendil-works/pi-ai';

const STORAGE_KEY='aeris.ai.workflows.v1';
const TERMINAL=new Set(['completed','failed','cancelled']);
const clone=value=>structuredClone(value);
const now=()=>Date.now();
const bounded=(value,limit=8000)=>{const text=String(value||'');return text.length>limit?`${text.slice(0,limit)}\n\n[Output truncated by Aeris multi-agent runtime]`:text};
const toolValue=(value,limit=6000)=>{
  if(value===null||value===undefined)return'';
  if(typeof value==='string')return bounded(value,limit);
  const content=Array.isArray(value?.content)?value.content.filter(item=>item?.type==='text').map(item=>item.text).join('\n'):'';
  const selected=value?.details?.result??value?.result??(content||value);
  if(typeof selected==='string')return bounded(selected,limit);
  try{return bounded(JSON.stringify(selected,null,2),limit)}catch{return bounded(String(selected),limit)}
};
const textResult=(text,details)=>({content:[{type:'text',text:String(text||'')}],details});

export class MultiAgentOrchestratorService{
  constructor({registry,storage=globalThis.localStorage,toolService=null,skillRegistry=null,isToolAppEnabled=null}={}){this.registry=registry;this.storage=storage;this.toolService=toolService;this.skillRegistry=skillRegistry;this.isToolAppEnabled=isToolAppEnabled||(()=>true);this.workflows=[];this.runner=null;this.controllers=new Map()}
  start(){try{const saved=JSON.parse(this.storage?.getItem(STORAGE_KEY)||'[]');this.workflows=(Array.isArray(saved)?saved:[]).map(flow=>({...flow,status:['running','queued'].includes(flow.status)?'cancelled':flow.status,nodes:(flow.nodes||[]).map(node=>({...node,status:['running','queued'].includes(node.status)?'cancelled':node.status,tools:(node.tools||[]).map(tool=>({...tool,phase:['running','approval'].includes(tool.phase)?'cancelled':tool.phase}))}))})).slice(0,80)}catch{this.workflows=[]}}
  setRunner(runner){this.runner=runner}
  setCapabilitySources({toolService,skillRegistry,isToolAppEnabled}={}){if(toolService)this.toolService=toolService;if(skillRegistry)this.skillRegistry=skillRegistry;if(isToolAppEnabled)this.isToolAppEnabled=isToolAppEnabled}
  directory(){
    const tools=this.toolService?.list?.()||[],apps=new Map((this.toolService?.apps?.()||[]).map(app=>[app.id,app])),skills=new Map((this.skillRegistry?.list?.()||[]).filter(skill=>skill.enabled).map(skill=>[skill.name,skill]));
    return this.registry.list({enabledOnly:true}).map(({id,name,description,toolApps,skills:skillNames})=>{
      const appCapabilities=(toolApps||[]).filter(appId=>this.isToolAppEnabled(appId)).map(appId=>{const app=apps.get(appId),operations=tools.filter(tool=>tool.appId===appId).map(({operation,label,description,risk})=>({operation,label,description,risk}));return app&&operations.length?{id:appId,title:app.title,operations}:null}).filter(Boolean);
      const skillCapabilities=(skillNames||[]).map(skillName=>skills.get(skillName)).filter(Boolean).map(({name:skillName,description:skillDescription,toolCount})=>({name:skillName,description:skillDescription,toolCount}));
      return{id,name,description,toolApps:appCapabilities.map(app=>app.id),skills:skillCapabilities.map(skill=>skill.name),appCapabilities,skillCapabilities};
    })
  }
  #directoryText(directory=this.directory()){return directory.map(item=>{const apps=item.appCapabilities.map(app=>`    - ${app.id}: ${app.operations.map(operation=>`${operation.operation} (${operation.label})`).join(', ')}`).join('\n'),skills=item.skillCapabilities.map(skill=>`    - ${skill.name}: ${skill.description}`).join('\n');return`- ${item.id} (${item.name}): ${item.description}\n  Effective app tools:\n${apps||'    - none'}\n  Effective skills:\n${skills||'    - none'}`}).join('\n')}
  beginTurn(sessionId,turnId,task){
    const existing=this.workflows.find(item=>item.turnId===turnId);if(existing)return clone(existing);
    const stamp=now(),flow={id:crypto.randomUUID(),sessionId,turnId,task:String(task||''),status:'running',progress:0,createdAt:stamp,updatedAt:stamp,nodes:[{id:`main:${turnId}`,parentId:'',agentId:'main',agentName:'Main Agent',task:String(task||''),status:'running',phase:'reasoning',progress:5,createdAt:stamp,startedAt:stamp,finishedAt:0,result:'',error:'',tools:[]}]};
    this.workflows.unshift(flow);this.workflows=this.workflows.slice(0,80);this.#changed(flow);return clone(flow);
  }
  finishTurn(turnId,status='completed',error=''){const flow=this.workflows.find(item=>item.turnId===turnId);if(!flow||flow.status==='cancelled'&&status==='completed')return;const root=flow.nodes[0];root.status=status;root.phase=status;root.progress=100;root.finishedAt=now();root.error=String(error||'');flow.status=status;flow.progress=100;flow.updatedAt=now();this.controllers.delete(flow.id);this.#changed(flow)}
  listWorkflows(sessionId=''){return this.workflows.filter(item=>!sessionId||item.sessionId===sessionId).map(clone)}
  active(sessionId=''){return this.workflows.find(item=>(!sessionId||item.sessionId===sessionId)&&item.status==='running')||this.workflows.find(item=>!sessionId||item.sessionId===sessionId)||null}
  recordMainEvent(turnId,event){const flow=this.workflows.find(item=>item.turnId===turnId),root=flow?.nodes?.[0];if(flow&&root&&event?.type?.startsWith('tool_execution_'))this.#workerEvent(flow,root,event)}
  abortSession(sessionId){for(const flow of this.workflows.filter(item=>item.sessionId===sessionId&&item.status==='running')){this.controllers.get(flow.id)?.abort();for(const node of flow.nodes.filter(item=>!TERMINAL.has(item.status))){node.status='cancelled';node.phase='cancelled';node.finishedAt=now()}flow.status='cancelled';flow.progress=100;flow.updatedAt=now();this.#changed(flow)}}
  deleteSession(sessionId){for(const flow of this.workflows.filter(item=>item.sessionId===sessionId))this.controllers.get(flow.id)?.abort();this.workflows=this.workflows.filter(item=>item.sessionId!==sessionId);this.#persist();this.kernel?.bus.emit('multi-agent:workflow',{sessionId,removed:true})}
  prompt(){const directory=this.directory();if(!directory.length)return'';return`You are the Main Agent and orchestrator of an Aeris multi-agent system. You own the user conversation, planning, delegation, and final synthesis, but you never execute operating-system or application actions yourself. The following capability directory is generated from the live Agent, App Tool, and Skill registries and is authoritative:\n${this.#directoryText(directory)}\nChoose workers by their effective capabilities, not by a guessed role or name. Never delegate an app or Skill operation to an Agent whose effective capability list does not contain it. Delegate every request that inspects or changes Aeris apps, files, settings, extensions, media, external webpages, or Linux state with aeris_delegate, including simple single-action requests. For questions requiring no system action, answer directly. Put independent assignments in one tasks array so they run concurrently. Send each worker only the minimum explicit context it needs; workers cannot see this conversation. Synthesize worker results into one answer and never expose internal protocol noise.`}
  mainTool(sessionId,getTurnId){return this.directory().length?this.#delegateTool({sessionId,getTurnId,depth:0,parentNodeId:''}):null}
  workerTool({sessionId,turnId,workflowId,parentNodeId,depth,excludeAgentId}){return this.directory().some(item=>item.id!==excludeAgentId)?this.#delegateTool({sessionId,turnId,workflowId,parentNodeId,depth,excludeAgentId}):null}
  #delegateTool(context){
    const agents=this.directory().filter(item=>item.id!==context.excludeAgentId),ids=agents.map(item=>item.id);
    return{name:'aeris_delegate',label:'Delegate to Aeris Agents',description:`Delegate isolated assignments only to workers whose live effective capabilities match the task. Tasks in one call execute concurrently.\n\nLive Agent capability directory:\n${this.#directoryText(agents)}`,executionMode:'parallel',parameters:Type.Object({tasks:Type.Array(Type.Object({agentId:Type.String({enum:ids}),task:Type.String({description:'Self-contained assignment with acceptance criteria.'}),context:Type.Optional(Type.String({description:'Only the facts or artifacts this worker needs. Do not paste the full conversation.'}))},{additionalProperties:false}),{minItems:1,maxItems:6}),reason:Type.Optional(Type.String({description:'Why delegation helps this request.'}))},{additionalProperties:false}),execute:async(toolCallId,{tasks,reason},signal,onUpdate)=>{
      if(!this.runner)throw new Error('The multi-agent runtime is unavailable.');if(context.depth>=2)throw new Error('Maximum Agent delegation depth reached.');
      const turnId=context.turnId||context.getTurnId?.();if(!turnId)throw new Error('No active Main Agent turn is available for delegation.');
      let flow=this.workflows.find(item=>item.id===context.workflowId)||this.workflows.find(item=>item.turnId===turnId);if(!flow)flow=this.beginTurn(context.sessionId,turnId,reason||'Delegated work');
      const parentId=context.parentNodeId||flow.nodes[0].id,controller=this.controllers.get(flow.id)||new AbortController();this.controllers.set(flow.id,controller);const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
      const nodes=tasks.map((task,index)=>{const profile=this.registry.get(task.agentId);if(!profile?.enabled)throw new Error(`Agent is unavailable: ${task.agentId}`);const stamp=now(),node={id:`${toolCallId}:${index}`,parentId,agentId:profile.id,agentName:profile.name,icon:profile.icon,color:profile.color,task:bounded(task.task,6000),context:bounded(task.context,8000),status:'queued',phase:'queued',progress:0,createdAt:stamp,startedAt:0,finishedAt:0,result:'',error:'',depth:context.depth+1,tools:[]};flow.nodes.push(node);return{node,profile}});
      this.#recalculate(flow);this.#changed(flow);onUpdate?.(textResult(`Queued ${nodes.length} Agent assignment${nodes.length===1?'':'s'}.`,{kind:'delegation',workflowId:flow.id,phase:'running',agents:nodes.map(({node})=>node.agentId)}));
      const results=await Promise.all(nodes.map(async({node,profile})=>{node.status='running';node.phase='reasoning';node.progress=12;node.startedAt=now();this.#recalculate(flow);this.#changed(flow);try{const result=await this.runner({profile,task:node.task,context:node.context,sessionId:context.sessionId,turnId,workflowId:flow.id,nodeId:node.id,depth:node.depth,signal:controller.signal,onEvent:event=>this.#workerEvent(flow,node,event)});node.result=bounded(result);node.status='completed';node.phase='completed';node.progress=100;node.finishedAt=now();return{agentId:node.agentId,agentName:node.agentName,status:'completed',result:node.result}}catch(error){node.status=controller.signal.aborted?'cancelled':'failed';node.phase=node.status;node.progress=100;node.error=bounded(error.message||String(error),2000);node.finishedAt=now();return{agentId:node.agentId,agentName:node.agentName,status:node.status,error:node.error}}finally{this.#recalculate(flow);this.#changed(flow)}}));
      signal?.removeEventListener('abort',abort);return textResult(JSON.stringify(results,null,2),{kind:'delegation',workflowId:flow.id,phase:results.some(item=>item.status==='failed')?'failed':'completed',result:{agents:results}})
    }};
  }
  #workerEvent(flow,node,event){
    let changed=false;node.tools??=[];
    if(event?.type==='tool_execution_start'){
      const stamp=now(),existing=node.tools.find(tool=>tool.id===event.toolCallId),tool={id:event.toolCallId,name:event.toolName||'',args:toolValue(event.args,4000),phase:'running',output:'',error:'',startedAt:stamp,finishedAt:0,updatedAt:stamp};
      if(existing)Object.assign(existing,tool,{startedAt:existing.startedAt||stamp});else node.tools.push(tool);
      node.phase='using_tools';node.progress=Math.max(node.progress,45);node.currentTool=tool.name;changed=true;
    }else if(event?.type==='tool_execution_update'){
      const tool=node.tools.find(item=>item.id===event.toolCallId),phase=event.partialResult?.details?.phase||'running';
      if(tool){tool.phase=phase;tool.output=toolValue(event.partialResult)||tool.output;tool.updatedAt=now();changed=true}
      if(phase==='approval')node.phase='approval';if(node.progress<52){node.progress=52;changed=true}
    }else if(event?.type==='tool_execution_end'){
      const stamp=now(),tool=node.tools.find(item=>item.id===event.toolCallId);
      if(tool){const phase=event.result?.details?.phase;tool.phase=event.isError?'failed':(['denied','cancelled','failed'].includes(phase)?phase:'completed');tool.output=toolValue(event.result);tool.error=event.isError?tool.output:'';tool.finishedAt=stamp;tool.updatedAt=stamp}
      node.phase='reasoning';node.progress=Math.max(node.progress,72);node.currentTool='';changed=true;
    }else if(event?.type==='message_update'&&node.phase!=='writing'){node.phase='writing';node.progress=Math.max(node.progress,82);changed=true}
    if(!changed)return;this.#recalculate(flow);this.#changed(flow)
  }
  #recalculate(flow){const workers=flow.nodes.slice(1),done=workers.filter(node=>TERMINAL.has(node.status)).length;flow.progress=workers.length?Math.min(95,Math.round(done/workers.length*90)+5):5;flow.updatedAt=now()}
  #changed(flow){this.#persist();this.kernel?.bus.emit('multi-agent:workflow',{workflow:clone(flow),sessionId:flow.sessionId,turnId:flow.turnId})}
  #persist(){try{this.storage?.setItem(STORAGE_KEY,JSON.stringify(this.workflows.slice(0,80)))}catch{}}
}

export const MULTI_AGENT_WORKFLOW_STORAGE_KEY=STORAGE_KEY;
