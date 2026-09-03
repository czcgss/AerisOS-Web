import {icon} from '../../icons.js';

export const isTerminalAgentTrigger=value=>/^\s*(?:@future|@伏秋)\s$/i.test(String(value??''));
const BRACKETED_PASTE=/^\u001b\[200~([\s\S]*)\u001b\[201~$/;
const startsTerminalAgentCommand=value=>/^\s*(?:@future|@伏秋)\s/i.test(String(value??''));
export const normalizeTerminalAgentInput=(data,active=false)=>{const raw=String(data??''),match=raw.match(BRACKETED_PASTE);return{input:match?.[1]??raw,passthrough:Boolean(match&&!active&&!startsTerminalAgentCommand(match[1]))}};
export const isTerminalCompositionKey=event=>Boolean(event?.isComposing||event?.keyCode===229||event?.key==='Process'||event?.key==='Unidentified');
export const shouldActivateTerminalAgentTrigger=(line,event)=>Boolean(!isTerminalCompositionKey(event)&&event?.key===' '&&!event?.metaKey&&!event?.ctrlKey&&!event?.altKey&&isTerminalAgentTrigger(`${line} `));

export const routeTerminalAgentData=(state,data)=>{
  let output='',submitted=null,changed=false;
  for(const char of String(data??'')){
    if(state.active){
      if(char==='\r'||char==='\n'){submitted=state.draft.trim();state.active=false;state.draft='';state.line='';changed=true;continue}
      if(char==='\u0003'||char==='\u001b'){state.active=false;state.draft='';state.line='';output+=char==='\u0003'?'\u0003':'';changed=true;continue}
      if(char==='\u007f'||char==='\b'){state.draft=[...state.draft].slice(0,-1).join('');changed=true;continue}
      if(char>=' '||char==='\t'){state.draft+=char;changed=true}
      continue;
    }
    output+=char;
    if(char==='\r'||char==='\n'||char==='\u0003'){state.line='';continue}
    if(char==='\u007f'||char==='\b'){state.line=[...state.line].slice(0,-1).join('');continue}
    if(char<' ')continue;
    state.line+=char;
    if(isTerminalAgentTrigger(state.line)){state.active=true;state.draft='';state.line='';output+='\u0015';changed=true}
  }
  return{output,submitted,changed};
};

export class TerminalAgentInput{
  constructor({host,i18n,agentEntry,agentContext}){this.host=host;this.i18n=i18n;this.agentEntry=agentEntry;this.agentContext=agentContext;this.states=new Map();this.triggerLines=new Map()}
  activateTrigger(event,{key,anchor,windowId='',write}){
    if(!this.agentEntry||isTerminalCompositionKey(event))return false;
    const id=String(key),state=this.#state(id,anchor,windowId);if(state.active)return false;
    if(event.metaKey||event.ctrlKey||event.altKey){if(event.key==='c')this.triggerLines.set(id,'');return false}
    let line=this.triggerLines.get(id)||'';
    if(event.key==='Enter'){this.triggerLines.set(id,'');return false}
    if(event.key==='Backspace'){this.triggerLines.set(id,[...line].slice(0,-1).join(''));return false}
    if(event.key.length!==1)return false;
    line+=event.key;this.triggerLines.set(id,line);
    if(!isTerminalAgentTrigger(line))return false;
    event.preventDefault();event.stopImmediatePropagation();this.triggerLines.set(id,'');state.active=true;state.draft='';state.line='';write?.('\u0015');this.#render();return true
  }
  route(data,{key,anchor,windowId='',write}){
    if(!this.agentEntry)return data;
    const id=String(key),state=this.#state(id,anchor,windowId);
    const normalized=normalizeTerminalAgentInput(data,state.active);if(normalized.passthrough)return data;const input=normalized.input;
    const result=routeTerminalAgentData(state,input);if(result.changed)this.#render();
    if(result.submitted){this.agentEntry.open({prompt:result.submitted,autoSend:true,source:'terminal-input-command',mode:'compact',agentMode:'writing',presentation:'contextual',anchor:state.anchor,writingTarget:typeof write==='function'?{operation:'insert',apply:text=>{write(String(text??''));return true}}:null})}
    return result.output;
  }
  release(key){const id=String(key);this.states.delete(id);this.triggerLines.delete(id);this.#render()}
  destroy(){this.states.clear();this.triggerLines.clear();this.box?.remove();this.box=null}
  #state(id,anchor,windowId){const state=this.states.get(id)||{line:'',active:false,draft:'',anchor:null,windowId:''};state.anchor=anchor||state.anchor;state.windowId=windowId||state.windowId;this.states.set(id,state);return state}
  #render(){
    const state=[...this.states.values()].findLast(item=>item.active);if(!state){if(this.box)this.box.hidden=true;return}
    const position=!this.box||this.box.hidden;if(!this.box){this.box=document.createElement('section');this.box.className='system-agent-terminal-command';this.box.innerHTML=`<header><span>${icon('futureAi',13)}</span><strong>@future</strong><small>Agent command</small></header><div><mark></mark><i></i></div><footer><span>Esc ${this.i18n.t('cancel')}</span><span>↵ ${this.i18n.t('send')}</span></footer>`;this.host.appendChild(this.box)}
    this.box.querySelector('mark').textContent=state.draft||'Type a request…';this.box.hidden=false;if(!position)return;
    const anchor=state.anchor||{x:innerWidth/2,y:innerHeight-100};
    const width=Math.min(420,innerWidth-24),left=Math.max(12,Math.min(anchor.x,innerWidth-width-12)),height=this.box.offsetHeight||76,top=Math.max(48,Math.min(anchor.y-height-12,innerHeight-height-76));this.box.style.left=`${left}px`;this.box.style.top=`${top}px`;
  }
  #escape(value){return String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
}
