import { icon } from '../../icons.js';
import { AI_STATE_PATH } from '../../services/AiAgentService.js';
import { collectToolActivities, workspaceMarkup, workspaceSignature } from './AgentWorkspace.js';

const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const messageText = message => typeof message?.content === 'string'
  ? message.content
  : (message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const renderText = text => String(text || '').split(/```/).map((part, index) => index % 2
  ? `<pre><code>${esc(part.replace(/^\w+\n/, ''))}</code></pre>`
  : `<div>${esc(part).replace(/\n/g, '<br>')}</div>`).join('');

export default {
  id: 'ai', title: 'aiAssistant', icon: 'aerisAi', color: 'ai', width: 1280, height: 760,
  singleInstance: true, dockLeading: true,
  mount(root, { aiAgent, i18n, kernel, dialog, shell, clipboard, tools, notifications }) {
    let activeId = null, query = '', settingsOpen = false, notificationOpen = false, settingsSection = 'model', localError = '', editingTurnId = null, editDraft = '', displayedTurns = [];
    let workspaceSelectedId = null, workspaceDismissedId = null, lastObservedToolId = null, liveExecution = null, liveExecutionTurnId = null, displayedActivities = [];

    const visibleSessions = () => aiAgent.snapshot().sessions.filter(session => session.title.toLowerCase().includes(query.toLowerCase()));
    const current = () => activeId ? aiAgent.sessionState(activeId) : null;
    const friendlyError = error => /guest command|mkdir -p|__aeris_/i.test(error?.message || '') ? i18n.t('conversationSaveFailed') : (error?.message || String(error));
    const ensureSession = async () => {
      if (!aiAgent.ready || activeId) return;
      activeId = aiAgent.snapshot().sessions[0]?.id || null;
    };
    const notificationMarkup=()=>{const {items}=notifications.snapshot();return`<div class="ai-notification-backdrop" data-ai-close-notifications></div><section class="ai-notification-menu"><header><div><strong>${i18n.t('systemNotifications')}</strong><small>${i18n.t('notificationCenterCopy')}</small></div>${items.length?`<button data-ai-clear-notifications>${i18n.t('clearAll')}</button>`:''}</header><div>${items.length?items.map(item=>{const app=tools.registry.get(item.appId);return`<article class="${item.read?'':'unread'}"><button data-ai-open-notification="${item.id}"><span class="app-icon app-icon-${app?.color||'blue'}">${icon(app?.icon||'bell',18)}</span><div><small>${esc(app?i18n.t(app.title):'Aeris')}</small><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p><time>${new Intl.DateTimeFormat(i18n.t('dateFormat'),{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(item.createdAt))}</time></div></button><button data-ai-dismiss-notification="${item.id}" aria-label="${i18n.t('dismiss')}">${icon('close',11)}</button></article>`}).join(''):`<div class="ai-notification-empty">${icon('bell',27)}<strong>${i18n.t('noNotifications')}</strong><small>${i18n.t('notificationEmptyCopy')}</small></div>`}</div></section>`};

    const toolIcon = appId => { const app=tools.registry.get(appId);return app?`<span class="ai-tool-app-icon app-icon app-icon-${app.color}">${icon(app.icon,17)}<i>${icon('wrench',8)}</i></span>`:`<span class="ai-tool-app-icon">${icon('wrench',16)}</span>`; };
    const errorMarkup=(message,className='ai-inline-error')=>`<div class="${className} ai-copyable-error" data-copyable><span class="ai-error-icon">${icon('warning',15)}</span><span class="ai-error-text">${esc(message)}</span><button data-ai-copy-error title="${i18n.t('copyError')}">${icon('copy',13)}</button></div>`;
    const toolCard = ({ name, toolCallId, args = {}, details = null, output = '' }) => {
      const metadata=tools.metadata(name)||{},execution=details||tools.execution(toolCallId)||{},phase=execution.phase||'running',app=tools.registry.get(metadata.appId||execution.appId),label=execution.label||metadata.label||name;
      return `<section class="ai-tool-call ai-tool-${phase}" data-tool-call="${esc(toolCallId)}"><header>${toolIcon(metadata.appId||execution.appId)}<span><strong>${esc(label)}</strong><small>${app?i18n.t(app.title):i18n.t('systemTool')}</small></span>${metadata.risk==='high'||execution.risk==='high'?`<b class="ai-risk-badge">${icon('lock',10)} ${i18n.t('approvalRequired')}</b>`:''}<em>${i18n.t(`toolStatus_${phase}`)}</em></header>${Object.keys(args||{}).length?`<details><summary>${i18n.t('toolParameters')}</summary><pre data-copyable>${esc(JSON.stringify(args,null,2))}</pre></details>`:''}${output?`<details class="ai-tool-output"><summary>${i18n.t('toolResult')}</summary><p data-copyable>${esc(output).slice(0,1200)}</p></details>`:''}</section>`;
    };
    const assistantText = turn => (turn.responses||[]).filter(message=>message.role==='assistant').map(messageText).filter(Boolean).join('\n\n');
    const answerMarkup = (turn, session) => {
      const responses=turn.responses||[],results=new Map(responses.filter(message=>message.role==='toolResult').map(message=>[message.toolCallId,message])),usedResults=new Set(),parts=[];
      for(const response of responses){
        if(response.role==='assistant'){
          const text=messageText(response);if(text)parts.push(`<div class="ai-message-content ai-turn-text" data-copyable>${renderText(text)}</div>`);
          for(const call of (response.content||[]).filter?.(block=>block.type==='toolCall')||[]){const result=results.get(call.id);if(result)usedResults.add(call.id);parts.push(toolCard({name:result?.toolName||call.name,toolCallId:call.id,args:call.arguments,details:result?.details,output:result?messageText(result):''}))}
        }else if(response.role==='toolResult'&&!usedResults.has(response.toolCallId))parts.push(toolCard({name:response.toolName,toolCallId:response.toolCallId,details:response.details,output:messageText(response)}));
      }
      const streaming=turn.id===session.activeTurnId?session.streamingMessage:null;
      if(streaming?.role==='assistant'){
        const text=messageText(streaming),calls=(streaming.content||[]).filter?.(block=>block.type==='toolCall')||[];
        if(text||!calls.length)parts.push(`<div class="ai-message-content ai-turn-stream" data-ai-turn-stream data-copyable>${text?renderText(text):'<span class="ai-typing"><i></i><i></i><i></i></span>'}</div>`);
        parts.push(...calls.map(call=>toolCard({name:call.name,toolCallId:call.id,args:call.arguments})));
      }else if(turn.status==='running')parts.push(`<div class="ai-turn-stream" data-ai-turn-stream><span class="ai-typing"><i></i><i></i><i></i></span></div>`);
      return parts.join('');
    };
    const turnMarkup = (turn, index, lastTurnIndex, session) => {
      const editing=turn.id===editingTurnId,userText=messageText(turn.user),answer=answerMarkup(turn,session),showAnswer=Boolean(answer||turn.status==='failed'||turn.status==='stopped');
      return `<section class="ai-turn" data-ai-turn="${esc(turn.id)}">
        <article class="ai-message ai-message-user"><span class="ai-message-avatar">${icon('user',16)}</span><div class="ai-message-body ${editing?'editing':''}">${editing?`<div class="ai-inline-editor"><textarea data-ai-inline-edit rows="2">${esc(editDraft)}</textarea><footer><button data-ai-cancel-inline-edit>${i18n.t('cancel')}</button><button class="ai-primary" data-ai-submit-inline-edit>${i18n.t('send')}</button></footer></div>`:`<div class="ai-message-content" data-copyable>${renderText(userText)}</div><footer class="ai-message-actions"><button data-ai-copy-turn="${esc(turn.id)}" data-ai-copy-role="user" title="${i18n.t('copyMessage')}">${icon('copy',14)}</button>${index===lastTurnIndex&&!session.streaming?`<button data-ai-edit-turn="${esc(turn.id)}" title="${i18n.t('editMessage')}">${icon('textedit',14)}</button>`:''}</footer>`}</div></article>
        ${showAnswer?`<article class="ai-message ai-message-assistant" data-ai-turn-answer="${esc(turn.id)}"><span class="ai-message-avatar">${icon('aerisAi',17)}</span><div class="ai-message-body"><header>${i18n.t('aerisAI')}</header><div class="ai-turn-response">${answer}</div><footer class="ai-message-actions"><button data-ai-copy-turn="${esc(turn.id)}" data-ai-copy-role="assistant" title="${i18n.t('copyMessage')}">${icon('copy',14)}</button></footer></div></article>`:''}
      </section>`;
    };

    const render = ({ preserveComposer = false, focusSearch = false, focusComposer = preserveComposer } = {}) => {
      const draft = preserveComposer ? root.querySelector('[data-ai-composer]')?.value || '' : '';
      const previousWorkspace=root.querySelector('[data-ai-app-workspace]');
      const state = aiAgent.snapshot(), session = current(), configured = Boolean(aiAgent.config().apiKey);
      const turns=session?.turns||[];displayedTurns=turns;
      const sessions = visibleSessions();
      const currentLive=session?.streaming&&session.activeTurnId===liveExecutionTurnId?liveExecution:null;
      const activities=collectToolActivities(session,tools,currentLive),latestActivity=activities.at(-1)||null,foregroundActivity=[...activities].reverse().find(activity=>activity.phase==='running'||activity.phase==='approval')||latestActivity;
      if(foregroundActivity&&foregroundActivity.id!==lastObservedToolId){lastObservedToolId=foregroundActivity.id;workspaceSelectedId=foregroundActivity.id;workspaceDismissedId=null}
      let workspaceActivity=activities.find(activity=>activity.id===workspaceSelectedId)||foregroundActivity;
      if(workspaceActivity)workspaceSelectedId=workspaceActivity.id;
      displayedActivities=activities;
      const workspaceVisible=Boolean(workspaceActivity&&workspaceDismissedId!==workspaceActivity.id);
      const signature=workspaceVisible?workspaceSignature(workspaceActivity):'',reuseWorkspace=Boolean(previousWorkspace&&workspaceVisible&&previousWorkspace.dataset.workspaceToolId===workspaceActivity.id&&previousWorkspace.dataset.workspaceSignature===signature),animateWorkspace=!previousWorkspace||previousWorkspace.dataset.workspaceToolId!==workspaceActivity?.id;
      if(reuseWorkspace)previousWorkspace.remove();
      root.innerHTML = `<div class="system-app ai-system-app ${workspaceVisible?'has-app-workspace':''}">
        <aside class="ai-sidebar">
          <header><span class="ai-brand-icon">${icon('aerisAi', 21)}</span><strong>${i18n.t('aerisAI')}</strong><button data-ai-new title="${i18n.t('newChat')}">${icon('plus', 17)}</button></header>
          <label class="ai-search">${icon('search', 14)}<input data-ai-search value="${esc(query)}" placeholder="${i18n.t('searchChats')}"></label>
          <small class="ai-section-label">${i18n.t('conversations')}</small>
          <nav class="ai-session-list">${sessions.length ? sessions.map(item => `<div class="ai-session-row ${item.id === activeId ? 'selected' : ''}"><button data-ai-session="${item.id}"><span>${icon('message', 15)}</span><span><strong>${esc(item.title)}</strong><small>${new Intl.DateTimeFormat(i18n.t('dateFormat'), { month: 'short', day: 'numeric' }).format(item.updatedAt)}</small></span>${item.streaming ? '<i></i>' : ''}</button><button data-ai-delete="${item.id}" title="${i18n.t('deleteChat')}">${icon('delete', 13)}</button></div>`).join('') : `<div class="ai-sidebar-empty">${i18n.t(query ? 'noSearchResults' : 'noConversations')}</div>`}</nav>
          <footer><button data-ai-settings>${icon('settings', 16)}<span><strong>${i18n.t('aiSettings')}</strong><small>${configured ? esc(aiAgent.config().model) : i18n.t('setupRequired')}</small></span></button></footer>
        </aside>
        <section class="ai-workspace">
          <header class="ai-toolbar"><div><strong>${session ? esc(session.title) : i18n.t('aerisAI')}</strong><small>${configured ? esc(aiAgent.config().model) : i18n.t('notConnected')}</small></div><span class="ai-local-badge">${icon('lock', 12)} ${i18n.t('storedOnThisComputer')}</span><button class="ai-notification-button ${notificationOpen?'selected':''}" data-ai-notifications title="${i18n.t('notifications')}">${icon('bell', 17)}<i class="${notifications.snapshot().unread?'visible':''}" data-ai-notification-dot></i></button><button data-ai-settings title="${i18n.t('aiSettings')}">${icon('settings', 17)}</button></header>
          <main class="ai-conversation" data-ai-conversation>
            ${!state.ready ? `<div class="ai-center-state"><span class="ai-orb waiting">${icon('aerisAi', 30)}</span><h2>${i18n.t('preparingAI')}</h2>${state.error?errorMarkup(state.error,'ai-center-error'):`<p>${i18n.t('waitingForLinuxAI')}</p>`}</div>`
              : !configured ? `<div class="ai-center-state"><span class="ai-orb">${icon('aerisAi', 30)}</span><h2>${i18n.t('meetAerisAI')}</h2><p>${i18n.t('configureAICopy')}</p><button data-ai-settings class="ai-primary">${i18n.t('configureAI')}</button></div>`
              : !turns.length ? `<div class="ai-welcome"><span class="ai-orb">${icon('aerisAi', 31)}</span><h1>${i18n.t('howCanIHelp')}</h1><p>${i18n.t('aiWelcomeCopy')}</p><div class="ai-suggestions">${['aiSuggestionOne','aiSuggestionTwo','aiSuggestionThree'].map(key => `<button data-ai-suggestion="${esc(i18n.t(key))}">${icon('sparkles', 14)}<span>${i18n.t(key)}</span>${icon('chevron', 13)}</button>`).join('')}</div></div>`
              : `<div class="ai-message-stack">${turns.map((turn,index)=>turnMarkup(turn,index,turns.length-1,session)).join('')}${session.error ? errorMarkup(session.error) : ''}</div>`}
          </main>
          <footer class="ai-composer-area">
            ${localError ? errorMarkup(localError,'ai-composer-error') : ''}
            <div class="ai-composer-shell ${session?.streaming ? 'streaming' : ''}"><textarea data-ai-composer rows="1" placeholder="${i18n.t('messageAerisAI')}" ${!state.ready || !configured || editingTurnId !== null ? 'disabled' : ''}>${esc(draft)}</textarea><button data-ai-send ${!state.ready || !configured || editingTurnId !== null ? 'disabled' : ''} aria-label="${i18n.t(session?.streaming ? 'stopGenerating' : 'send')}">${icon(session?.streaming ? 'stopSquare' : 'arrowUp', 17)}</button></div>
            <small>${i18n.t('aiMayMakeMistakes')}</small>
          </footer>
          ${settingsOpen ? settingsMarkup() : ''}
          ${notificationOpen ? notificationMarkup() : ''}
        </section>
        ${workspaceVisible&&!reuseWorkspace?workspaceMarkup(workspaceActivity,activities,tools,i18n,{animate:animateWorkspace}):''}
      </div>`;
      if(reuseWorkspace)root.querySelector('.ai-system-app')?.append(previousWorkspace);
      bind();
      requestAnimationFrame(() => {
        const conversation = root.querySelector('[data-ai-conversation]');
        if (conversation) conversation.scrollTop = conversation.scrollHeight;
        if (focusSearch) { const search = root.querySelector('[data-ai-search]'); search?.focus(); search?.setSelectionRange(search.value.length, search.value.length); }
        else if (focusComposer) { const input = root.querySelector('[data-ai-composer]'); input?.focus(); input?.setSelectionRange(input.value.length, input.value.length); }
      });
    };

    let streamingFrame=0;
    const updateStreamingMessage=()=>{
      if(streamingFrame)return;
      streamingFrame=requestAnimationFrame(()=>{
        streamingFrame=0;
        const session=current(),message=session?.streamingMessage;
        if(message?.role!=='assistant'||(message.content||[]).some?.(block=>block.type==='toolCall'))return render({preserveComposer:true});
        const answer=[...root.querySelectorAll('[data-ai-turn-answer]')].find(node=>node.dataset.aiTurnAnswer===session.activeTurnId),target=answer?.querySelector('[data-ai-turn-stream]'),conversation=root.querySelector('[data-ai-conversation]');
        if(!target||!conversation)return render({preserveComposer:true});
        const nearBottom=conversation.scrollHeight-conversation.scrollTop-conversation.clientHeight<90;
        target.innerHTML=renderText(messageText(message));
        if(nearBottom)conversation.scrollTop=conversation.scrollHeight;
      });
    };

    const settingsMarkup = () => {
      const config = aiAgent.config();
      const modelContent=`<div class="ai-settings-scroll"><label><span>${i18n.t('apiBaseUrl')}</span><input data-ai-base type="url" value="${esc(config.baseUrl)}" spellcheck="false" autocomplete="off"></label><label><span>${i18n.t('apiKey')}</span><div class="ai-secret-field"><input data-ai-key type="text" value="${esc(config.apiKey)}" spellcheck="false" autocomplete="off" data-lpignore="true"><button data-ai-reveal type="button">${icon('eye',15)}</button></div><small>${i18n.t('apiKeyStoredCopy')}</small></label><label><span>${i18n.t('aiModel')}</span><input data-ai-model value="${esc(config.model)}" spellcheck="false" autocomplete="off"></label><label><span>${i18n.t('systemInstructions')}</span><textarea data-ai-prompt rows="5">${esc(config.systemPrompt)}</textarea></label><div class="ai-storage-card">${icon('folder',18)}<span><strong>${i18n.t('conversationStorage')}</strong><code>${AI_STATE_PATH}</code></span></div></div>`;
      const toolContent=`<div class="ai-tool-settings"><header><h3>${i18n.t('registeredApps')}</h3><p>${i18n.t('toolAccessCopy')}</p></header><div>${aiAgent.toolApps().map(app=>{const definitions=tools.list().filter(tool=>tool.appId===app.id),hasHigh=definitions.some(tool=>tool.risk==='high');return`<button class="ai-tool-permission ${app.enabled?'enabled':''}" data-ai-tool-toggle="${app.id}" aria-pressed="${app.enabled}">${toolIcon(app.id)}<span><strong>${i18n.t(app.title)}</strong><small>${i18n.t('toolCount').replace('{count}',definitions.length)}${hasHigh?` · ${i18n.t('includesProtectedActions')}`:''}</small></span><em>${i18n.t(app.enabled?'registered':'notRegistered')}</em><i></i></button>`}).join('')}</div></div>`;
      return `<div class="ai-settings-backdrop" data-ai-close-settings></div><section class="ai-settings-panel ai-settings-root">
        <header><div><span>${icon(settingsSection==='model'?'settings':'wrench',20)}</span><div><h2>${i18n.t('aiSettings')}</h2><p>${i18n.t(settingsSection==='model'?'providerConfiguration':'toolConfiguration')}</p></div></div><button data-ai-close-settings>${icon('close',16)}</button></header>
        <div class="ai-settings-layout"><nav><button class="${settingsSection==='model'?'selected':''}" data-ai-settings-section="model">${icon('settings',16)}<span><strong>${i18n.t('modelSettings')}</strong><small>${i18n.t('modelSettingsCopy')}</small></span>${icon('chevron',12)}</button><button class="${settingsSection==='tools'?'selected':''}" data-ai-settings-section="tools">${icon('wrench',16)}<span><strong>${i18n.t('toolSettings')}</strong><small>${i18n.t('toolSettingsCopy')}</small></span>${icon('chevron',12)}</button></nav><main>${settingsSection==='model'?modelContent:toolContent}</main></div>
        ${settingsSection==='model'?`<footer><button data-ai-close-settings>${i18n.t('cancel')}</button><button class="ai-primary" data-ai-save-settings>${i18n.t('save')}</button></footer>`:''}
      </section>`;
    };

    const send = async () => {
      const input = root.querySelector('[data-ai-composer]'), text = input?.value.trim();
      if (!text) return;
      if(!activeId)activeId=await aiAgent.createSession();
      localError = '';liveExecution=null;liveExecutionTurnId=null;workspaceDismissedId=workspaceSelectedId;
      input.value = '';
      render();
      aiAgent.send(activeId, text).catch(error => { localError = friendlyError(error); render(); });
    };

    const submitInlineEdit = () => {
      const text = root.querySelector('[data-ai-inline-edit]')?.value.trim(), turnId = editingTurnId;
      if (!text || turnId === null || !activeId) return;
      editingTurnId = null; editDraft = ''; localError = '';liveExecution=null;liveExecutionTurnId=null;workspaceDismissedId=workspaceSelectedId; render();
      aiAgent.editAndResend(activeId, turnId, text).catch(error => { localError = friendlyError(error); render(); });
    };

    const bind = () => {
      root.querySelectorAll('[data-ai-new]').forEach(button => button.onclick = async () => { activeId = await aiAgent.createSession(); localError = '';liveExecution=null;liveExecutionTurnId=null;workspaceSelectedId=null;workspaceDismissedId=null;lastObservedToolId=null; render(); });
      root.querySelectorAll('[data-ai-session]').forEach(button => { button.onclick = () => { activeId = button.dataset.aiSession; localError = '';liveExecution=null;liveExecutionTurnId=null;workspaceSelectedId=null;workspaceDismissedId=null;lastObservedToolId=null; render(); }; button.ondblclick = async () => { const session = aiAgent.sessionState(button.dataset.aiSession), title = await dialog.prompt({ title: i18n.t('renameChat'), value: session.title }); if (title) await aiAgent.renameSession(session.id, title); }; });
      root.querySelectorAll('[data-ai-delete]').forEach(button => button.onclick = async event => { event.stopPropagation(); const session = aiAgent.sessionState(button.dataset.aiDelete), approved = await dialog.confirm({ title: i18n.t('deleteChat'), message: i18n.t('deleteChatConfirm').replace('{name}', session.title), confirmLabel: i18n.t('delete'), danger: true }); if (!approved) return; await aiAgent.deleteSession(session.id); if (activeId === session.id) activeId = aiAgent.snapshot().sessions[0]?.id || null; render(); });
      root.querySelectorAll('[data-ai-copy-turn]').forEach(button => button.onclick = async () => { const turn=displayedTurns.find(item=>item.id===button.dataset.aiCopyTurn),text=button.dataset.aiCopyRole==='user'?messageText(turn?.user):assistantText(turn||{responses:[]});if(text&&await clipboard.copyText(text))shell.toast(i18n.t('copiedToClipboard')); });
      root.querySelectorAll('[data-ai-copy-error]').forEach(button=>button.onclick=async event=>{event.stopPropagation();const text=button.closest('.ai-copyable-error')?.querySelector('.ai-error-text')?.textContent||'';if(await clipboard.copyText(text))shell.toast(i18n.t('copiedToClipboard'));});
      root.querySelectorAll('[data-ai-edit-turn]').forEach(button => button.onclick = () => { editingTurnId=button.dataset.aiEditTurn;editDraft=messageText(displayedTurns.find(turn=>turn.id===editingTurnId)?.user);localError='';render();requestAnimationFrame(()=>{const editor=root.querySelector('[data-ai-inline-edit]');editor?.focus();editor?.setSelectionRange(editor.value.length,editor.value.length);editor?.style.setProperty('height',`${editor.scrollHeight}px`);}); });
      root.querySelector('[data-ai-cancel-inline-edit]')?.addEventListener('click', () => { editingTurnId = null; editDraft = ''; render(); });
      root.querySelector('[data-ai-submit-inline-edit]')?.addEventListener('click', submitInlineEdit);
      const inlineEditor = root.querySelector('[data-ai-inline-edit]');
      if (inlineEditor) { inlineEditor.oninput = () => { editDraft = inlineEditor.value; inlineEditor.style.height = 'auto'; inlineEditor.style.height = `${inlineEditor.scrollHeight}px`; }; inlineEditor.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); editingTurnId = null; editDraft = ''; render(); } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submitInlineEdit(); } }; }
      const search = root.querySelector('[data-ai-search]');
      if (search) search.oninput = event => { query = event.target.value; render({ preserveComposer: true, focusSearch: true }); };
      root.querySelectorAll('[data-ai-settings]').forEach(button => button.onclick = () => { settingsOpen = true;notificationOpen=false;render({ preserveComposer: true,focusComposer:false }); });
      root.querySelector('[data-ai-notifications]')?.addEventListener('click',async()=>{notificationOpen=!notificationOpen;settingsOpen=false;render({preserveComposer:true,focusComposer:false});if(notificationOpen)await notifications.markAllRead()});
      root.querySelector('[data-ai-close-notifications]')?.addEventListener('click',()=>{notificationOpen=false;render({preserveComposer:true})});
      root.querySelector('[data-ai-clear-notifications]')?.addEventListener('click',()=>notifications.clear());
      root.querySelectorAll('[data-ai-dismiss-notification]').forEach(button=>button.onclick=event=>{event.stopPropagation();notifications.dismiss(button.dataset.aiDismissNotification)});
      root.querySelectorAll('[data-ai-open-notification]').forEach(button=>button.onclick=()=>{const item=notifications.snapshot().items.find(entry=>entry.id===button.dataset.aiOpenNotification);notificationOpen=false;if(item)shell.open(item.appId)});
      root.querySelectorAll('[data-ai-settings-section]').forEach(button=>button.onclick=()=>{settingsSection=button.dataset.aiSettingsSection;render({preserveComposer:true});});
      root.querySelectorAll('[data-ai-tool-toggle]').forEach(button=>button.onclick=async()=>{try{const update=aiAgent.setToolAppEnabled(button.dataset.aiToolToggle,button.getAttribute('aria-pressed')!=='true');render({preserveComposer:true});await update;}catch(error){localError=friendlyError(error);render({preserveComposer:true});}});
      root.querySelectorAll('[data-ai-close-settings]').forEach(button => button.onclick = () => { settingsOpen = false; render({ preserveComposer: true }); });
      root.querySelector('[data-ai-reveal]')?.addEventListener('click', event => event.currentTarget.closest('.ai-secret-field').classList.toggle('revealed'));
      root.querySelector('[data-ai-save-settings]')?.addEventListener('click', async () => { try { await aiAgent.updateConfig({ baseUrl: root.querySelector('[data-ai-base]').value, apiKey: root.querySelector('[data-ai-key]').value, model: root.querySelector('[data-ai-model]').value, systemPrompt: root.querySelector('[data-ai-prompt]').value }); settingsOpen = false; localError = ''; shell.toast(i18n.t('aiSettingsSaved')); render(); } catch (error) { localError = friendlyError(error); render(); } });
      root.querySelectorAll('[data-ai-suggestion]').forEach(button => button.onclick = () => { const input = root.querySelector('[data-ai-composer]'); input.value = button.dataset.aiSuggestion; input.focus(); });
      root.querySelectorAll('[data-tool-call]').forEach(card=>card.querySelector('header')?.addEventListener('click',()=>{const activity=displayedActivities.find(item=>item.id===card.dataset.toolCall);if(!activity)return;workspaceSelectedId=activity.id;workspaceDismissedId=null;render({preserveComposer:true});}));
      root.querySelectorAll('[data-ai-workspace-tool]').forEach(button=>button.onclick=()=>{workspaceSelectedId=button.dataset.aiWorkspaceTool;workspaceDismissedId=null;render({preserveComposer:true});});
      root.querySelectorAll('[data-ai-open-workspace-app]').forEach(button=>button.onclick=()=>shell.open(button.dataset.aiOpenWorkspaceApp));
      const closeWorkspace=root.querySelector('[data-ai-close-workspace]');if(closeWorkspace)closeWorkspace.onclick=()=>{workspaceDismissedId=workspaceSelectedId;render({preserveComposer:true});};
      const composer = root.querySelector('[data-ai-composer]');
      if (composer) { composer.oninput = () => { composer.style.height = 'auto'; composer.style.height = `${Math.min(150, composer.scrollHeight)}px`; }; composer.onkeydown = event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); send(); } }; }
      root.querySelector('[data-ai-send]')?.addEventListener('click', () => {if(current()?.streaming){liveExecution=null;liveExecutionTurnId=null;aiAgent.abort(activeId)}else send()});
    };

    const offReady = kernel.bus.on('ai:ready', async () => { await ensureSession(); activeId ||= aiAgent.snapshot().sessions[0]?.id || null; render(); });
    const offChanged = kernel.bus.on('ai:changed', () => { if (activeId && !aiAgent.snapshot().sessions.some(item => item.id === activeId)) activeId = aiAgent.snapshot().sessions[0]?.id || null; render({ preserveComposer: true }); });
    const offAgent = kernel.bus.on('ai:agent-event', detail => { if(detail.sessionId!==activeId||settingsOpen)return;if(detail.event?.type==='message_update')updateStreamingMessage();else render({preserveComposer:true}); });
    const offCapability = kernel.bus.on('capability:execution', detail => { const session=current();if(session?.streaming){liveExecution=detail;liveExecutionTurnId=session.activeTurnId}if (!settingsOpen) render({ preserveComposer: true }); });
    const offNotifications = kernel.bus.on('notification:changed', state => {if(notificationOpen)render({preserveComposer:true,focusComposer:false});else root.querySelector('[data-ai-notification-dot]')?.classList.toggle('visible',state.unread>0)});
    const offLocale = kernel.bus.on('settings:change', ({ key }) => { if (key === 'locale') render({ preserveComposer: true }); });
    ensureSession().then(() => { activeId = aiAgent.snapshot().sessions[0]?.id || null; render(); });
    render();
    return () => { if(streamingFrame)cancelAnimationFrame(streamingFrame);offReady(); offChanged(); offAgent(); offCapability(); offNotifications(); offLocale(); };
  },
};
