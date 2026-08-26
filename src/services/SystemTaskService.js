const STORAGE_KEY='future.system-tasks.v1';
const MAX_TASKS=240;
const terminal=new Set(['completed','failed','cancelled']);
const clone=value=>structuredClone(value);
const turnKey=(sessionId,turnId)=>`${sessionId}:${turnId}`;
const short=(value,limit=180)=>{const text=String(value??'').replace(/\s+/g,' ').trim();return text.length>limit?`${text.slice(0,limit-1)}…`:text};

const parameterSummary=params=>{
  if(!params||typeof params!=='object')return'';
  const values=[];
  for(const [key,value] of Object.entries(params)){
    if(value===undefined||value===null||value==='')continue;
    const label=key.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').replace(/^./,letter=>letter.toUpperCase());
    let text='';
    if(typeof value==='string'||typeof value==='number'||typeof value==='boolean')text=String(value);
    else if(Array.isArray(value)&&value.every(item=>['string','number','boolean'].includes(typeof item)))text=value.join(', ');
    if(!text)continue;
    values.push(`${label}: ${short(text,72)}`);
    if(values.length===3)break;
  }
  return short(values.join(' · '));
};

const normalizedSavedTask=task=>{
  if(!task||typeof task!=='object')return null;
  if(task.origin==='conversation'&&!task.qualified&&!task.taskContent&&!task.activeTool)return null;
  const savedOperations=Array.isArray(task.operations)?task.operations:task.activeTool?[task.activeTool]:[];
  if(task.origin==='conversation'&&savedOperations.length&&savedOperations.every(operation=>operation?.taskTracking==='ignore'||operation?.appId==='tasks'))return null;
  const taskContent=short(task.taskContent||task.activeTool?.label||'');
  return{
    ...task,
    qualified:task.origin==='conversation'?true:task.qualified,
    taskContent,
    operations:savedOperations,
    title:task.origin==='conversation'&&task.activeTool?.label&&!task.taskContent?task.activeTool.label:task.title,
  };
};

export class SystemTaskService{
  constructor(storage=globalThis.localStorage){
    this.storage=storage;this.tasks=[];this.pendingTurns=new Map();this.ignoredTurns=new Set();this.runner=null;this.offs=[];
  }

  start(){
    try{
      const saved=JSON.parse(this.storage?.getItem(STORAGE_KEY)||'[]');
      this.tasks=Array.isArray(saved)?saved.map(normalizedSavedTask).filter(Boolean).map(task=>['running','approval','input'].includes(task.status)?{...task,status:'cancelled',finishedAt:task.finishedAt||Date.now(),updatedAt:Date.now()}:task).slice(0,MAX_TASKS):[];
    }catch{this.tasks=[]}
    try{this.storage?.setItem(STORAGE_KEY,JSON.stringify(this.tasks))}catch{}
    const bus=this.kernel.bus;
    this.offs.push(
      bus.on('ai:agent-event',detail=>this.#agentEvent(detail)),
      bus.on('ai:task-status',detail=>this.#taskStatus(detail)),
      bus.on('capability:execution',detail=>this.#capability(detail)),
      bus.on('agent:query-user',detail=>this.#query(detail)),
      bus.on('multi-agent:workflow',detail=>this.#workflow(detail)),
    );
    this.#emit();
  }

  stop(){this.offs.splice(0).forEach(off=>off());this.pendingTurns.clear();this.ignoredTurns.clear()}
  setRunner(runner){this.runner=runner}
  snapshot(){const tasks=clone(this.tasks);return{tasks,running:tasks.filter(task=>!terminal.has(task.status)).length,waiting:tasks.filter(task=>['approval','input'].includes(task.status)).length}}

  begin(value={}){
    const stamp=Date.now(),task={id:crypto.randomUUID(),kind:'agent',origin:'system',title:'System task',taskContent:'',prompt:'',operations:[],status:'running',progress:5,sessionId:'',turnId:'',createdAt:stamp,updatedAt:stamp,...clone(value)};
    this.tasks.unshift(task);this.tasks=this.tasks.slice(0,MAX_TASKS);this.#save();return clone(task);
  }

  update(id,patch={}){
    const task=this.tasks.find(item=>item.id===id);if(!task)return null;
    Object.assign(task,clone(patch),{updatedAt:Date.now()});if(terminal.has(task.status))task.finishedAt=task.finishedAt||Date.now();this.#save();return clone(task);
  }

  async cancel(id){const task=this.tasks.find(item=>item.id===id);if(!task||terminal.has(task.status))return false;this.runner?.abort?.(task.sessionId);this.update(id,{status:'cancelled'});return true}
  async retry(id){const task=this.tasks.find(item=>item.id===id);if(!task?.prompt||!this.runner)throw new Error('This task cannot be retried.');const automated=task.origin==='automation',sessionId=this.runner.createSession(automated?{title:task.title,origin:'automation',automation:{id:task.automationId||'',name:task.title,triggerReason:'retry'}}:{title:task.title});this.update(id,{status:'cancelled',replacedBySessionId:sessionId});await this.runner.send(sessionId,task.prompt,automated?{source:'automation'}:{});return sessionId}
  clearCompleted(){for(const task of this.tasks)if(terminal.has(task.status))task.dismissed=true;this.#save()}
  clearData(){for(const task of this.tasks)if(!terminal.has(task.status))this.runner?.abort?.(task.sessionId);this.tasks=[];this.pendingTurns.clear();this.ignoredTurns.clear();this.storage?.removeItem(STORAGE_KEY);this.#emit()}
  remove(id){const task=this.tasks.find(item=>item.id===id);if(!task||!terminal.has(task.status))return false;this.update(id,{dismissed:true});return true}

  #agentEvent(detail){
    if(detail?.event?.type!=='turn_created'||!detail.sessionId||!detail.turnId)return;
    this.pendingTurns.set(turnKey(detail.sessionId,detail.turnId),{sessionId:detail.sessionId,turnId:detail.turnId,prompt:detail.prompt||'',createdAt:Date.now()});
    const automationTask=this.tasks.find(task=>task.origin==='automation'&&task.sessionId===detail.sessionId&&!task.turnId&&!terminal.has(task.status));
    if(automationTask)this.update(automationTask.id,{turnId:detail.turnId});
  }

  #taskStatus(detail){
    const task=this.#byTurn(detail?.sessionId,detail?.turnId);
    if(task)this.update(task.id,{status:detail.status,error:detail.error||'',progress:detail.status==='completed'?100:task.progress});
    if(terminal.has(detail?.status)){const key=turnKey(detail?.sessionId,detail?.turnId);this.pendingTurns.delete(key);this.ignoredTurns.delete(key)}
  }

  #capability(detail){
    if(!detail?.sessionId||!detail?.turnId)return;
    const key=turnKey(detail.sessionId,detail.turnId);
    if(detail.taskTracking==='ignore'){
      this.ignoredTurns.add(key);
      const task=this.#byTurn(detail.sessionId,detail.turnId);
      if(task?.origin==='conversation')this.#discard(task.id);
      return;
    }
    this.ignoredTurns.delete(key);
    const pending=this.pendingTurns.get(turnKey(detail.sessionId,detail.turnId)),content=parameterSummary(detail.params)||short(detail.operation||detail.label);
    const task=this.#byTurn(detail.sessionId,detail.turnId)||this.begin({kind:'agent',origin:'conversation',qualified:true,sessionId:detail.sessionId,turnId:detail.turnId,title:short(detail.label||'Agent task',100),taskContent:content,prompt:pending?.prompt||''});
    const phase=detail.phase==='approval'?'approval':['failed','cancelled','denied'].includes(detail.phase)?detail.phase:'running',operations=[...(task.operations||[])];
    const step={id:detail.toolCallId,label:detail.label,name:detail.name,appId:detail.appId,operation:detail.operation,taskTracking:detail.taskTracking||'track',parameters:content,phase:detail.phase,startedAt:detail.startedAt||Date.now(),finishedAt:detail.finishedAt||0,error:detail.error||''},index=operations.findIndex(item=>item.id===step.id);
    if(index<0)operations.push(step);else operations[index]={...operations[index],...step,startedAt:operations[index].startedAt||step.startedAt};
    this.update(task.id,{status:phase==='denied'?'failed':phase,taskContent:task.taskContent||content,operations,activeTool:step,progress:Math.max(task.progress||0,phase==='running'?45:phase==='completed'?72:task.progress||0)});
  }

  #query(detail){
    const task=this.#byTurn(detail?.sessionId,detail?.turnId)||this.tasks.find(item=>item.sessionId===detail?.sessionId&&!terminal.has(item.status));
    if(task)this.update(task.id,{status:detail.phase==='query'?'input':'running'});
  }

  #workflow(detail){
    const workflow=detail?.workflow,assignments=(workflow?.nodes||[]).filter(node=>node.parentId);
    if(!detail?.sessionId||!detail?.turnId||!assignments.length)return;
    if(this.ignoredTurns.has(turnKey(detail.sessionId,detail.turnId)))return;
    const pending=this.pendingTurns.get(turnKey(detail.sessionId,detail.turnId)),taskContent=short(assignments.map(node=>node.task).filter(Boolean).join(' · '));
    const task=this.#byTurn(detail.sessionId,detail.turnId)||this.begin({kind:'agent',origin:'conversation',qualified:true,sessionId:detail.sessionId,turnId:detail.turnId,title:short(assignments.length===1?(assignments[0].agentName||'Agent task'):`${assignments.length} Agent tasks`,100),taskContent,prompt:pending?.prompt||''});
    this.update(task.id,{taskContent:taskContent||task.taskContent,progress:Number(workflow.progress)||task.progress,workflowId:workflow.id||task.workflowId});
  }

  #byTurn(sessionId,turnId){return this.tasks.find(task=>task.sessionId===sessionId&&(!turnId||task.turnId===turnId))}
  #discard(id){const index=this.tasks.findIndex(task=>task.id===id);if(index<0)return false;this.tasks.splice(index,1);this.#save();return true}
  #save(){try{this.storage?.setItem(STORAGE_KEY,JSON.stringify(this.tasks))}catch(error){this.kernel?.bus.emit('system-tasks:storage-error',{error:error.message||String(error)})}this.#emit()}
  #emit(){this.kernel?.bus.emit('system-tasks:changed',this.snapshot())}
}
