const STORAGE_KEY = 'aeris.agent.tasks';
const MAX_TASKS = 40;

export class AgentTaskService {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.tasks = [];
  }

  start() {
    try {
      this.tasks = JSON.parse(this.storage?.getItem(STORAGE_KEY) || '[]').slice(0, MAX_TASKS).map(task => {
        const status=task.status==='running'?'cancelled':task.status,finishedAt=task.finishedAt||(status!=='running'?Date.now():null);
        const phase=status==='cancelled'?'cancelled':status==='failed'?'failed':status==='completed'?'completed':null;
        return{...task,status,finishedAt,steps:(task.steps||[]).map(step=>phase&&['running','approval'].includes(step.phase)?{...step,phase,finishedAt}:step)};
      });
    } catch { this.tasks = []; }
    this.offExecution = this.kernel.bus.on('capability:execution', detail => this.#execution(detail));
    this.#save();
  }

  stop() { this.offExecution?.(); }
  snapshot() { return structuredClone(this.tasks); }
  forSession(sessionId) { return this.snapshot().filter(task => task.sessionId === sessionId); }

  begin({ sessionId, turnId, title, context }) {
    const task = { id: crypto.randomUUID(), sessionId, turnId, title: String(title).slice(0, 120), status: 'running', context: context || null, steps: [], createdAt: Date.now(), updatedAt: Date.now() };
    this.tasks.unshift(task);
    this.tasks = this.tasks.slice(0, MAX_TASKS);
    this.#save();
    return structuredClone(task);
  }

  finish(turnId, status = 'completed', error = '') {
    const task = this.tasks.find(item => item.turnId === turnId);
    if (!task) return;
    const effectiveStatus=status==='completed'&&task.steps?.some(step=>step.phase==='failed')?'failed':status;
    task.status = effectiveStatus;
    task.error = String(error || '');
    task.updatedAt = Date.now();
    task.finishedAt = Date.now();
    const finalPhase=effectiveStatus==='cancelled'?'cancelled':effectiveStatus==='failed'?'failed':'completed';
    task.steps=(task.steps||[]).map(step=>['running','approval'].includes(step.phase)?{...step,phase:finalPhase,finishedAt:task.finishedAt,error:step.error||task.error}:step);
    this.#save();
  }

  dismiss(taskId) {
    const task=this.tasks.find(item=>item.id===taskId);
    if(!task||task.status==='running')return false;
    task.dismissed=true;
    task.updatedAt=Date.now();
    this.#save();
    return true;
  }

  #execution(detail) {
    if (!detail?.toolCallId) return;
    const task = this.tasks.find(item=>item.steps?.some(step=>step.toolCallId===detail.toolCallId)) || this.tasks.find(item => item.status === 'running');
    if (!task) return;
    let step = task.steps.find(item => item.toolCallId === detail.toolCallId);
    if (!step) {
      step = { toolCallId: detail.toolCallId, appId: detail.appId, label: detail.label, operation: detail.operation, phase: detail.phase, startedAt: detail.startedAt || Date.now() };
      task.steps.push(step);
    }
    Object.assign(step, { phase: detail.phase, label: detail.label, appId: detail.appId, operation: detail.operation, error: detail.error || '', finishedAt: detail.finishedAt || null });
    task.updatedAt = Date.now();
    this.#save();
  }

  #save() {
    try { this.storage?.setItem(STORAGE_KEY, JSON.stringify(this.tasks)); } catch {}
    this.#emit();
  }

  #emit() { this.kernel.bus.emit('agent:tasks-changed', this.snapshot()); }
}
