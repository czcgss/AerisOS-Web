export class AgentEntryService {
  constructor(context) { this.context = context; }
  start() {}

  open({ prompt = '', context = null, autoSend = false, source = 'system' } = {}) {
    if (context) this.context.set(context);
    this.kernel.bus.emit('shell:open-app', { id: 'ai' });
    queueMicrotask(() => this.kernel.bus.emit('ai:entry', { prompt: String(prompt), autoSend: !!autoSend, source, context: this.context.snapshot() }));
  }
}
