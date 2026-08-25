const STORAGE_KEY='future.automations.v1';
const clone=value=>structuredClone(value);
const terminal=new Set(['completed','failed','cancelled']);

export class AutomationService{
  constructor({storage=globalThis.localStorage,tasks=null}={}){this.storage=storage;this.tasks=tasks;this.rules=[];this.runner=null;this.offs=[];this.lastSignals=new Map()}
  start(){
    try{const saved=JSON.parse(this.storage?.getItem(STORAGE_KEY)||'[]');this.rules=Array.isArray(saved)?saved:[]}catch{this.rules=[]}
    const bus=this.kernel.bus;
    this.offs.push(
      bus.on('window:opened',detail=>this.#signal('app_opened',detail)),
      bus.on('filesystem:changed',detail=>this.#signal('file_changed',detail)),
      bus.on('network:change',detail=>{if(detail?.status==='connected')this.#signal('network_online',detail)}),
      bus.on('metrics:update',detail=>this.#signal('memory_above',detail))
    );
    this.timer=setInterval(()=>this.#tick(),15_000);this.#tick();this.#emit();
  }
  stop(){clearInterval(this.timer);this.offs.splice(0).forEach(off=>off())}
  setRunner(runner){this.runner=runner}
  list(){return clone(this.rules).sort((a,b)=>b.updatedAt-a.updatedAt)}
  get(id){const rule=this.rules.find(item=>item.id===id);return rule?clone(rule):null}
  create(value={}){const stamp=Date.now(),rule=this.#normalize({...value,id:crypto.randomUUID(),createdAt:stamp,updatedAt:stamp,lastRunAt:0,lastStatus:'never'});this.rules.unshift(rule);this.#save();return clone(rule)}
  restore(value={}){const rule=this.#normalize(value);if(this.rules.some(item=>item.id===rule.id))return clone(rule);this.rules.unshift(rule);this.#save();return clone(rule)}
  update(id,patch={}){const rule=this.rules.find(item=>item.id===id);if(!rule)throw new Error('Automation not found.');Object.assign(rule,this.#normalize({...rule,...clone(patch),id:rule.id,createdAt:rule.createdAt,updatedAt:Date.now()}));this.#save();return clone(rule)}
  setEnabled(id,enabled){return this.update(id,{enabled:!!enabled})}
  remove(id){const size=this.rules.length;this.rules=this.rules.filter(rule=>rule.id!==id);if(size===this.rules.length)return false;this.#save();return true}
  clearData(){this.rules=[];this.storage?.removeItem(STORAGE_KEY);this.#emit()}
  async run(id,{reason='manual'}={}){const rule=this.rules.find(item=>item.id===id);if(!rule)throw new Error('Automation not found.');if(!this.runner)throw new Error('The Agent runtime is unavailable.');if(rule.runningTaskId){const active=this.tasks?.snapshot().tasks.find(task=>task.id===rule.runningTaskId);if(active&&!terminal.has(active.status))return active}
    const sessionId=this.runner.createSession();this.runner.renameSession(sessionId,rule.name);const task=this.tasks?.begin({kind:'automation',origin:'automation',automationId:rule.id,sessionId,title:rule.name,prompt:rule.action.prompt,triggerReason:reason,progress:3});rule.runningTaskId=task?.id||'';rule.lastRunAt=Date.now();rule.lastStatus='running';rule.updatedAt=Date.now();this.#save();
    try{await this.runner.send(sessionId,rule.action.prompt);rule.lastStatus='completed';rule.lastError='';return task}catch(error){rule.lastStatus='failed';rule.lastError=error.message||String(error);if(task)this.tasks?.update(task.id,{status:'failed',error:rule.lastError});throw error}finally{rule.runningTaskId='';rule.updatedAt=Date.now();this.#save()}}
  #normalize(value){const triggerTypes=new Set(['daily','interval','app_opened','file_changed','network_online','memory_above']),type=triggerTypes.has(value.trigger?.type)?value.trigger.type:'daily',trigger={type,...(value.trigger||{})};return{id:String(value.id||crypto.randomUUID()),name:String(value.name||'New automation').trim().slice(0,100),enabled:value.enabled!==false,trigger,action:{type:'agent',prompt:String(value.action?.prompt||value.prompt||'').trim().slice(0,8000)},createdAt:Number(value.createdAt)||Date.now(),updatedAt:Number(value.updatedAt)||Date.now(),lastRunAt:Number(value.lastRunAt)||0,lastStatus:String(value.lastStatus||'never'),lastError:String(value.lastError||''),runningTaskId:String(value.runningTaskId||'')}}
  #tick(){const now=new Date();for(const rule of this.rules.filter(item=>item.enabled)){if(rule.trigger.type==='daily'){const [hour,minute]=String(rule.trigger.time||'09:00').split(':').map(Number),due=new Date(now);due.setHours(hour||0,minute||0,0,0);if(now>=due&&rule.createdAt<=due.getTime()&&rule.lastRunAt<due.getTime())this.run(rule.id,{reason:'daily'}).catch(()=>{})}else if(rule.trigger.type==='interval'){const every=Math.max(1,Number(rule.trigger.intervalMinutes)||60)*60_000,anchor=rule.lastRunAt||rule.createdAt;if(Date.now()-anchor>=every)this.run(rule.id,{reason:'interval'}).catch(()=>{})}}}
  #signal(type,detail){for(const rule of this.rules.filter(item=>item.enabled&&item.trigger.type===type)){if(type==='app_opened'&&rule.trigger.appId&&rule.trigger.appId!==detail?.appId)continue;if(type==='file_changed'&&rule.trigger.path&&!String(detail?.path||'').startsWith(rule.trigger.path))continue;if(type==='memory_above'&&Number(detail?.percent)<Math.max(1,Number(rule.trigger.threshold)||80))continue;const key=`${rule.id}:${type}`,last=this.lastSignals.get(key)||0,throttle=type==='memory_above'?300_000:30_000;if(Date.now()-last<throttle)continue;this.lastSignals.set(key,Date.now());this.run(rule.id,{reason:type}).catch(()=>{})}}
  #save(){try{this.storage?.setItem(STORAGE_KEY,JSON.stringify(this.rules))}catch(error){this.kernel?.bus.emit('automations:storage-error',{error:error.message||String(error)})}this.#emit()}
  #emit(){this.kernel?.bus.emit('automations:changed',{rules:this.list()})}
}
