import { validateAppPackage, localePacks } from '../platform/apps/AppPackage.js';

const PACKAGES_KEY='aeris.app-runtime.packages.v1';
const STATE_PREFIX='aeris.app-runtime.state.v1.';
const MAX_STATE_BYTES=128*1024;
const clone=value=>structuredClone(value);
const json=value=>JSON.stringify(value).replace(/</g,'\\u003c');
const scriptText=value=>String(value||'').replace(/<\/script/gi,'<\\/script');
const styleText=value=>String(value||'').replace(/<\/style/gi,'<\\/style');

const sdkBootstrap = `
(() => {
  let port, environment = {}, state = {}, sequence = 0;
  const pending = new Map(), stateListeners = new Set(), environmentListeners = new Set();
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    if (!port) return reject(new Error('Aeris SDK is not connected.'));
    const id = ++sequence; pending.set(id, { resolve, reject }); port.postMessage({ type: 'request', id, method, params });
  });
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const applyEnvironment = value => {
    environment = value || {}; document.documentElement.lang = environment.locale || 'en';
    document.documentElement.dataset.theme = environment.theme || 'light';
    document.documentElement.dataset.themeId = environment.themeId || environment.theme || 'light';
    document.documentElement.dataset.themeMotion = environment.tokens?.motion?.scale === 0 ? 'none' : 'full';
    for (const [name, token] of Object.entries(environment.variables || {})) document.documentElement.style.setProperty(name, token);
    document.documentElement.style.setProperty('--accent', environment.accent || '#1788c8');
    environmentListeners.forEach(listener => listener({ ...environment }));
  };
  const api = Object.freeze({
    ready,
    app: Object.freeze({
      getState: async () => clone(await request('get-state')),
      setState: value => request('set-state', { value }),
      patchState: patch => request('patch-state', { patch }),
      subscribe(listener) { stateListeners.add(listener); if (port) listener(clone(state)); return () => stateListeners.delete(listener); },
    }),
    activity: Object.freeze({ openFullApp: () => request('open-full-app') }),
    environment: Object.freeze({ get current() { return { ...environment }; }, subscribe(listener) { environmentListeners.add(listener); if (port) listener({ ...environment }); return () => environmentListeners.delete(listener); } }),
    i18n: Object.freeze({ t(key) { return environment.strings?.[key] ?? key; } }),
  });
  const clone = value => structuredClone(value);
  Object.defineProperty(window, 'Aeris', { value: api, writable: false, configurable: false });
  addEventListener('message', event => {
    if (event.data?.type !== 'aeris:connect' || !event.ports?.[0] || port) return;
    port = event.ports[0];
    port.onmessage = message => {
      const data = message.data || {};
      if (data.type === 'response') { const task = pending.get(data.id); if (!task) return; pending.delete(data.id); data.error ? task.reject(new Error(data.error)) : task.resolve(data.result); }
      if (data.type === 'state') { state = clone(data.value || {}); stateListeners.forEach(listener => listener(clone(state))); }
      if (data.type === 'environment') applyEnvironment(data.value);
    };
    state = clone(event.data.state || {}); applyEnvironment(event.data.environment || {}); port.start(); resolveReady(api);
    stateListeners.forEach(listener => listener(clone(state)));
  }, { once: true });
  addEventListener('contextmenu', event => {
    event.preventDefault();
    port?.postMessage({ type: 'event', name: 'contextmenu', x: event.clientX, y: event.clientY });
  }, true);
})();`;

export class AppRuntimeService {
  constructor({registry,storage=globalThis.localStorage,bundledPackages=[],themeRuntime=null}={}){
    this.registry=registry;this.storage=storage;this.bundledPackages=bundledPackages;this.themeRuntime=themeRuntime;this.packages=new Map();this.mounts=new Map();this.environmentListeners=[];
  }

  async prepare(){
    let records=[];try{records=JSON.parse(this.storage?.getItem(PACKAGES_KEY)||'[]')}catch{}
    for(const record of Array.isArray(records)?records:[]){try{const appPackage=validateAppPackage(record.package);if(this.registry.get(appPackage.manifest.id))throw new Error(`Application id is already in use: ${appPackage.manifest.id}`);this.packages.set(appPackage.manifest.id,{package:appPackage,source:record.source||'user'})}catch(error){console.warn('Skipped invalid Aeris app package.',error)}}
    for(const source of this.bundledPackages){
      const appPackage=validateAppPackage(source),current=this.packages.get(appPackage.manifest.id);
      if(!this.registry.get(appPackage.manifest.id)&&(!current||current.source==='bundled'))this.packages.set(appPackage.manifest.id,{package:appPackage,source:'bundled'});
    }
    this.#persistPackages();
    for(const {package:appPackage} of this.packages.values())this.#register(appPackage);
  }

  start(){this.environmentListeners.push(this.kernel.bus.on('settings:change',()=>this.#broadcastEnvironment()),this.kernel.bus.on('theme:changed',()=>this.#broadcastEnvironment()));}
  stop(){this.environmentListeners.splice(0).forEach(off=>off());for(const appId of this.mounts.keys())this.#closeMounts(appId);}
  list(){return [...this.packages.values()].map(record=>({manifest:clone(record.package.manifest),source:record.source}));}
  get(appId){const record=this.packages.get(appId);return record?clone(record.package):null;}

  install(source,{replace=false,preserveState=replace}={}){
    const appPackage=validateAppPackage(source),id=appPackage.manifest.id,current=this.packages.get(id);
    if(this.registry.get(id)&&!current)throw new Error(`Application id is already in use: ${id}`);
    if(current&&!replace)throw new Error(`Application is already installed: ${id}`);
    if(current?.source==='bundled')throw new Error('Bundled applications cannot be replaced.');
    if(current){
      this.kernel?.bus.emit('app-runtime:before-update',{appId:id,manifest:clone(current.package.manifest)});
      this.uninstall(id,{persist:false,preserveState,lifecycle:'update'});
    }
    this.packages.set(id,{package:appPackage,source:'user'});this.#register(appPackage);this.#persistPackages();
    this.kernel?.bus.emit(current?'app-runtime:updated':'app-runtime:installed',{appId:id,manifest:clone(appPackage.manifest),preservedState:Boolean(current&&preserveState)});
    return clone(appPackage.manifest);
  }

  uninstall(appId,{allowBundled=false,persist=true,preserveState=false,lifecycle='uninstall'}={}){
    const record=this.packages.get(appId);if(!record)return false;
    if(record.source==='bundled'&&!allowBundled)throw new Error('Bundled applications cannot be uninstalled.');
    if(lifecycle==='uninstall')this.kernel?.bus.emit('app-runtime:before-uninstall',{appId,manifest:clone(record.package.manifest)});
    this.#closeMounts(appId);this.registry.unregister(appId);this.packages.delete(appId);if(!preserveState)this.storage?.removeItem(`${STATE_PREFIX}${appId}`);if(persist)this.#persistPackages();
    if(lifecycle==='uninstall')this.kernel?.bus.emit('app-runtime:uninstalled',{appId});
    return true;
  }

  mount(appId,viewName,root,context={},target={}){
    const record=this.packages.get(appId);if(!record)throw new Error(`Unknown extension application: ${appId}`);
    const appPackage=record.package,view=appPackage.manifest.views[viewName];if(!view)throw new Error(`Unknown extension view: ${viewName}`);
    root.innerHTML='<div class="aeris-extension-loading" role="status"><i></i><span>Opening app…</span></div>';
    const iframe=document.createElement('iframe');iframe.className='aeris-extension-frame';iframe.title=this.#localized(appPackage.manifest.name,context.i18n?.locale);iframe.sandbox='allow-scripts';iframe.referrerPolicy='no-referrer';iframe.hidden=true;
    const channel=new MessageChannel(),mount={iframe,port:channel.port1,context,viewName,target};
    const mounts=this.mounts.get(appId)||new Set();mounts.add(mount);this.mounts.set(appId,mounts);
    channel.port1.onmessage=event=>this.#handleRequest(appId,mount,event.data);
    channel.port1.start();
    iframe.onload=()=>{
      iframe.onload=null;
      iframe.hidden=false;root.querySelector('.aeris-extension-loading')?.remove();
      iframe.contentWindow?.postMessage({type:'aeris:connect',state:this.#state(appPackage),environment:this.#environment(appPackage,context,viewName,target)},'*',[channel.port2]);
    };
    // Assign srcdoc before insertion. Otherwise the initial about:blank load
    // can consume the only transferable SDK MessagePort before the real app
    // document has installed its connection listener.
    iframe.srcdoc=this.#document(appPackage,viewName);root.append(iframe);
    return()=>{mounts.delete(mount);channel.port1.close();iframe.remove();if(!mounts.size)this.mounts.delete(appId)};
  }

  #register(appPackage){
    const manifest=appPackage.manifest,id=manifest.id;
    this.registry.register({
      id,title:manifest.name,description:manifest.description,icon:manifest.icon,color:manifest.color,extension:true,
      width:manifest.window.width,height:manifest.window.height,minWidth:manifest.window.minWidth,minHeight:manifest.window.minHeight,singleInstance:manifest.singleInstance,
      mount:(root,context)=>this.mount(id,'main',root,context),
      activity:{mount:(root,context,target)=>this.mount(id,'activity',root,context,target)},
    });
  }

  #state(appPackage){
    try{const stored=this.storage?.getItem(`${STATE_PREFIX}${appPackage.manifest.id}`);return stored?JSON.parse(stored):clone(appPackage.manifest.initialState)}catch{return clone(appPackage.manifest.initialState)}
  }

  #setState(appPackage,value){
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Application state must be an object.');
    const state=clone(value),encoded=JSON.stringify(state);if(new TextEncoder().encode(encoded).length>MAX_STATE_BYTES)throw new Error(`Application state exceeds ${MAX_STATE_BYTES} bytes.`);this.storage?.setItem(`${STATE_PREFIX}${appPackage.manifest.id}`,encoded);
    for(const mount of this.mounts.get(appPackage.manifest.id)||[])mount.port.postMessage({type:'state',value:clone(state)});
    this.kernel?.bus.emit('app-runtime:state-changed',{appId:appPackage.manifest.id,state:clone(state)});return state;
  }

  async #handleRequest(appId,mount,message){
    if(message?.type==='event'){
      if(message.name==='contextmenu'){
        const rect=mount.iframe.getBoundingClientRect();
        mount.iframe.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:rect.left+(Number(message.x)||0),clientY:rect.top+(Number(message.y)||0),button:2,buttons:2}));
      }
      return;
    }
    if(message?.type!=='request')return;const {id,method,params={}}=message,record=this.packages.get(appId);if(!record)return;
    try{
      let result;
      if(method==='get-state')result=this.#state(record.package);
      else if(method==='set-state')result=this.#setState(record.package,params.value);
      else if(method==='patch-state')result=this.#setState(record.package,{...this.#state(record.package),...(params.patch||{})});
      else if(method==='open-full-app'){if(typeof mount.context.openFullApp==='function')mount.context.openFullApp(appId);else mount.context.shell?.open(appId);result={opened:true};}
      else throw new Error(`Unsupported Aeris SDK method: ${method}`);
      mount.port.postMessage({type:'response',id,result:clone(result)});
    }catch(error){mount.port.postMessage({type:'response',id,error:error.message||String(error)})}
  }

  #environment(appPackage,context,viewName,target){
    const settings=context.settings,locale=context.i18n?.locale||settings?.get?.('locale')||'en',packs=localePacks(appPackage);
    const theme=this.themeRuntime?.snapshot()||context.themeRuntime?.snapshot();return {appId:appPackage.manifest.id,view:viewName,locale,strings:packs[locale]||packs.en,theme:theme?.baseMode||'light',themeId:theme?.id||settings?.get?.('theme')||'light',themeVersion:theme?.version||'',tokens:clone(theme?.tokens||{}),variables:clone(theme?.variables||{}),accent:theme?.tokens?.colors?.accent||settings?.get?.('accent')||'#1788c8',target:clone(target||{})};
  }

  #broadcastEnvironment(){for(const [appId,mounts] of this.mounts)for(const mount of mounts){const record=this.packages.get(appId);if(record)mount.port.postMessage({type:'environment',value:this.#environment(record.package,mount.context,mount.viewName,mount.target)})}}
  #localized(value,locale='en'){return value?.[locale]||value?.en||Object.values(value||{})[0]||''}
  #closeMounts(appId){for(const mount of [...(this.mounts.get(appId)||[])]){mount.port.close();mount.iframe.remove()}this.mounts.delete(appId)}
  #persistPackages(){this.storage?.setItem(PACKAGES_KEY,JSON.stringify([...this.packages.values()].map(record=>({source:record.source,package:record.package}))))}

  #document(appPackage,viewName){
    const view=appPackage.manifest.views[viewName],files=appPackage.files;
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; font-src data:; connect-src 'none'"><style>:root{color-scheme:light;--font-ui:Manrope,"SF Pro Display","Segoe UI",sans-serif;--font-mono:"Ubuntu Mono",ui-monospace,SFMono-Regular,Menlo,monospace;--accent:#5f87d7;--surface:#e5edf2;--surface-2:#eef4f7;--text:#31445a;--muted:#77899b;--line:rgba(96,122,138,.13);--light:#fff;--dark:#b4c5d0;--shadow:-7px -7px 18px rgba(255,255,255,.78),8px 8px 22px rgba(118,142,157,.27);--small-shadow:-4px -4px 10px rgba(255,255,255,.68),4px 4px 10px rgba(118,142,157,.22);--inset:inset 3px 3px 7px rgba(118,142,157,.22),inset -3px -3px 7px rgba(255,255,255,.65);font-family:var(--font-ui);background:var(--surface);color:var(--text)}:root[data-theme="dark"]{color-scheme:dark;--surface:#2d4350;--surface-2:#354d5b;--text:#dce7ed;--muted:#91a6b2;--line:rgba(255,255,255,.09);--light:#49616f;--dark:#172a35;--shadow:-6px -6px 16px rgba(75,99,112,.24),7px 8px 20px rgba(9,22,29,.34);--small-shadow:-3px -3px 9px rgba(75,99,112,.2),4px 4px 10px rgba(9,22,29,.3);--inset:inset 3px 3px 7px rgba(7,20,27,.3),inset -3px -3px 7px rgba(78,102,115,.18)}*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden}body{background:var(--surface);color:var(--text)}button,input,textarea,select{font:inherit;color:inherit}button{border:0;cursor:default}button:focus-visible,input:focus-visible,textarea:focus-visible,select:focus-visible{outline:2px solid var(--accent);outline-offset:2px}::selection{background:color-mix(in srgb,var(--accent) 38%,transparent);color:inherit}:root[data-theme-motion="none"] *,:root[data-theme-motion="none"] *:before,:root[data-theme-motion="none"] *:after{animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}@media(prefers-reduced-motion:reduce){*,*:before,*:after{scroll-behavior:auto!important;animation-duration:.001ms!important;animation-iteration-count:1!important;transition-duration:.001ms!important}}</style><style>${styleText(files[view.css])}</style></head><body>${files[view.html]}<script>${scriptText(sdkBootstrap)}</script><script>${scriptText(files[view.script])}</script></body></html>`;
  }
}
