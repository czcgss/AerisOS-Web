import { icon } from '../icons.js';
import { renderMarkdown } from '../apps/ai/MarkdownRenderer.js';

const esc=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const textOf=message=>typeof message?.content==='string'?message.content:(message?.content||[]).filter(block=>block?.type==='text').map(block=>block.text).join('\n');
const blocksOf=message=>typeof message?.content==='string'?[{type:'text',text:message.content}]:(Array.isArray(message?.content)?message.content:[]);

export class CompactAgentPanel {
  constructor(host,context){this.host=host;this.context=context;this.activeId=null;this.opened=false;this.menu='';this.draft='';this.error='';this.frame=0;this.follow=true;this.editingId=null;this.editDraft='';this.expandedTools=new Set()}

  mount(){
    this.node=document.createElement('section');this.node.className='compact-agent-panel';this.node.hidden=true;this.host.appendChild(this.node);
    this.node.addEventListener('contextmenu',event=>{event.preventDefault();event.stopPropagation()});
    const bus=this.context.kernel.bus;
    this.offs=[
      bus.on('ai:compact-entry',detail=>this.open(detail)),
      bus.on('ai:ready',()=>this.opened&&this.render()),
      bus.on('ai:changed',detail=>{if(!this.opened)return;if(detail?.sessionId&&detail.sessionId!==this.activeId)return;this.#schedule()}),
      bus.on('ai:agent-event',detail=>{if(this.opened&&detail.sessionId===this.activeId)this.#schedule()}),
      bus.on('capability:execution',()=>this.opened&&this.#schedule()),
      bus.on('agent:query-user',detail=>{if(this.opened&&detail?.sessionId===this.activeId)this.#schedule()}),
      bus.on('notification:changed',()=>this.opened&&this.render()),
      bus.on('agent:context-changed',()=>this.opened&&this.render()),
      bus.on('settings:change',({key})=>{if(this.opened&&key==='locale')this.render()}),
    ];
  }

  open(detail={}){
    const sessions=this.context.aiAgent.snapshot().sessions;
    if(!this.activeId||!sessions.some(item=>item.id===this.activeId))this.activeId=sessions[0]?.id||this.context.aiAgent.createSession();
    const current=this.#session();
    if(detail.prompt&&current?.turns?.length)this.activeId=this.context.aiAgent.createSession();
    this.draft=String(detail.prompt||'');this.error='';this.menu='';this.editingId=null;this.editDraft='';this.opened=true;this.node.hidden=false;this.render({focus:true});
    if(detail.autoSend&&this.draft)this.#send();
  }

  close(){this.opened=false;this.menu='';this.node.hidden=true}
  #session(){try{return this.activeId?this.context.aiAgent.sessionState(this.activeId):null}catch{return null}}
  #schedule(){if(this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=0;this.render()})}
  #configured(){try{return Boolean(this.context.aiAgent.config().apiKey)}catch{return false}}
  #modelOptions(){try{return this.context.aiAgent.modelOptions()}catch{return[]}}
  #messageText(message){return textOf(message)}

  #toolMarkup(block,result,turn){
    const {tools,i18n,registry}=this.context,metadata=tools.metadata(block.name)||{},execution={...(result?.details||{}),...(tools.execution(block.id)||{})};let phase=execution.phase||'running';
    if(['running','approval'].includes(phase)){if(result?.isError||turn.status==='failed')phase='failed';else if(turn.status==='stopped')phase='cancelled';else if(result||turn.status==='completed')phase='completed'}
    const app=registry.get(metadata.appId||execution.appId),label=execution.label||metadata.label||block.name,args=block.arguments??execution.params??{},output=result?textOf(result):'',expanded=this.expandedTools.has(block.id),hasDetails=Boolean(Object.keys(typeof args==='object'&&args?args:{}).length||output||execution.error);
    return`<section class="compact-agent-tool ai-tool-${phase} ${expanded?'expanded':''}" data-compact-tool="${esc(block.id)}"><header><span class="app-icon app-icon-${app?.color||'grey'}">${icon(app?.icon||'wrench',12)}</span><strong>${esc(label)}</strong><em>${i18n.t(`toolStatus_${phase}`)}</em>${hasDetails?`<button data-compact-tool-expand title="${i18n.t(expanded?'hideDetails':'showDetails')}">${icon('chevron',9)}</button>`:''}</header>${hasDetails?`<div class="compact-agent-tool-details">${Object.keys(typeof args==='object'&&args?args:{}).length?`<section><strong>${i18n.t('toolParameters')}</strong><pre data-copyable>${esc(JSON.stringify(args,null,2))}</pre></section>`:''}${output?`<section><strong>${i18n.t('toolResult')}</strong><p data-copyable>${esc(output).slice(0,1600)}</p></section>`:''}${execution.error?`<section class="error"><strong>${i18n.t('toolStatus_failed')}</strong><p data-copyable>${esc(execution.error)}</p></section>`:''}</div>`:''}</section>`;
  }

  #assistantMarkup(turn,streaming=null){
    const results=new Map((turn.responses||[]).filter(message=>message.role==='toolResult').map(message=>[message.toolCallId,message])),parts=[];
    const add=(message,{active=false}={})=>{const blocks=blocksOf(message),lastMeaningful=blocks.reduce((last,block,index)=>['thinking','text','toolCall'].includes(block?.type)?index:last,-1);for(const [index,block] of blocks.entries()){if(block?.type==='thinking'){const content=String(block.thinking||'').trim(),thinking=active&&index===lastMeaningful;if(content||thinking)parts.push(`<details class="compact-agent-thinking ${thinking?'is-thinking':''}" ${thinking?'open':''}><summary>${icon('sparkles',10)} <span>${this.context.i18n.t(thinking?'thinkingInProgress':'thinking')}</span>${thinking?'<i></i>':icon('chevron',8)}</summary><div>${content?renderMarkdown(content):`<span class="compact-agent-thinking-placeholder">${this.context.i18n.t('thinkingInProgress')}</span>`}</div></details>`)}else if(block?.type==='text'&&String(block.text||'').trim())parts.push(`<div class="compact-agent-markdown">${renderMarkdown(block.text)}</div>`);else if(block?.type==='toolCall')parts.push(this.#toolMarkup(block,results.get(block.id),turn))}};
    (turn.responses||[]).filter(message=>message.role==='assistant').forEach(message=>add(message));if(streaming?.role==='assistant')add(streaming,{active:true});
    if(turn.status==='running'&&!parts.length)parts.push('<span class="compact-agent-typing"><i></i><i></i><i></i></span>');
    if(turn.status==='failed'&&turn.error)parts.push(`<p class="compact-agent-error">${esc(turn.error)}</p>`);
    return parts.join('');
  }

  #conversation(session){
    const {i18n}=this.context;if(!this.context.aiAgent.ready)return`<div class="compact-agent-empty">${icon('aerisAi',27)}<strong>${i18n.t('preparingAI')}</strong></div>`;
    if(!this.#configured())return`<div class="compact-agent-empty">${icon('settings',25)}<strong>${i18n.t('setupRequired')}</strong><small>${i18n.t('configureAICopy')}</small></div>`;
    if(!session?.turns?.length)return`<div class="compact-agent-empty">${icon('aerisAi',28)}<strong>${i18n.t('howCanIHelp')}</strong><small>${i18n.t('compactAgentWelcome')}</small></div>`;
    return session.turns.map((turn,index)=>{const last=index===session.turns.length-1,actions=turn.status!=='running'&&!(last&&session.busy),editing=turn.id===this.editingId,user=editing?`<div class="compact-agent-inline-editor"><textarea data-compact-inline-edit>${esc(this.editDraft)}</textarea><footer><button data-compact-cancel-edit>${i18n.t('cancel')}</button><button class="primary" data-compact-submit-edit>${i18n.t('send')}</button></footer></div>`:`<div class="compact-agent-user-content">${renderMarkdown(this.#messageText(turn.user))}</div>${actions?`<footer class="compact-agent-actions"><button data-compact-copy-turn="${esc(turn.id)}" data-compact-copy-role="user" title="${i18n.t('copyMessage')}">${icon('copy',13)}</button>${last&&!session.busy?`<button data-compact-edit-turn="${esc(turn.id)}" title="${i18n.t('editMessage')}">${icon('textedit',13)}</button>`:''}</footer>`:''}`,answer=this.#assistantMarkup(turn,turn.id===session.activeTurnId?session.streamingMessage:null);return`<section class="compact-agent-turn"><div class="compact-agent-user"><div class="${editing?'editing':''}">${user}</div></div>${answer?`<div class="compact-agent-answer"><span>${icon('aerisAi',14)}</span><div><div>${answer}</div>${actions?`<footer class="compact-agent-actions"><button data-compact-copy-turn="${esc(turn.id)}" data-compact-copy-role="assistant" title="${i18n.t('copyMessage')}">${icon('copy',13)}</button>${this.#usageMarkup(turn)}</footer>`:''}</div></div>`:''}</section>`}).join('');
  }

  #assistantText(turn){return(turn.responses||[]).filter(message=>message.role==='assistant').map(message=>textOf(message)).filter(Boolean).join('\n\n')}
  #usageMarkup(turn){const usage=this.context.aiAgent.turnUsage(turn);if(!usage.hasUsage)return'';const format=value=>new Intl.NumberFormat(this.context.i18n.t('dateFormat')).format(Number(value)||0),i18n=this.context.i18n;return`<span class="compact-agent-usage" tabindex="0">${icon('chart',13)}<span><strong>${i18n.t('taskUsage')}</strong><small>${esc(usage.modelName||i18n.t('unknownModel'))}</small><b>${i18n.t('inputTokens')} ${format(usage.input)}</b><b>${i18n.t('outputTokens')} ${format(usage.output)}</b><b>${i18n.t('cacheReadTokens')} ${format(usage.cacheRead)}</b></span></span>`}

  #historyMenu(){const {aiAgent,i18n}=this.context,sessions=aiAgent.snapshot().sessions;return`<section class="compact-agent-popover compact-agent-history"><header><strong>${i18n.t('conversations')}</strong></header><div>${sessions.length?sessions.map(item=>`<button data-compact-session="${esc(item.id)}" class="${item.id===this.activeId?'selected':''}"><span>${icon('message',13)}</span><span><strong>${esc(item.title)}</strong><small>${new Intl.DateTimeFormat(i18n.t('dateFormat'),{month:'short',day:'numeric'}).format(item.updatedAt)}</small></span>${item.streaming?'<i></i>':''}</button>`).join(''):`<p>${i18n.t('noConversations')}</p>`}</div></section>`}
  #notificationMenu(){const {notifications,i18n,registry}=this.context,{items}=notifications.snapshot();return`<section class="compact-agent-popover compact-agent-notifications"><header><strong>${i18n.t('notifications')}</strong>${items.length?`<button data-compact-clear-notifications>${i18n.t('clearAll')}</button>`:''}</header><div>${items.length?items.map(item=>{const app=registry.get(item.appId);return`<button data-compact-notification="${esc(item.id)}" class="${item.read?'':'unread'}"><span class="app-icon app-icon-${app?.color||'blue'}">${icon(app?.icon||'bell',14)}</span><span><small>${esc(app?i18n.t(app.title):'Aeris')}</small><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p></span></button>`}).join(''):`<p>${i18n.t('noNotifications')}</p>`}</div></section>`}
  #contextMenu(){const {shell,agentContext,i18n}=this.context,current=agentContext.snapshot(),windows=shell.windowManager.contextWindows();return`<section class="compact-agent-popover compact-agent-context-menu"><header><strong>${i18n.t('chooseContext')}</strong></header><div><button data-compact-context-desktop class="${current?.resource?.kind==='desktop'?'selected':''}">${icon('desktop',13)}<span>${i18n.t('desktop')}</span></button>${windows.map(item=>`<button data-compact-context-window="${esc(item.id)}" class="${current?.windowId===item.id?'selected':''}"><span class="app-icon app-icon-${item.color}">${icon(item.icon,12)}</span><span>${esc(item.title)}</span></button>`).join('')}</div></section>`}

  #approval(session){const request=this.context.tools.pendingApproval();if(!request)return'';return`<section class="compact-agent-approval"><span>${icon('lock',13)}</span><div><small>${this.context.i18n.t('approvalRequired')}</small><strong>${esc(request.label||this.context.i18n.t('approveAgentAction'))}</strong></div><button data-compact-deny="${esc(request.toolCallId)}">${this.context.i18n.t('deny')}</button><button class="primary" data-compact-approve="${esc(request.toolCallId)}">${this.context.i18n.t('approve')}</button></section>`}
  #query(){const request=this.context.queryUser.pendingForSession(this.activeId);if(!request)return'';const t=this.context.i18n;return`<section class="compact-agent-query"><strong>${esc(t.t('appWidgetQuestion').replace('{app}',request.appName))}</strong><div><button data-compact-query="disable">${t.t('appOnly')}</button><button class="primary" data-compact-query="enable">${t.t('includeWidgets')}</button></div></section>`}

  render({focus=false}={}){
    if(!this.opened)return;const {aiAgent,i18n,notifications,agentContext}=this.context,session=this.#session(),state=aiAgent.snapshot(),busy=Boolean(session?.busy),draft=this.node.querySelector('[data-compact-composer]')?.value??this.draft;this.draft=draft;
    const models=this.#modelOptions(),config=this.#configured()?aiAgent.config():null,context=agentContext.snapshot(),contextApp=context?.appId?this.context.registry.get(context.appId):null,contextIcon=contextApp?.icon||(context?.resource?.kind==='desktop'?'desktop':'focus'),contextColor=contextApp?.color||'blue',unread=notifications.snapshot().unread;
    this.node.innerHTML=`<header class="compact-agent-header"><div><span>${icon('aerisAi',17)}</span><strong>${esc(session?.title||i18n.t('newChat'))}</strong></div><nav><button data-compact-menu="history" class="${this.menu==='history'?'selected':''}" title="${i18n.t('conversations')}">${icon('history',14)}</button><button data-compact-new title="${i18n.t('newChat')}">${icon('plus',14)}</button><button data-compact-menu="notifications" class="${this.menu==='notifications'?'selected':''}" title="${i18n.t('notifications')}">${icon('bell',14)}${unread?'<i></i>':''}</button><button data-compact-close title="${i18n.t('close')}">${icon('close',14)}</button></nav>${this.menu==='history'?this.#historyMenu():this.menu==='notifications'?this.#notificationMenu():''}</header><main data-compact-conversation>${this.#conversation(session)}</main><footer class="compact-agent-footer">${this.error?`<p class="compact-agent-error">${esc(this.error)}</p>`:''}${this.#query()}${this.#approval(session)}<div class="compact-agent-composer"><textarea data-compact-composer rows="1" placeholder="${i18n.t('messageAerisAI')}" ${!state.ready||!this.#configured()||busy||this.editingId?'disabled':''}>${esc(draft)}</textarea><div><button data-compact-context class="${this.menu==='context'?'selected':''}"><span class="app-icon app-icon-${contextColor}">${icon(contextIcon,11)}</span><span>${esc(context?.label||context?.resource?.name||i18n.t('chooseContext'))}</span>${icon('chevron',8)}</button><label>${icon('sparkles',10)}<select data-compact-model ${busy?'disabled':''}>${models.map(model=>`<option value="${esc(model.key)}" ${model.key===config?.activeModelKey?'selected':''}>${esc(model.label)}</option>`).join('')}</select><em>${config?i18n.t(`reasoning_${config.reasoningEffort||'medium'}`):''}</em></label><span></span><button class="compact-agent-send" data-compact-send ${!state.ready||!this.#configured()||this.editingId?'disabled':''}>${icon(busy?'stopSquare':'arrowUp',15)}</button></div>${this.menu==='context'?this.#contextMenu():''}</div><small>${i18n.t('aiMayMakeMistakes')}</small></footer>`;
    this.#bind();const conversation=this.node.querySelector('[data-compact-conversation]');if(conversation&&this.follow)requestAnimationFrame(()=>{conversation.scrollTop=conversation.scrollHeight});if(focus&&!busy)requestAnimationFrame(()=>this.node.querySelector('[data-compact-composer]')?.focus())
  }

  #bind(){
    const {aiAgent,notifications,agentContext,shell,tools,queryUser,i18n,clipboard}=this.context;
    this.node.querySelector('[data-compact-close]')?.addEventListener('click',()=>this.close());
    this.node.querySelectorAll('[data-compact-menu]').forEach(button=>button.onclick=()=>{this.menu=this.menu===button.dataset.compactMenu?'':button.dataset.compactMenu;this.render()});
    this.node.querySelector('[data-compact-new]')?.addEventListener('click',()=>{this.activeId=aiAgent.createSession();this.draft='';this.menu='';this.error='';this.editingId=null;this.editDraft='';this.render({focus:true})});
    this.node.querySelectorAll('[data-compact-session]').forEach(button=>button.onclick=()=>{this.activeId=button.dataset.compactSession;this.menu='';this.error='';this.editingId=null;this.editDraft='';this.render({focus:true})});
    this.node.querySelector('[data-compact-clear-notifications]')?.addEventListener('click',()=>notifications.clear());
    this.node.querySelectorAll('[data-compact-notification]').forEach(button=>button.onclick=()=>{const item=notifications.snapshot().items.find(entry=>entry.id===button.dataset.compactNotification);if(!item)return;notifications.markRead(item.id);if(item.context)agentContext.set(item.context);this.draft=i18n.t('prepareWithAerisPrompt').replace('{title}',item.title);this.menu='';this.render({focus:true})});
    this.node.querySelector('[data-compact-context]')?.addEventListener('click',()=>{this.menu=this.menu==='context'?'':'context';this.render()});
    this.node.querySelector('[data-compact-context-desktop]')?.addEventListener('click',()=>{agentContext.focusDesktop();this.menu='';this.render({focus:true})});
    this.node.querySelectorAll('[data-compact-context-window]').forEach(button=>button.onclick=()=>{const target=shell.windowManager.contextWindows().find(item=>item.id===button.dataset.compactContextWindow);if(target)agentContext.focusWindow(target);this.menu='';this.render({focus:true})});
    this.node.querySelectorAll('[data-compact-model]').forEach(select=>select.addEventListener('change',event=>aiAgent.updateConfig({activeModelKey:event.target.value}).catch(error=>{this.error=error.message;this.render()})));
    this.node.querySelectorAll('[data-compact-copy-turn]').forEach(button=>button.onclick=async()=>{const turn=this.#session()?.turns.find(item=>item.id===button.dataset.compactCopyTurn),text=button.dataset.compactCopyRole==='user'?this.#messageText(turn?.user):this.#assistantText(turn||{responses:[]});if(text&&await clipboard.copyText(text))shell.toast(i18n.t('copiedToClipboard'))});
    this.node.querySelectorAll('[data-compact-tool-expand]').forEach(button=>button.onclick=event=>{event.stopPropagation();const id=button.closest('[data-compact-tool]')?.dataset.compactTool;if(!id)return;if(this.expandedTools.has(id))this.expandedTools.delete(id);else this.expandedTools.add(id);this.render()});
    this.node.querySelectorAll('[data-compact-edit-turn]').forEach(button=>button.onclick=()=>{const turn=this.#session()?.turns.find(item=>item.id===button.dataset.compactEditTurn);this.editingId=turn?.id||null;this.editDraft=this.#messageText(turn?.user);this.render();requestAnimationFrame(()=>{const editor=this.node.querySelector('[data-compact-inline-edit]');editor?.focus();editor?.setSelectionRange(editor.value.length,editor.value.length)})});
    this.node.querySelector('[data-compact-cancel-edit]')?.addEventListener('click',()=>{this.editingId=null;this.editDraft='';this.render({focus:true})});
    const editor=this.node.querySelector('[data-compact-inline-edit]');if(editor){editor.oninput=()=>{this.editDraft=editor.value;editor.style.height='auto';editor.style.height=`${editor.scrollHeight}px`};editor.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();this.editingId=null;this.editDraft='';this.render({focus:true})}else if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();this.#submitEdit()}}}
    this.node.querySelector('[data-compact-submit-edit]')?.addEventListener('click',()=>this.#submitEdit());
    this.node.querySelector('[data-compact-composer]')?.addEventListener('input',event=>{this.draft=event.target.value;event.target.style.height='auto';event.target.style.height=`${Math.min(112,event.target.scrollHeight)}px`});
    this.node.querySelector('[data-compact-composer]')?.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();this.#send()}});
    this.node.querySelector('[data-compact-send]')?.addEventListener('click',()=>this.#session()?.busy?aiAgent.abort(this.activeId):this.#send());
    this.node.querySelector('[data-compact-deny]')?.addEventListener('click',event=>tools.resolveApproval(event.currentTarget.dataset.compactDeny,false));
    this.node.querySelector('[data-compact-approve]')?.addEventListener('click',event=>tools.resolveApproval(event.currentTarget.dataset.compactApprove,true));
    this.node.querySelectorAll('[data-compact-query]').forEach(button=>button.onclick=()=>{const pending=queryUser.pendingForSession(this.activeId);if(pending)queryUser.resolve(pending.toolCallId,button.dataset.compactQuery)});
    const conversation=this.node.querySelector('[data-compact-conversation]');if(conversation)conversation.onscroll=()=>{this.follow=conversation.scrollHeight-conversation.scrollTop-conversation.clientHeight<80};
  }

  #submitEdit(){const text=this.node.querySelector('[data-compact-inline-edit]')?.value.trim()||this.editDraft.trim(),turnId=this.editingId;if(!text||!turnId)return;this.editingId=null;this.editDraft='';this.error='';this.follow=true;this.context.aiAgent.editAndResend(this.activeId,turnId,text).catch(error=>{this.error=error.message||String(error);this.render()});this.render()}
  #send(){const composer=this.node.querySelector('[data-compact-composer]'),text=composer?.value.trim()||this.draft.trim();if(!text||this.#session()?.busy)return;if(composer){composer.value='';composer.style.height='auto'}this.draft='';this.error='';this.follow=true;this.context.aiAgent.send(this.activeId,text).catch(error=>{this.error=error.message||String(error);this.render()});this.render()}
}
