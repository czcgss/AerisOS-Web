const DEFAULTS = {
  locale: 'en', theme: 'light', accent: '#5f87d7', wallpaper: 'aurora',
  memory: 256, autoBoot: true, restoreSession: true,
  dockApps: ['files','photos','calendar','weather','notes','terminal','settings'],
  setupComplete: false, fullName: 'Aeris User', region: 'US', timezone: 'America/New_York',
  keyboardLayout: 'us', analytics: false, location: false, reduceMotion: false,
};

export class SettingsService {
  constructor(storage = localStorage) { this.storage = storage; this.values = { ...DEFAULTS }; }
  start() {
    try { this.values = { ...DEFAULTS, ...JSON.parse(this.storage.getItem('aeris.settings') || '{}') }; } catch {}
    if (this.values.memory < 256) {
      this.values.memory = 256;
      this.storage.setItem('aeris.settings', JSON.stringify(this.values));
    }
    if (!Array.isArray(this.values.dockApps)) this.values.dockApps = [...DEFAULTS.dockApps];
    if(!this.values.appSuiteVersion||this.values.appSuiteVersion<2){for(const id of ['photos','weather'])if(!this.values.dockApps.includes(id))this.values.dockApps.splice(Math.min(1,this.values.dockApps.length),0,id);this.values.appSuiteVersion=2;this.storage.setItem('aeris.settings',JSON.stringify(this.values))}
  }
  get(key) { return this.values[key]; }
  all() { return { ...this.values }; }
  set(key, value) {
    this.values[key] = value;
    this.storage.setItem('aeris.settings', JSON.stringify(this.values));
    this.kernel?.bus.emit('settings:change', { key, value });
  }
  update(values) { for (const [key,value] of Object.entries(values)) this.values[key]=value;this.storage.setItem('aeris.settings',JSON.stringify(this.values));this.kernel?.bus.emit('settings:batch-change',{...values}); }
}
