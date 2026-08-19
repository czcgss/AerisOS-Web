export class AgentEntryService {
  constructor(context) { this.context = context; }
  start() {}

  open({ prompt = '', context = null, autoSend = false, source = 'system', mode = 'full', settings = false, sessionId = '', skillName = '' } = {}) {
    if (context) this.context.set(context);
    const detail={prompt:String(prompt),autoSend:!!autoSend,source,context:this.context.snapshot(),settings:!!settings,sessionId:String(sessionId||''),skillName:String(skillName||'')};
    if(mode==='compact'){this.kernel.bus.emit('ai:compact-entry',detail);return}
    this.kernel.bus.emit('shell:open-app', { id: 'ai' });
    queueMicrotask(() => this.kernel.bus.emit('ai:entry',detail));
  }
}
