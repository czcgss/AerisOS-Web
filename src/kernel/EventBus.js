export class EventBus {
  #listeners = new Map();

  on(event, listener) {
    const listeners = this.#listeners.get(event) || new Set();
    listeners.add(listener);
    this.#listeners.set(event, listeners);
    return () => listeners.delete(listener);
  }

  emit(event, detail) {
    for (const listener of this.#listeners.get(event) || []) listener(detail);
    for (const listener of this.#listeners.get('*') || []) listener({ event, detail });
  }
}
