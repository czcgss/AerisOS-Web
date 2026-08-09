const STORAGE_KEY = 'aeris.agent.tasks';
const MAX_TASKS = 40;

export class AgentTaskService {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.tasks = [];
  }

  start() {
    try {
      this.tasks = JSON.parse(this.storage?.getItem(STORAGE_KEY) || '[]').slice(0, MAX_TASKS).map(task => task.status === 'running' ? {
        ...task,
        status: 'cancelled',
        finishedAt: task.finishedAt || Date.now(),
        steps: (task.steps || []).map(step => ['running','approval'].includes(step.phase) ? { ...step, phase: 'cancelled', finishedAt: Date.now() } : step),
      } : task);
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
    task.status = status;
    task.error = String(error || '');
    task.updatedAt = Date.now();
    task.finishedAt = Date.now();
    this.#save();
  }

  #execution(detail) {
    if (!detail?.toolCallId) return;
    const task = this.tasks.find(item => item.status === 'running');
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
