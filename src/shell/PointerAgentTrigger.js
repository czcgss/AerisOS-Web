import {icon} from '../icons.js';

const DWELL_DELAY=760;
const VISIBLE_DURATION=2800;
const MOVE_THRESHOLD=5;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));

export class PointerAgentTrigger{
  constructor(host,context,windowManager){this.host=host;this.context=context;this.windowManager=windowManager;this.point=null;this.press=null;this.dwellTimer=0;this.hideTimer=0;this.lastKeyboardAt=0;this.visible=false}

  mount(){
    this.node=document.createElement('button');this.node.className='pointer-agent-trigger';this.node.type='button';this.node.hidden=true;this.node.setAttribute('aria-label',this.context.i18n.t('askFuture'));this.node.title=this.context.i18n.t('askFuture');this.node.innerHTML=`<span>${icon('futureAi',17)}</span>`;this.host.appendChild(this.node);
    this.onMove=event=>this.#move(event);this.onPointerDown=event=>this.#pointerDown(event);this.onPointerUp=event=>this.#pointerUp(event);this.onWheel=()=>this.#cancel();this.onKeyDown=()=>{this.lastKeyboardAt=performance.now();this.#cancel()};this.onContextMenu=()=>this.#cancel();
    document.addEventListener('pointermove',this.onMove,{passive:true});document.addEventListener('pointerdown',this.onPointerDown,true);document.addEventListener('pointerup',this.onPointerUp,true);document.addEventListener('wheel',this.onWheel,{passive:true,capture:true});document.addEventListener('keydown',this.onKeyDown,true);document.addEventListener('contextmenu',this.onContextMenu,true);
    this.node.addEventListener('pointerenter',()=>clearTimeout(this.hideTimer));this.node.addEventListener('pointerleave',()=>{clearTimeout(this.hideTimer);this.hideTimer=setTimeout(()=>this.#hide(),420)});this.node.addEventListener('click',event=>this.#open(event));
  }

  destroy(){clearTimeout(this.dwellTimer);clearTimeout(this.hideTimer);document.removeEventListener('pointermove',this.onMove);document.removeEventListener('pointerdown',this.onPointerDown,true);document.removeEventListener('pointerup',this.onPointerUp,true);document.removeEventListener('wheel',this.onWheel,true);document.removeEventListener('keydown',this.onKeyDown,true);document.removeEventListener('contextmenu',this.onContextMenu,true);this.node?.remove()}

  #pointerDown(event){if(event.target.closest?.('.pointer-agent-trigger'))return;this.#cancel();if((!event.pointerType||event.pointerType==='mouse')&&event.button===0)this.press={x:event.clientX,y:event.clientY}}
  #pointerUp(event){
    if(event.target.closest?.('.pointer-agent-trigger'))return;const press=this.press;this.press=null;
    if(!press||event.button!==0||event.pointerType&&event.pointerType!=='mouse'||Math.hypot(event.clientX-press.x,event.clientY-press.y)>MOVE_THRESHOLD||!this.#eligible(event.target))return;
    const windowElement=event.target.closest?.('.window'),windowId=windowElement?.dataset.id||'',windowContext=windowId?this.windowManager.contextWindows().find(item=>item.id===windowId):null;if(windowElement&&!windowContext)return;
    this.point={x:event.clientX,y:event.clientY,target:event.target,windowId};clearTimeout(this.dwellTimer);this.dwellTimer=setTimeout(()=>this.#show(),DWELL_DELAY);
  }

  #move(event){
    if(event.target.closest?.('.pointer-agent-trigger'))return;
    // Once revealed, keep the affordance fixed long enough for the pointer to
    // travel from its resting position to the button. A pointerdown elsewhere,
    // scrolling, keyboard input, or the visibility timeout still dismisses it.
    if(this.visible)return;
    if(!this.point)return;
    if(event.pointerType&&event.pointerType!=='mouse'||event.buttons||Math.hypot(event.clientX-this.point.x,event.clientY-this.point.y)>MOVE_THRESHOLD)this.#cancel();
  }

  #eligible(target){
    if(!(target instanceof Element)||!document.body.classList.contains('system-ready'))return false;
    if(this.host.closest?.('[inert]')||this.host.querySelector('.compact-agent-panel:not([hidden])'))return false;
    if(target.closest('.system-bar,.dock,.titlebar,.resize-handle,.shell-overlays,.floating-panel,.notification-banner-stack,.toast-stack,.compact-agent-panel,[role="dialog"],.dialog-backdrop,.setup-assistant,.boot-screen'))return false;
    if(target.closest('input,textarea,select,[contenteditable="true"],.xterm')||performance.now()-this.lastKeyboardAt<1100)return false;
    return Boolean(target.closest('.desktop'));
  }

  #show(){
    this.dwellTimer=0;const point=this.point,target=point?document.elementFromPoint(point.x,point.y):null;if(!point||!target||!this.#eligible(target))return;if(point.windowId&&!this.windowManager.contextWindows().some(item=>item.id===point.windowId))return;point.target=target;
    const size=36,left=clamp(point.x-size-10,8,innerWidth-size-8),top=clamp(point.y-size/2,42,innerHeight-size-74);
    this.node.style.left=`${left}px`;this.node.style.top=`${top}px`;this.node.hidden=false;this.visible=true;requestAnimationFrame(()=>this.node.classList.add('visible'));
    clearTimeout(this.hideTimer);this.hideTimer=setTimeout(()=>this.#hide(),VISIBLE_DURATION);
  }

  #hide(){clearTimeout(this.hideTimer);this.hideTimer=0;if(!this.visible){if(this.node)this.node.hidden=true;return}this.visible=false;this.node.classList.remove('visible');setTimeout(()=>{if(!this.visible)this.node.hidden=true},150)}
  #cancel(){clearTimeout(this.dwellTimer);this.dwellTimer=0;this.point=null;this.press=null;this.#hide()}

  #open(event){
    event.preventDefault();event.stopPropagation();const point=this.point;
    if(point?.windowId){const target=this.windowManager.contextWindows().find(item=>item.id===point.windowId);if(target)this.context.agentContext.selectWindow(target)}else this.context.agentContext.focusDesktop();
    this.context.agentEntry.open({source:'pointer-focus',mode:'compact',presentation:'contextual',anchor:point?{x:point.x,y:point.y}:null});this.#cancel();
  }
}

export const POINTER_AGENT_TIMING={dwellDelay:DWELL_DELAY,visibleDuration:VISIBLE_DURATION,moveThreshold:MOVE_THRESHOLD};
