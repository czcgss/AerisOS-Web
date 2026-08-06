export class AppRegistry {
  constructor() { this.apps = new Map(); }
  register(app) {
    if (!app.id || !app.mount) throw new Error('Applications require id and mount');
    if (this.apps.has(app.id)) throw new Error(`Application already registered: ${app.id}`);
    this.apps.set(app.id, app);
    return this;
  }
  get(id) { return this.apps.get(id); }
  list() { return [...this.apps.values()]; }
}
