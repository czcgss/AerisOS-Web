const terminalPhases=new Set(['completed','failed','cancelled','denied']);
const text=value=>String(value||'').trim().replace(/\s+/g,' ');

export class AgentNotificationService{
  constructor({notifications,aiAgent,tools,queryUser,i18n}={}){Object.assign(this,{notifications,aiAgent,tools,queryUser,i18n});this.offs=[];this.foregroundApp='';this.surfaces=new Map()}
  start(){
    const bus=this.kernel.bus;
    this.offs.push(bus.on('ai:task-status',detail=>this.#task(detail)),bus.on('capability:execution',detail=>this.#approval(detail)),bus.on('agent:query-user',detail=>this.#query(detail)),bus.on('window:focused',appId=>{this.foregroundApp=String(appId||'')}),bus.on('window:minimized',detail=>{if(detail?.appId===this.foregroundApp)this.foregroundApp=''}),bus.on('ai:surface-session',detail=>{const surface=String(detail?.surface||'');if(!surface)return;const sessionId=String(detail?.sessionId||'');if(sessionId)this.surfaces.set(surface,sessionId);else this.surfaces.delete(surface)}));
  }
  stop(){this.offs.splice(0).forEach(off=>off());this.surfaces.clear();this.foregroundApp=''}
  #session(id){return this.aiAgent.snapshot().sessions.find(item=>item.id===id)}
  #foreground(sessionId){return this.surfaces.get('compact')===sessionId||(this.foregroundApp==='ai'&&this.surfaces.get('full')===sessionId)}
  #task(detail){
    if(!detail?.sessionId||!detail?.turnId||!['completed','failed','cancelled'].includes(detail.status)||this.#foreground(detail.sessionId))return;
    const session=this.#session(detail.sessionId),failed=detail.status==='failed',cancelled=detail.status==='cancelled',title=this.i18n.t(failed?'agentTaskFailed':cancelled?'agentTaskCancelled':'agentTaskCompleted'),message=failed?text(detail.error)||this.i18n.t('agentTaskFailedCopy'):cancelled?this.i18n.t('agentTaskCancelledCopy'):this.i18n.t('agentTaskCompletedCopy');
    this.notifications.publish({appId:'ai',type:'agent',category:`task-${detail.status}`,sourceKey:`agent:task:${detail.sessionId}:${detail.turnId}`,title,message,agent:{sessionId:detail.sessionId,turnId:detail.turnId,status:detail.status,sessionTitle:session?.title||this.i18n.t('newChat')}}).catch(()=>{});
  }
  #approval(detail){
    if(!detail?.toolCallId||!detail.sessionId)return;const sourceKey=`agent:approval:${detail.toolCallId}`,existing=this.notifications.bySource(sourceKey);
    if(detail.phase==='approval'){
      const session=this.#session(detail.sessionId),message=text(detail.approvalMessage)||text(detail.label);
      this.notifications.publish({appId:'ai',type:'agent',category:'approval',sourceKey,title:this.i18n.t('agentApprovalRequired'),message,agent:{sessionId:detail.sessionId,turnId:detail.turnId||'',toolCallId:detail.toolCallId,status:'approval',agentId:detail.agentId||'',agentName:detail.agentName||'',sessionTitle:session?.title||this.i18n.t('newChat'),label:detail.label||'',params:detail.params||{}}}).catch(()=>{});return;
    }
    if(existing&&terminalPhases.has(detail.phase))this.notifications.publish({...existing,read:true,message:this.i18n.t(`agentApproval_${detail.phase}`),agent:{...existing.agent,status:detail.phase}}).catch(()=>{});
  }
  #query(detail){
    if(!detail?.sessionId||!detail?.toolCallId)return;const sourceKey=`agent:query:${detail.toolCallId}`,existing=this.notifications.bySource(sourceKey),session=this.#session(detail.sessionId);
    if(detail.phase==='query')this.notifications.publish({appId:'ai',type:'agent',category:'input',sourceKey,title:this.i18n.t('agentInputRequired'),message:this.i18n.t('agentInputRequiredCopy'),agent:{sessionId:detail.sessionId,toolCallId:detail.toolCallId,status:'input',sessionTitle:session?.title||this.i18n.t('newChat')}}).catch(()=>{});
    else if(existing)this.notifications.publish({...existing,read:true,agent:{...existing.agent,status:detail.phase}}).catch(()=>{});
  }
}
