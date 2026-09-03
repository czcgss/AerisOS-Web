import {icon} from '../icons.js';

const COMMAND_PATTERN=/(?:@future|@伏秋)[ \t]+/gi;

const editableValue=target=>target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement?target.value:target.isContentEditable?target.innerText:'';
const caretOffset=target=>{
  if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement)return target.selectionStart??target.value.length;
  const selection=getSelection();if(!selection?.rangeCount||!target.contains(selection.anchorNode))return editableValue(target).length;
  const range=document.createRange();range.selectNodeContents(target);range.setEnd(selection.anchorNode,selection.anchorOffset);return range.toString().length;
};

export const locateSystemAgentCommand=(value,caret=String(value??'').length)=>{
  const text=String(value??''),limit=Math.max(0,Math.min(Number(caret)||0,text.length)),before=text.slice(0,limit);COMMAND_PATTERN.lastIndex=0;
  let match,last=null;while((match=COMMAND_PATTERN.exec(before)))last={start:match.index,promptStart:COMMAND_PATTERN.lastIndex,end:limit};
  if(!last)return null;const prompt=text.slice(last.promptStart,last.end).trim();return{...last,prompt};
};

const isEditable=target=>{
  if(!(target instanceof Element)||target.closest('.compact-agent-panel'))return false;
  if(target instanceof HTMLInputElement)return !['password','file','checkbox','radio','range','color','date','datetime-local','month','time','week','button','submit','reset','hidden'].includes(target.type)&&!target.disabled&&!target.readOnly;
  if(target instanceof HTMLTextAreaElement)return !target.disabled&&!target.readOnly;
  return target.isContentEditable;
};

const textPosition=(root,offset)=>{
  const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let remaining=offset,node;
  while((node=walker.nextNode())){if(remaining<=node.data.length)return{node,offset:remaining};remaining-=node.data.length}
  return{node:root,offset:root.childNodes.length};
};

const commandLayout=(target,command)=>{
  const bounds=target.getBoundingClientRect();
  if(target.isContentEditable){const start=textPosition(target,command.start),end=textPosition(target,command.end),range=document.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);const rects=[...range.getClientRects()].map(rect=>({left:Math.max(bounds.left,rect.left),top:Math.max(bounds.top,rect.top),right:Math.min(bounds.right,rect.right),bottom:Math.min(bounds.bottom,rect.bottom)})).filter(rect=>rect.right>rect.left&&rect.bottom>rect.top),last=rects.at(-1)||bounds;return{point:{x:last.right,y:last.bottom},rects}}
  const style=getComputedStyle(target),mirror=document.createElement('div'),highlight=document.createElement('span'),marker=document.createElement('span');
  mirror.setAttribute('aria-hidden','true');Object.assign(mirror.style,{position:'fixed',visibility:'hidden',pointerEvents:'none',boxSizing:style.boxSizing,width:`${bounds.width}px`,height:'auto',left:`${bounds.left-target.scrollLeft}px`,top:`${bounds.top-target.scrollTop}px`,padding:style.padding,border:style.border,font:style.font,letterSpacing:style.letterSpacing,lineHeight:style.lineHeight,textIndent:style.textIndent,textTransform:style.textTransform,whiteSpace:target instanceof HTMLInputElement?'pre':'pre-wrap',overflowWrap:'break-word',wordBreak:style.wordBreak});
  mirror.append(document.createTextNode(target.value.slice(0,command.start)));highlight.textContent=target.value.slice(command.start,command.end);mirror.append(highlight);marker.textContent='\u200b';mirror.append(marker);document.body.appendChild(mirror);const markerRect=marker.getBoundingClientRect(),rects=[...highlight.getClientRects()].map(rect=>({left:Math.max(bounds.left,rect.left),top:Math.max(bounds.top,rect.top),right:Math.min(bounds.right,rect.right),bottom:Math.min(bounds.bottom,rect.bottom)})).filter(rect=>rect.right>rect.left&&rect.bottom>rect.top),point={x:Math.min(bounds.right,markerRect.left),y:Math.min(bounds.bottom,markerRect.bottom)};mirror.remove();return{point,rects};
};

const removeCommand=(target,command)=>{
  if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement){
    const next=target.value.slice(0,command.start)+target.value.slice(command.end);target.value=next;target.setSelectionRange(command.start,command.start);
  }else{
    const start=textPosition(target,command.start),end=textPosition(target,command.end),range=document.createRange();range.setStart(start.node,start.offset);range.setEnd(end.node,end.offset);range.deleteContents();range.collapse(true);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);
  }
  target.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'deleteByCut',data:null}));
};

const applyWritingResult=(target,offset,text,operation='append')=>{
  if(!target?.isConnected)return false;
  const value=String(text??'');
  if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement){target.focus();target.setRangeText(value,operation==='replace'?0:offset,operation==='replace'?target.value.length:offset,'end')}
  else if(target.isContentEditable){const range=document.createRange();if(operation==='replace')range.selectNodeContents(target);else{const point=textPosition(target,offset);range.setStart(point.node,point.offset);range.collapse(true)}range.deleteContents();range.insertNode(document.createTextNode(value));range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);target.focus()}
  else return false;
  target.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:value}));return true;
};

export class SystemAgentCommand{
  constructor(host,context,windowManager){this.host=host;this.context=context;this.windowManager=windowManager;this.active=null;this.mounted=false}

  mount(){
    this.highlights=document.createElement('div');this.highlights.className='system-agent-command-highlights';this.highlights.hidden=true;this.host.appendChild(this.highlights);this.hint=document.createElement('div');this.hint.className='system-agent-command-hint';this.hint.hidden=true;this.hint.innerHTML=`<span>${icon('futureAi',12)}</span><strong>Future</strong><em>↵</em>`;this.host.appendChild(this.hint);this.mounted=true;
    this.onInput=event=>this.#inspect(event.target);this.onKeyDown=event=>this.#keyDown(event);this.onFocusOut=event=>{if(event.target===this.active)this.#deactivate()};
    document.addEventListener('input',this.onInput,true);document.addEventListener('keydown',this.onKeyDown,true);document.addEventListener('focusout',this.onFocusOut,true);
    this.offCommand=this.context.kernel.bus.on('system:agent-command',detail=>this.#open(detail));
  }

  destroy(){this.mounted=false;document.removeEventListener('input',this.onInput,true);document.removeEventListener('keydown',this.onKeyDown,true);document.removeEventListener('focusout',this.onFocusOut,true);this.offCommand?.();this.highlights?.remove();this.hint?.remove()}

  #inspect(target){
    if(!isEditable(target))return this.#deactivate();const command=locateSystemAgentCommand(editableValue(target),caretOffset(target));
    if(!command)return this.#deactivate();if(this.active&&this.active!==target)this.active.classList.remove('system-agent-command-active');this.active=target;target.classList.add('system-agent-command-active');this.#positionHint(target,command);
  }

  #keyDown(event){
    const target=event.target;if(!isEditable(target)||event.isComposing)return;
    if(event.key==='Escape'&&target===this.active){this.#deactivate();return}
    if(event.key!=='Enter'||event.shiftKey||event.altKey||event.ctrlKey||event.metaKey)return;
    const command=locateSystemAgentCommand(editableValue(target),caretOffset(target));if(!command?.prompt)return;
    event.preventDefault();event.stopImmediatePropagation();const rect=target.getBoundingClientRect(),windowId=target.closest('.window')?.dataset.id||'',original=editableValue(target),surrounding=`${original.slice(0,command.start)}${original.slice(command.end)}`,operation=surrounding.trim()?'insert':'replace',offset=command.start;removeCommand(target,command);this.#deactivate();
    this.#open({prompt:command.prompt,windowId,anchor:{x:Math.min(rect.right,innerWidth-24),y:Math.min(rect.bottom,innerHeight-24)},source:'system-input-command',writingTarget:{suggestedOperation:operation==='replace'?'replace':'append',apply:(text,nextOperation)=>applyWritingResult(target,offset,text,nextOperation)}});
  }

  #open(detail={}){
    const prompt=String(detail.prompt||'').trim();if(!prompt)return;const target=this.windowManager.contextWindows().find(item=>item.id===detail.windowId);
    if(target)this.context.agentContext.selectWindow(target);else if(detail.appId){const app=this.context.registry.get(detail.appId),name=app?this.context.i18n.t(app.title):detail.appId;this.context.agentContext.set({appId:detail.appId,label:name,resource:{kind:'application',id:detail.appId,uri:`future://apps/${detail.appId}`,name}})}
    const anchor=detail.anchor&&Number.isFinite(detail.anchor.x)&&Number.isFinite(detail.anchor.y)?detail.anchor:{x:innerWidth/2,y:innerHeight/2};
    this.context.agentEntry.open({prompt,autoSend:true,source:detail.source||'system-input-command',mode:'compact',agentMode:'writing',presentation:'contextual',anchor,writingTarget:detail.writingTarget});
  }

  #positionHint(target,command){const {point,rects}=commandLayout(target,command);this.highlights.replaceChildren(...rects.map(rect=>{const node=document.createElement('i');node.style.cssText=`left:${rect.left}px;top:${rect.top}px;width:${rect.right-rect.left}px;height:${rect.bottom-rect.top}px`;return node}));this.highlights.hidden=!rects.length;this.hint.hidden=false;const width=Math.min(90,this.hint.getBoundingClientRect().width||70),left=point.x+8+width>innerWidth?point.x-width-8:point.x+8;this.hint.style.left=`${Math.max(8,Math.min(left,innerWidth-width-8))}px`;this.hint.style.top=`${Math.max(42,Math.min(point.y-20,innerHeight-28))}px`}
  #deactivate(){if(this.active)this.active.classList.remove('system-agent-command-active');this.active=null;if(this.highlights){this.highlights.hidden=true;this.highlights.replaceChildren()}if(this.hint)this.hint.hidden=true}
}
