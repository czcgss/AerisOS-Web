import { icon } from '../icons.js';

export class WindowManager {
  constructor(layer, registry, context) {
    this.layer = layer; this.registry = registry; this.context = context;
    this.windows = new Map(); this.z = 20; this.sequence = 0;
  }

  open(appId, options = {}) {
    const app = this.registry.get(appId);
    if (!app) throw new Error(`Unknown application: ${appId}`);
    if(app.internal)throw new Error(`Internal capability is not a launchable application: ${appId}`);
    if (app.singleInstance) {
      const current = [...this.windows.values()].find(window => window.app.id === appId);
      if (current) { current.element.hidden = false; this.focus(current.id); return current; }
    }
    const id = `window-${++this.sequence}`;
    const width = Math.min(options.width || app.width || 820, innerWidth - 32);
    const dock = this.layer.closest('.desktop')?.querySelector('.dock');
    const dockTop = dock?.getBoundingClientRect().top || innerHeight - 75;
    const topBound = 48;
    const bottomBound = Math.max(topBound + 260, Math.ceil(dockTop - 8));
    const height = Math.min(options.height || app.height || 560, bottomBound - topBound);
    const offset = this.windows.size * 22;
    const left=options.left??Math.max(12,(innerWidth-width)/2+offset),top=options.top??Math.max(topBound,topBound+(bottomBound-topBound-height)/2+offset/2);
    const record = { id, app, cleanup: null, maximized: false, fullscreen: false, previous: null, fullscreenPrevious: null, restored: !!options.restored, launchOptions: { path: options.path || '' } };
    const element = document.createElement('article');
    element.className = 'window focused'; element.dataset.id = id;
    element.style.cssText = `left:${left}px;top:${top}px;width:${width}px;height:${height}px;z-index:${++this.z}`;
    element.innerHTML = `<header class="titlebar"><div class="window-controls"><button class="win-close" data-window-action="close" aria-label="Close"></button><button class="win-min" data-window-action="minimize" aria-label="Minimize"></button><button class="win-max" data-window-action="maximize" aria-label="Maximize"></button></div><div class="window-title">${app.id==='ai'?'':`<span class="app-icon app-icon-${app.color || 'grey'}">${icon(app.icon,16)}</span>`}<span data-window-title>${this.context.i18n.t(app.title)}</span></div><div></div></header><div class="window-body" data-app-root></div><i class="resize-handle"></i>`;
    this.layer.appendChild(element); record.element = element; this.windows.set(id, record);
    this.#bindWindow(record);
    record.cleanup = app.mount(element.querySelector('[data-app-root]'), { ...this.context, window: record, windowManager: this, launchOptions: record.launchOptions }) || null;
    this.focus(id); this.context.kernel.bus.emit('window:opened', { id, appId }); this.#persistSession();
    return record;
  }

  close(id) {
    const record=this.windows.get(id);if(!record)return;
    const wasFocused=record.element.classList.contains('focused');
    let cleanup;
    try{cleanup=record.cleanup?.()}catch(error){this.context.kernel.bus.emit('app:cleanup-error',{appId:record.app.id,error})}
    record.cleanup=null;record.element.remove();this.windows.delete(id);this.#syncFullscreenChrome();
    const remaining=this.isOpen(record.app.id);
    this.context.kernel.bus.emit('window:closed',{id,appId:record.app.id,remaining});this.#persistSession();
    if(wasFocused){const next=[...this.windows.values()].filter(item=>!item.element.hidden).sort((a,b)=>(Number(b.element.style.zIndex)||0)-(Number(a.element.style.zIndex)||0))[0];if(next)this.focus(next.id);else{this.context.kernel.bus.emit('window:focused',null);this.context.kernel.bus.emit('window:context-focused',null)}}
    Promise.resolve(cleanup).catch(error=>this.context.kernel.bus.emit('app:cleanup-error',{appId:record.app.id,error}));
  }
  isOpen(appId) { return [...this.windows.values()].some(record => record.app.id === appId); }
  closeApp(appId) { [...this.windows.values()].filter(record => record.app.id === appId).forEach(record => this.close(record.id)); }
  minimize(id) { const record = this.windows.get(id); if (record) { if(record.fullscreen)this.maximize(id);record.element.hidden=true;this.context.kernel.bus.emit('window:minimized',{id,appId:record.app.id});this.#syncFullscreenChrome();this.#persistSession(); } }
  focus(id) { const record = this.windows.get(id); if (!record) return; document.querySelectorAll('.window').forEach(el => el.classList.remove('focused')); record.element.classList.add('focused'); record.element.style.zIndex = ++this.z; this.context.kernel.bus.emit('window:focused', record.app.id);this.context.kernel.bus.emit('window:context-focused',this.#contextWindow(record)); }
  contextWindows(){return [...this.windows.values()].filter(record=>record.app.id!=='ai').map(record=>this.#contextWindow(record)).sort((a,b)=>Number(a.minimized)-Number(b.minimized)||Number(b.focused)-Number(a.focused)||b.zIndex-a.zIndex)}
  snapshotApp(appId){
    return [...this.windows.values()].filter(record=>record.app.id===appId).map(record=>{
      const {element,maximized,fullscreen,launchOptions}=record,normalStyle=maximized?record.previous:fullscreen?record.fullscreenPrevious:element.style.cssText,style=document.createElement('div').style;
      style.cssText=normalStyle||element.style.cssText;
      return{left:parseFloat(style.left)||0,top:parseFloat(style.top)||48,width:parseFloat(style.width)||element.offsetWidth,height:parseFloat(style.height)||element.offsetHeight,maximized,fullscreen,minimized:element.hidden,focused:element.classList.contains('focused'),launchOptions:{...launchOptions}};
    });
  }
  restoreApp(appId,states=[]){
    let focused=null;
    for(const state of states){
      const record=this.open(appId,{left:state.left,top:state.top,width:state.width,height:state.height,path:state.launchOptions?.path||'',restored:true});
      if(state.maximized)this.zoom(record.id);if(state.fullscreen)this.maximize(record.id);if(state.minimized)record.element.hidden=true;if(state.focused&&!state.minimized)focused=record.id;
    }
    this.#syncFullscreenChrome();if(focused)this.focus(focused);this.#persistSession();
  }
  focusNext(){const visible=[...this.windows.values()].filter(record=>!record.element.hidden);if(!visible.length)return;const focused=visible.findIndex(record=>record.element.classList.contains('focused')),next=visible[(focused+1)%visible.length];this.focus(next.id)}
  snap(id,side){const record=this.windows.get(id);if(!record||record.maximized)return;const element=record.element;if(!record.previous)record.previous=element.style.cssText;element.style.cssText+=side==='left'?`;left:10px;top:46px;width:calc(50vw - 15px);height:calc(100vh - 122px);z-index:${++this.z}`:`;left:calc(50vw + 5px);top:46px;width:calc(50vw - 15px);height:calc(100vh - 122px);z-index:${++this.z}`;element.classList.add('snapped');this.#persistSession()}
  maximize(id) {
    const record = this.windows.get(id); if (!record) return;
    if (!record.fullscreen) {
      for (const other of this.windows.values()) if (other.fullscreen) this.maximize(other.id);
      record.fullscreenPrevious = record.element.style.cssText;
      record.element.style.cssText += `;position:fixed;inset:0;width:auto;height:auto;z-index:${++this.z}`;
    } else record.element.style.cssText = record.fullscreenPrevious;
    record.fullscreen = !record.fullscreen;
    record.element.classList.toggle('fullscreen', record.fullscreen);
    this.#syncFullscreenChrome();
    this.#persistSession();
  }

  zoom(id) {
    const record = this.windows.get(id); if (!record || record.fullscreen) return;
    if (!record.maximized) {
      record.previous = record.element.style.cssText;
      const dock = this.layer.closest('.desktop')?.querySelector('.dock');
      const dockTop = dock?.getBoundingClientRect().top || innerHeight - 75;
      const bottomInset = Math.max(0, Math.ceil(innerHeight - dockTop));
      // Title-bar zoom fills the usable desktop, not the physical viewport.
      // Sit flush against the system bar while retaining a subtle frame beside
      // the wallpaper and Dock. True fullscreen remains a separate action.
      const topInset = 0;
      const sideInset = 1;
      const dockGap = 1;
      record.element.style.cssText += `;inset:${topInset}px ${sideInset}px ${bottomInset+dockGap}px ${sideInset}px;width:auto;height:auto;z-index:${++this.z}`;
    } else record.element.style.cssText = record.previous;
    record.maximized = !record.maximized;
    record.element.classList.toggle('maximized', record.maximized);
    record.element.classList.remove('snapped');
    this.#persistSession();
  }

  restoreSession() {
    if(!this.context.settings.get('restoreSession'))return;
    let session=[];try{session=JSON.parse(localStorage.getItem('aeris.window-session')||'[]')}catch{}
    this.restoring=true;
    for(const state of session){const app=this.registry.get(state.appId);if(!app||app.internal)continue;const record=this.open(state.appId,{left:state.left,top:state.top,width:state.width,height:state.height,path:state.launchOptions?.path||'',restored:true});if(state.maximized)this.zoom(record.id);if(state.fullscreen)this.maximize(record.id);if(state.minimized)record.element.hidden=true}
    this.restoring=false;
  }

  refreshLabels() { for (const record of this.windows.values()) record.element.querySelector('[data-window-title]').textContent = this.context.i18n.t(record.app.title); }

  #bindWindow(record) {
    const { element, id } = record, bar = element.querySelector('.titlebar'), handle = element.querySelector('.resize-handle');
    let drag;
    element.addEventListener('pointerdown', () => this.focus(id));
    element.querySelector('[data-window-action="close"]').onclick = () => this.close(id);
    element.querySelector('[data-window-action="minimize"]').onclick = () => this.minimize(id);
    element.querySelector('[data-window-action="maximize"]').onclick = () => this.maximize(id);
    bar.ondblclick = event => {
      if(event.button!==0||event.target.closest('button'))return;
      event.preventDefault();
      if(drag?.pointerId!=null&&bar.hasPointerCapture(drag.pointerId))bar.releasePointerCapture(drag.pointerId);
      drag=null;
      this.zoom(id);
    };
    const stopDrag=event=>{const released=drag;drag=null;if(event?.pointerId!=null&&bar.hasPointerCapture(event.pointerId))bar.releasePointerCapture(event.pointerId);if(released&&event){if(event.clientY<=48)return this.zoom(id);if(event.clientX<=8)return this.snap(id,'left');if(event.clientX>=innerWidth-8)return this.snap(id,'right')}this.#persistSession()};
    bar.onpointerdown = event => { if (event.button!==0||event.detail>1||event.target.closest('button')||record.maximized||record.fullscreen) return; const rect=element.getBoundingClientRect(); drag={pointerId:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top}; bar.setPointerCapture(event.pointerId); };
    bar.onpointermove = event => { if (!drag) return;if(event.pointerId!==drag.pointerId||!(event.buttons&1))return stopDrag(event);element.style.left=Math.max(-element.offsetWidth+130,drag.left+event.clientX-drag.x)+'px';element.style.top=Math.max(44,drag.top+event.clientY-drag.y)+'px'; };
    bar.onpointerup=stopDrag;bar.onpointercancel=stopDrag;bar.onlostpointercapture=()=>drag=null;
    let resize;
    const stopResize=event=>{resize=null;if(event?.pointerId!=null&&handle.hasPointerCapture(event.pointerId))handle.releasePointerCapture(event.pointerId);this.#persistSession()};
    handle.onpointerdown = event => { if(event.button!==0||record.maximized||record.fullscreen)return;event.preventDefault();const rect=element.getBoundingClientRect();if(element.classList.contains('snapped')){const layerRect=this.layer.getBoundingClientRect();element.style.inset='auto';element.style.left=`${rect.left-layerRect.left}px`;element.style.top=`${rect.top-layerRect.top}px`;element.style.width=`${rect.width}px`;element.style.height=`${rect.height}px`;element.classList.remove('snapped');record.previous=null}resize={pointerId:event.pointerId,x:event.clientX,y:event.clientY,width:rect.width,height:rect.height,left:rect.left,top:rect.top};handle.setPointerCapture(event.pointerId); };
    handle.onpointermove = event => { if (!resize) return;if(event.pointerId!==resize.pointerId||!(event.buttons&1))return stopResize(event);const minWidth=record.app.minWidth||340,minHeight=record.app.minHeight||260,maxWidth=Math.max(minWidth,innerWidth-resize.left-8),maxHeight=Math.max(minHeight,innerHeight-resize.top-8);element.style.width=Math.min(maxWidth,Math.max(minWidth,resize.width+event.clientX-resize.x))+'px';element.style.height=Math.min(maxHeight,Math.max(minHeight,resize.height+event.clientY-resize.y))+'px'; };
    handle.onpointerup=stopResize;handle.onpointercancel=stopResize;handle.onlostpointercapture=()=>resize=null;
  }

  persistSession(){this.#persistSession()}
  #syncFullscreenChrome(){this.layer.closest('.desktop')?.classList.toggle('has-fullscreen-window',[...this.windows.values()].some(record=>record.fullscreen))}
  #contextWindow(record){return{id:record.id,appId:record.app.id,title:this.context.i18n.t(record.app.title),icon:record.app.icon,color:record.app.color||'grey',path:record.launchOptions?.path||'',minimized:record.element.hidden,focused:record.element.classList.contains('focused'),zIndex:Number(record.element.style.zIndex)||0}}
  #persistSession(){if(this.restoring||!this.context.settings.get('restoreSession'))return;const session=[...this.windows.values()].map(record=>{const{app,element,maximized,fullscreen,launchOptions}=record,normalStyle=maximized?record.previous:fullscreen?record.fullscreenPrevious:element.style.cssText,style=document.createElement('div').style;style.cssText=normalStyle||element.style.cssText;return{appId:app.id,left:parseFloat(style.left)||0,top:parseFloat(style.top)||48,width:parseFloat(style.width)||element.offsetWidth,height:parseFloat(style.height)||element.offsetHeight,maximized,fullscreen,minimized:element.hidden,launchOptions}});localStorage.setItem('aeris.window-session',JSON.stringify(session))}
}
