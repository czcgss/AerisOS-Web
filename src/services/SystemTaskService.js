const STORAGE_KEY='future.system-tasks.v1';
const MAX_TASKS=240;
const terminal=new Set(['completed','failed','cancelled']);
const clone=value=>structuredClone(value);

export class SystemTaskService{
  constructor(storage=globalThis.localStorage){this.storage=storage;this.tasks=[];this.runner=null;this.offs=[]}
  start(){
    try{const saved=JSON.parse(this.storage?.getItem(STORAGE_KEY)||'[]');this.tasks=Array.isArray(saved)?saved.map(task=>['running','approval','input'].includes(task.status)?{...task,status:'cancelled',finishedAt:task.finishedAt||Date.now(),updatedAt:Date.now()}:task).slice(0,MAX_TASKS):[]}catch{this.tasks=[]}
    try{this.storage?.setItem(STORAGE_KEY,JSON.stringify(this.tasks))}catch{}
    const bus=this.kernel.bus;
    this.offs.push(
      bus.on('ai:agent-event',detail=>{if(detail?.event?.type!=='turn_created'||!detail.sessionId||!detail.turnId)return;const existing=this.tasks.find(task=>task.sessionId===detail.sessionId&&!terminal.has(task.status));if(existing){existing.turnId=detail.turnId;existing.status='running';existing.updatedAt=Date.now();this.#save();return}this.begin({kind:'agent',origin:'conversation',sessionId:detail.sessionId,turnId:detail.turnId,title:String(detail.prompt||'Agent task').slice(0,100),prompt:detail.prompt||''})}),
      bus.on('ai:task-status',detail=>{const task=this.#byTurn(detail?.sessionId,detail?.turnId);if(task)this.update(task.id,{status:detail.status,error:detail.error||'',progress:detail.status==='completed'?100:task.progress})}),
      bus.on('capability:execution',detail=>{const task=this.#byTurn(detail?.sessionId,detail?.turnId);if(!task)return;const phase=detail.phase==='approval'?'approval':['failed','cancelled','denied'].includes(detail.phase)?detail.phase:'running';this.update(task.id,{status:phase==='denied'?'failed':phase,activeTool:{id:detail.toolCallId,label:detail.label,name:detail.name,appId:detail.appId,phase:detail.phase},progress:Math.max(task.progress||0,phase==='running'?45:phase==='completed'?72:task.progress||0)})}),
      bus.on('agent:query-user',detail=>{const task=this.#byTurn(detail?.sessionId,detail?.turnId)||this.tasks.find(item=>item.sessionId===detail?.sessionId&&!terminal.has(item.status));if(task)this.update(task.id,{status:detail.phase==='query'?'input':'running'})}),
      bus.on('multi-agent:workflow',detail=>{const task=this.tasks.find(item=>item.sessionId===detail?.sessionId&&!terminal.has(item.status));if(task)this.update(task.id,{progress:Number(detail.workflow?.progress)||task.progress,workflowId:detail.workflow?.id||task.workflowId})})
    );
    this.#emit();
  }
  stop(){this.offs.splice(0).forEach(off=>off())}
  setRunner(runner){this.runner=runner}
  snapshot(){const tasks=clone(this.tasks);return{tasks,running:tasks.filter(task=>!terminal.has(task.status)).length,waiting:tasks.filter(task=>['approval','input'].includes(task.status)).length}}
  begin(value={}){const stamp=Date.now(),task={id:crypto.randomUUID(),kind:'agent',origin:'system',title:'System task',prompt:'',status:'running',progress:5,sessionId:'',turnId:'',createdAt:stamp,updatedAt:stamp,...clone(value)};this.tasks.unshift(task);this.tasks=this.tasks.slice(0,MAX_TASKS);this.#save();return clone(task)}
  update(id,patch={}){const task=this.tasks.find(item=>item.id===id);if(!task)return null;Object.assign(task,clone(patch),{updatedAt:Date.now()});if(terminal.has(task.status))task.finishedAt=task.finishedAt||Date.now();this.#save();return clone(task)}
  async cancel(id){const task=this.tasks.find(item=>item.id===id);if(!task||terminal.has(task.status))return false;this.runner?.abort?.(task.sessionId);this.update(id,{status:'cancelled'});return true}
  async retry(id){const task=this.tasks.find(item=>item.id===id);if(!task?.prompt||!this.runner)throw new Error('This task cannot be retried.');const sessionId=this.runner.createSession();this.runner.renameSession(sessionId,task.title);this.update(id,{status:'cancelled',replacedBySessionId:sessionId});await this.runner.send(sessionId,task.prompt);return sessionId}
  clearCompleted(){this.tasks=this.tasks.filter(task=>!terminal.has(task.status));this.#save()}
  clearData(){for(const task of this.tasks)if(!terminal.has(task.status))this.runner?.abort?.(task.sessionId);this.tasks=[];this.storage?.removeItem(STORAGE_KEY);this.#emit()}
  remove(id){const task=this.tasks.find(item=>item.id===id);if(!task||!terminal.has(task.status))return false;this.tasks=this.tasks.filter(item=>item.id!==id);this.#save();return true}
  #byTurn(sessionId,turnId){return this.tasks.find(task=>task.sessionId===sessionId&&(!turnId||task.turnId===turnId))}
  #save(){try{this.storage?.setItem(STORAGE_KEY,JSON.stringify(this.tasks))}catch(error){this.kernel?.bus.emit('system-tasks:storage-error',{error:error.message||String(error)})}this.#emit()}
  #emit(){this.kernel?.bus.emit('system-tasks:changed',this.snapshot())}
}
