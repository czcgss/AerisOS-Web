export class AgentEntryService {
  constructor(context) { this.context = context; }
  start() {}

  open({ prompt = '', context = null, autoSend = false, source = 'system', mode = 'full', settings = false, settingsSection = '', workspace = '', sessionId = '', skillName = '', attachments = [], target = null } = {}) {
    if (context) this.context.set(context);
    const detail={prompt:String(prompt),autoSend:!!autoSend,source,context:this.context.snapshot(),settings:!!settings,settingsSection:String(settingsSection||''),workspace:String(workspace||''),sessionId:String(sessionId||''),skillName:String(skillName||''),attachments:Array.isArray(attachments)?attachments:[],target:target&&typeof target==='object'?{turnId:String(target.turnId||''),toolCallId:String(target.toolCallId||'')}:null};
    if(mode==='compact'){this.kernel.bus.emit('ai:compact-entry',detail);return}
    this.kernel.bus.emit('shell:open-app', { id: 'ai' });
    queueMicrotask(() => this.kernel.bus.emit('ai:entry',detail));
  }
}
