export class AppRegistry {
  constructor() { this.apps = new Map(); this.listeners = new Set(); }
  register(app) {
    if (!app.id || !app.mount) throw new Error('Applications require id and mount');
    if (this.apps.has(app.id)) throw new Error(`Application already registered: ${app.id}`);
    this.apps.set(app.id, app);
    this.#emit({type:'registered',app});
    return this;
  }
  unregister(id) {
    const app=this.apps.get(id);if(!app)return false;
    this.apps.delete(id);this.#emit({type:'unregistered',app});return true;
  }
  get(id) { return this.apps.get(id); }
  list() { return [...this.apps.values()]; }
  subscribe(listener) { this.listeners.add(listener);return()=>this.listeners.delete(listener); }
  #emit(change) { for(const listener of this.listeners)listener(change); }
}
