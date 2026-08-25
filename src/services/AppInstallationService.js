const UNINSTALLED_KEY='aeris.apps.uninstalled.v1';

const USERDATA_BY_APP={calendar:['calendar'],reminders:['reminders'],notes:['notes'],contacts:['contacts'],photos:['photos']};
const STORAGE_BY_APP={
  ai:['aeris.ai.state.v1','aeris.ai.workspace','aeris.ai.agents.v1','aeris.ai.workflows.v1','aeris.ai.skills.v1'],
  browser:['aeris.browser.v1'],files:['aeris.finder.view'],music:['aeris.music.volume'],weather:['aeris.weather.cache','aeris.weather.location'],
};
const readIds=storage=>{try{const value=JSON.parse(storage?.getItem(UNINSTALLED_KEY)||'[]');return new Set(Array.isArray(value)?value.map(String):[])}catch{return new Set()}};

export class AppInstallationService{
  constructor({registry,appRuntime,userdata,settings,storage=globalThis.localStorage}={}){Object.assign(this,{registry,appRuntime,userdata,settings,storage});this.uninstalled=readIds(storage)}
  setRuntimeServices(services={}){this.runtimeServices=services}
  async prepare(){for(const id of [...this.uninstalled]){if(this.registry.get(id)?.internal){this.uninstalled.delete(id);continue}const runtime=this.appRuntime?.list().find(item=>item.manifest.id===id);if(runtime)this.appRuntime.uninstall(id,{allowBundled:true});else this.registry.unregister(id)}this.#persist()}
  canUninstall(id){const app=this.registry.get(String(id));return Boolean(app&&!app.internal)}
  async uninstall(id){
    id=String(id);const app=this.registry.get(id);if(!app||app.internal)return false;const runtime=this.appRuntime?.list().find(item=>item.manifest.id===id);
    if(runtime)this.appRuntime.uninstall(id,{allowBundled:true});else this.registry.unregister(id);
    if(!runtime||runtime.source==='bundled'){this.uninstalled.add(id);this.#persist()}
    this.settings?.set('dockApps',(this.settings.get('dockApps')||[]).filter(appId=>appId!==id));await this.#clearData(id);
    this.kernel?.bus.emit('app-installation:uninstalled',{appId:id});return true
  }
  async #clearData(id){await this.runtimeServices?.[id]?.clearData?.();await Promise.all((USERDATA_BY_APP[id]||[]).map(name=>this.userdata?.remove(name)));for(const key of STORAGE_BY_APP[id]||[])this.storage?.removeItem(key);if(id==='calendar'||id==='reminders')await this.#removeNotifications(id)}
  async #removeNotifications(appId){const state=await this.userdata?.load('notifications',{items:[],delivered:{}});if(!state)return;const prefix=`${appId}:`,items=(state.items||[]).filter(item=>item.appId!==appId),delivered=Object.fromEntries(Object.entries(state.delivered||{}).filter(([key])=>!key.startsWith(prefix)));await this.userdata.save('notifications',{items,delivered},{source:'app-uninstall'})}
  #persist(){this.storage?.setItem(UNINSTALLED_KEY,JSON.stringify([...this.uninstalled]))}
}

export const APP_UNINSTALLED_STORAGE_KEY=UNINSTALLED_KEY;
export const APP_USERDATA=USERDATA_BY_APP;
export const APP_STORAGE_KEYS=STORAGE_BY_APP;
