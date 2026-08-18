import { icon } from '../../icons.js';
import { AI_STATE_STORAGE_KEY } from '../../services/AiAgentService.js';
import { collectToolActivities, contextViewMarkup, workspaceMarkup, workspaceSignature } from './AgentWorkspace.js';
import { renderMarkdown } from './MarkdownRenderer.js';
import { compactToolArguments } from '../../services/AgentMessageCompaction.js';

const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const messageText = message => typeof message?.content === 'string'
  ? message.content
  : (message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');
const messageBlocks = message => typeof message?.content === 'string'
  ? [{ type: 'text', text: message.content }]
  : (Array.isArray(message?.content) ? message.content : []);
const renderText = renderMarkdown;
const WORKSPACE_PREFS_KEY = 'aeris.ai.workspace';
const DEFAULT_WORKSPACE_WIDTH = 390;
const MIN_WORKSPACE_WIDTH = 310;
const MAX_WORKSPACE_WIDTH = 560;
const conversationSignature=session=>`${session?.activeTurnId||''}:${session?.busy?'1':'0'}:${(session?.turns||[]).map(turn=>`${turn.id}:${turn.status}:${turn.responses?.length||0}`).join('|')}`;

const readWorkspacePrefs = () => {
  try {
    const stored = JSON.parse(localStorage.getItem(WORKSPACE_PREFS_KEY) || '{}');
    return {
      open: Boolean(stored.open),
      width: Math.max(MIN_WORKSPACE_WIDTH, Math.min(MAX_WORKSPACE_WIDTH, Number(stored.width) || DEFAULT_WORKSPACE_WIDTH)),
      view: ['activity','context','results'].includes(stored.view) ? stored.view : 'activity',
    };
  } catch {
    return { open: false, width: DEFAULT_WORKSPACE_WIDTH, view: 'activity' };
  }
};

export default {
  id: 'ai', title: 'aiAssistant', icon: 'aerisAi', color: 'ai', width: 1280, height: 760,
  singleInstance: true, dockLeading: true,
  mount(root, { aiAgent, i18n, kernel, dialog, shell, clipboard, tools, notifications, agentContext, agentEntry, queryUser, userdata, system, settings, weather, music, metrics, machine, skillRegistry }) {
    const workspacePrefs = readWorkspacePrefs();
    let activeId = null, query = '', searchOpen = false, settingsOpen = false, notificationOpen = false, contextMenuOpen = false, settingsSection = 'model', localError = '', editingTurnId = null, editDraft = '', displayedTurns = [], skillCommandQuery = null, skillCommandIndex = 0, selectedSkillName = '';
    let workspaceSelectedId = null, activityAppId = null, activityAppIds = [], activityTarget = null, activityAppsOpen = false, activitySurface = null, lastObservedToolId = null, liveExecution = null, liveExecutionTurnId = null, displayedActivities = [], composerDraft = '', workspaceHighlightTimer = 0, followConversation = true, conversationResizeObserver = null;
    let workspaceOpen = workspacePrefs.open, workspaceWidth = workspacePrefs.width, workspaceView = workspacePrefs.view;

    const persistWorkspacePrefs = () => {
      try { localStorage.setItem(WORKSPACE_PREFS_KEY, JSON.stringify({ open: workspaceOpen, width: workspaceWidth, view: workspaceView })); } catch {}
    };

    const visibleSessions = () => aiAgent.snapshot().sessions.filter(session => session.title.toLowerCase().includes(query.toLowerCase()));
    const current = () => activeId ? aiAgent.sessionState(activeId) : null;
    const activityApp=()=>activityAppId?tools.registry.get(activityAppId):null;
    const activityContextWindows=()=>activityAppIds.map(id=>{const app=tools.registry.get(id);return app?{id:`activity:${id}`,appId:id,title:i18n.t(app.title),icon:app.icon,color:app.color||'grey',path:i18n.t('activityCompactView'),activity:true}:null}).filter(Boolean);
    const focusActivityContext=app=>{if(!app)return;agentContext.set({appId:app.id,label:i18n.t(app.title),resource:{kind:'application-view',id:`aeris://agent/apps/${app.id}`,uri:`aeris://agent/apps/${app.id}`,name:i18n.t(app.title),metadata:{appId:app.id,surface:'agent-activity',compact:true}}})};
    const unmountActivitySurface=()=>{if(!activitySurface)return;try{activitySurface.cleanup?.()}catch(error){kernel.bus.emit('app:cleanup-error',{appId:activitySurface.appId,error})}activitySurface=null};
    const mountActivitySurface=()=>{
      if(!workspaceOpen||workspaceView!=='activity')return;
      const app=activityApp(),host=root.querySelector('[data-ai-activity-host]');
      if(!app||!host||!app.activity?.mount)return;
      if(activitySurface?.appId===app.id&&activitySurface.host===host)return;
      unmountActivitySurface();
      const context={app,i18n,kernel,dialog,shell,clipboard,tools,notifications,agentContext,agentEntry,userdata,system,settings,weather,music,metrics,machine,openFullApp:(appId,path='')=>shell.open(appId,path||undefined)};
      activitySurface={appId:app.id,host,cleanup:app.activity.mount(host,context,activityTarget||{})||null};
    };
    const selectActivityApp=(id,target=null)=>{
      if(!id||id==='ai')return null;
      if(activityAppId!==id)unmountActivitySurface();
      activityAppId=id;activityTarget=target;
      activityAppIds=[id,...activityAppIds.filter(value=>value!==id)].slice(0,8);
      return tools.registry.get(id);
    };
    const activateApp=(appId,path='',target=null)=>{
      const app=selectActivityApp(appId,target||{path});
      if(!app)return null;
      activityAppsOpen=false;workspaceOpen=true;workspaceView='activity';persistWorkspacePrefs();
      return app;
    };
    const closeActivityApp=id=>{const wasActive=activityAppId===id;if(wasActive)unmountActivitySurface();activityAppIds=activityAppIds.filter(value=>value!==id);if(wasActive){activityAppId=activityAppIds[0]||null;activityTarget=null}};
    const friendlyError = error => /guest command|mkdir -p|__aeris_/i.test(error?.message || '') ? i18n.t('conversationSaveFailed') : (error?.message || String(error));
    const enabledSkills=()=>skillRegistry.list().filter(skill=>skill.enabled);
    const matchingSkills=()=>enabledSkills().filter(skill=>!skillCommandQuery||skill.name.includes(skillCommandQuery.toLowerCase()));
    const selectedSkill=()=>enabledSkills().find(skill=>skill.name===selectedSkillName)||null;
    const selectedSkillMarkup=()=>selectedSkill()?`<button class="ai-composer-skill" data-ai-remove-skill title="${i18n.t('removeSkill')}"><strong>/${esc(selectedSkill().name)}</strong>${icon('close',9)}</button>`:'';
    const skillCommandMarkup=()=>skillCommandQuery===null?'':`<section class="ai-skill-command-menu">${matchingSkills().length?matchingSkills().map((skill,index)=>`<button data-ai-select-skill="${esc(skill.name)}" class="${index===skillCommandIndex?'selected':''}"><strong>/${esc(skill.name)}</strong><small>${esc(skill.description)}</small></button>`).join(''):`<p>${i18n.t('noMatchingSkills')}</p>`}</section>`;
    const closeSkillCommand=()=>{if(skillCommandQuery===null)return;skillCommandQuery=null;skillCommandIndex=0;const host=root.querySelector('[data-ai-skill-command-host]');if(host)host.innerHTML=''};
    const syncComposerSkill=()=>{const row=root.querySelector('.ai-composer-input');if(!row)return;row.querySelector('[data-ai-remove-skill]')?.remove();if(selectedSkillMarkup())row.insertAdjacentHTML('afterbegin',selectedSkillMarkup());row.querySelector('[data-ai-remove-skill]')?.addEventListener('click',()=>{selectedSkillName='';syncComposerSkill();row.querySelector('[data-ai-composer]')?.focus()})};
    const chooseComposerSkill=name=>{const skill=enabledSkills().find(item=>item.name===name);if(!skill)return;selectedSkillName=skill.name;composerDraft=composerDraft.replace(/^\/[a-z0-9-]*\s*/i,'');const composer=root.querySelector('[data-ai-composer]');if(composer)composer.value=composerDraft;closeSkillCommand();syncComposerSkill();composer?.focus();composer?.setSelectionRange(composer.value.length,composer.value.length)};
    const ensureSession = () => {
      if (!aiAgent.ready || activeId) return;
      activeId = aiAgent.snapshot().sessions[0]?.id || null;
    };
    const syncNotificationIndicator=(state=notifications.snapshot())=>{const button=root.querySelector('[data-ai-notifications]'),dot=button?.querySelector('[data-ai-notification-dot]'),hasUnread=state.unread>0;if(dot)dot.classList.toggle('visible',hasUnread);if(button){button.classList.toggle('has-unread',hasUnread);button.setAttribute('aria-label',hasUnread?`${i18n.t('notifications')}, ${state.unread}`:i18n.t('notifications'))}};
    const notificationMarkup=()=>{const {items}=notifications.snapshot();return`<div class="ai-notification-backdrop" data-ai-close-notifications></div><section class="ai-notification-menu"><header><div><strong>${i18n.t('systemNotifications')}</strong><small>${i18n.t('notificationCenterCopy')}</small></div>${items.length?`<button data-ai-clear-notifications>${i18n.t('clearAll')}</button>`:''}</header><div>${items.length?items.map(item=>{const app=tools.registry.get(item.appId);return`<article class="${item.read?'':'unread'}"><button data-ai-open-notification="${item.id}"><span class="app-icon app-icon-${app?.color||'blue'}">${icon(app?.icon||'bell',18)}</span><div><small>${esc(app?i18n.t(app.title):'Aeris')}</small><strong>${esc(item.title)}</strong><p>${esc(item.message)}</p><time>${new Intl.DateTimeFormat(i18n.t('dateFormat'),{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(item.createdAt))}</time></div></button>${item.context?`<button class="ai-notification-agent" data-ai-handle-notification="${item.id}">${icon('aerisAi',11)} ${i18n.t('prepareWithAeris')}</button>`:''}<button data-ai-dismiss-notification="${item.id}" aria-label="${i18n.t('dismiss')}">${icon('close',11)}</button></article>`}).join(''):`<div class="ai-notification-empty">${icon('bell',27)}<strong>${i18n.t('noNotifications')}</strong><small>${i18n.t('notificationEmptyCopy')}</small></div>`}</div></section>`};
    const closeNotificationPanel=()=>{notificationOpen=false;root.querySelectorAll('.ai-notification-menu,.ai-notification-backdrop').forEach(node=>node.remove());const button=root.querySelector('[data-ai-notifications]');button?.classList.remove('selected');button?.setAttribute('aria-pressed','false')};
    const bindNotificationControls=(scope=root)=>{
      scope.querySelectorAll('[data-ai-close-notifications]').forEach(button=>button.onclick=closeNotificationPanel);
      scope.querySelector('[data-ai-clear-notifications]')?.addEventListener('click',()=>notifications.clear());
      scope.querySelectorAll('[data-ai-dismiss-notification]').forEach(button=>button.onclick=event=>{event.stopPropagation();notifications.dismiss(button.dataset.aiDismissNotification)});
      scope.querySelectorAll('[data-ai-open-notification]').forEach(button=>button.onclick=()=>{const item=notifications.snapshot().items.find(entry=>entry.id===button.dataset.aiOpenNotification);closeNotificationPanel();if(!item)return;notifications.markRead(item.id);const app=activateApp(item.appId,'',{notificationId:item.id,context:item.context});if(app)focusActivityContext(app);render({preserveComposer:true,preserveConversation:true,focusComposer:false})});
      scope.querySelectorAll('[data-ai-handle-notification]').forEach(button=>button.onclick=event=>{event.stopPropagation();const item=notifications.snapshot().items.find(entry=>entry.id===button.dataset.aiHandleNotification);if(!item)return;closeNotificationPanel();notifications.markRead(item.id);agentEntry.open({prompt:i18n.t('prepareWithAerisPrompt').replace('{title}',item.title),context:item.context,source:'notification'})});
    };
    const refreshNotificationPanel=state=>{if(!notificationOpen)return syncNotificationIndicator(state);const menu=root.querySelector('.ai-notification-menu'),domIds=[...(menu?.querySelectorAll('[data-ai-open-notification]')||[])].map(node=>node.dataset.aiOpenNotification),nextIds=state.items.map(item=>item.id);if(menu&&domIds.length===nextIds.length&&domIds.every((id,index)=>id===nextIds[index])){for(const item of state.items)menu.querySelector(`[data-ai-open-notification="${CSS.escape(item.id)}"]`)?.closest('article')?.classList.toggle('unread',!item.read);syncNotificationIndicator(state);return}root.querySelectorAll('.ai-notification-menu,.ai-notification-backdrop').forEach(node=>node.remove());const workspace=root.querySelector('.ai-workspace');if(workspace){workspace.insertAdjacentHTML('beforeend',notificationMarkup());bindNotificationControls(workspace)}syncNotificationIndicator(state)};
    const toggleNotificationPanel=()=>{if(notificationOpen)return closeNotificationPanel();notificationOpen=true;activityAppsOpen=false;settingsOpen=false;root.querySelectorAll('.ai-settings-root,[data-ai-close-settings].ai-settings-backdrop,.ai-applications-panel,[data-ai-close-applications].ai-settings-backdrop').forEach(node=>node.remove());const applicationsButton=root.querySelector('[data-ai-applications]');applicationsButton?.classList.remove('selected');applicationsButton?.setAttribute('aria-pressed','false');const workspace=root.querySelector('.ai-workspace');if(!workspace)return render({preserveComposer:true,preserveConversation:true,focusComposer:false});workspace.insertAdjacentHTML('beforeend',notificationMarkup());const button=root.querySelector('[data-ai-notifications]');button?.classList.add('selected');button?.setAttribute('aria-pressed','true');bindNotificationControls(workspace);notifications.markAllRead()};
    const contextMarkup=()=>{
      const context=agentContext.snapshot(),windows=shell.windowManager.contextWindows(),availableWindows=[...windows,...activityContextWindows()];
      const app=tools.registry.get(context?.appId),resource=context?.resource,label=resource?.name||resource?.path||resource?.date||context?.label||i18n.t('chooseContext'),desktop=resource?.kind==='desktop';
      const picker=`<section class="ai-context-picker" ${contextMenuOpen?'':'hidden'}><header><span><strong>${i18n.t('chooseContext')}</strong><small>${i18n.t('chooseContextCopy')}</small></span><button data-ai-close-context aria-label="${i18n.t('close')}">${icon('close',11)}</button></header><button data-ai-context-desktop class="${desktop?'selected':''}"><span class="app-icon app-icon-blue">${icon('desktop',14)}</span><span><strong>${i18n.t('desktop')}</strong><small>${i18n.t('desktopContext')}</small></span>${desktop?icon('check',11):''}</button>${availableWindows.map(item=>item.activity?`<button data-ai-context-activity="${esc(item.appId)}" class="${context?.appId===item.appId&&context?.resource?.kind==='application-view'?'selected':''}"><span class="app-icon app-icon-${item.color}">${icon(item.icon,14)}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.path)}</small></span>${context?.appId===item.appId&&context?.resource?.kind==='application-view'?icon('check',11):''}</button>`:`<button data-ai-context-window="${esc(item.id)}" class="${context?.windowId===item.id?'selected':''}"><span class="app-icon app-icon-${item.color}">${icon(item.icon,14)}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.path||i18n.t(item.minimized?'minimizedWindow':'openWindow'))}</small></span>${context?.windowId===item.id?icon('check',11):''}</button>`).join('')}</section>`;
      return`<div class="ai-composer-context ai-native-context-wrap"><button data-ai-context-selector aria-expanded="${contextMenuOpen}" title="${i18n.t('chooseContext')}"><span class="app-icon app-icon-${app?.color||'blue'}">${icon(app?.icon||(desktop?'desktop':'maximize'),12)}</span><strong>${esc(context?label:i18n.t('chooseContext'))}</strong>${context?.selection?.text?`<em>${i18n.t('selectedText')}</em>`:''}${icon('chevron',9)}</button>${picker}</div>`;
    };
    const approvalMarkup=()=>{const request=liveExecution?.phase==='approval'?liveExecution:tools.pendingApproval();if(!request)return'';const app=tools.registry.get(request.appId);return`<section class="ai-inline-approval" data-ai-approval="${esc(request.toolCallId)}"><span class="ai-tool-app-icon app-icon app-icon-${app?.color||'grey'}">${icon(app?.icon||'lock',16)}<i>${icon('lock',8)}</i></span><div><small>${i18n.t('approvalRequired')}</small><strong>${esc(request.label||i18n.t('approveAgentAction'))}</strong><p>${esc(request.approvalMessage||'')}</p></div><footer><button data-ai-deny-approval="${esc(request.toolCallId)}">${i18n.t('deny')}</button><button class="ai-approval-primary" data-ai-approve="${esc(request.toolCallId)}">${icon('check',12)}${i18n.t('approve')}</button></footer></section>`};
    const clarificationMarkup=()=>{const request=queryUser.pendingForSession(activeId);if(!request)return'';return`<section class="ai-inline-query" data-ai-query="${esc(request.toolCallId)}"><span>${icon('grid',17)}</span><div><small>${i18n.t('clarificationRequired')}</small><strong>${esc(i18n.t('appWidgetQuestion').replace('{app}',request.appName))}</strong><p>${i18n.t('appWidgetQuestionCopy')}</p></div><footer><button data-ai-query-choice="disable">${i18n.t('appOnly')}</button><button class="ai-query-primary" data-ai-query-choice="enable">${icon('grid',12)}${i18n.t('includeWidgets')}</button></footer></section>`};

    const toolIcon = (appId,skillTool=null) => { if(skillTool)return`<span class="ai-skill-call-icon">${icon('skill',17)}</span>`;const app=tools.registry.get(appId);return app?`<span class="ai-tool-app-icon app-icon app-icon-${app.color}">${icon(app.icon,17)}<i>${icon('wrench',8)}</i></span>`:`<span class="ai-tool-app-icon">${icon('wrench',16)}</span>`; };
    const errorMarkup=(message,className='ai-inline-error')=>`<div class="${className} ai-copyable-error" data-copyable><span class="ai-error-icon">${icon('warning',15)}</span><span class="ai-error-text">${esc(message)}</span><button data-ai-copy-error title="${i18n.t('copyError')}">${icon('copy',13)}</button></div>`;
    const formatTokens=value=>new Intl.NumberFormat(i18n.t('dateFormat'),{notation:Number(value)>=100000?'compact':'standard',maximumFractionDigits:1}).format(Number(value)||0);
    const usageMarkup=turn=>{const usage=aiAgent.turnUsage(turn);if(!usage.hasUsage)return'';return`<span class="ai-usage-trigger" tabindex="0" aria-label="${i18n.t('tokenUsage')}">${icon('chart',13)}<span class="ai-usage-tooltip" role="tooltip"><strong>${i18n.t('taskUsage')}</strong><small>${esc(usage.modelName||i18n.t('unknownModel'))}</small><dl><div><dt>${i18n.t('inputTokens')}</dt><dd>${formatTokens(usage.input)}</dd></div><div><dt>${i18n.t('outputTokens')}</dt><dd>${formatTokens(usage.output)}</dd></div><div><dt>${i18n.t('cacheReadTokens')}</dt><dd>${formatTokens(usage.cacheRead)}</dd></div><div><dt>${i18n.t('totalTokens')}</dt><dd>${formatTokens(usage.totalTokens)}</dd></div></dl></span></span>`};
    const toolCard = ({ name, toolCallId, args = {}, details = null, output = '', isError = false, turnStatus = 'running' }) => {
      const displayArgs=compactToolArguments(name,args);
      const metadata=tools.metadata(name)||{},execution={...(details||{}),...(tools.execution(toolCallId)||{})},skillTool=skillRegistry.toolMetadata(name);let phase=execution.phase||'running';
      if(['running','approval'].includes(phase)){if(isError||turnStatus==='failed')phase='failed';else if(turnStatus==='stopped')phase='cancelled';else if(turnStatus==='completed'&&output)phase='completed'}
      const app=tools.registry.get(metadata.appId||execution.appId),label=execution.label||metadata.label||skillTool?.label||name,skillName=execution.skillId||skillTool?.skillName||args?.name||'',source=skillTool?`${i18n.t(skillTool.kind==='loader'?'skillLoader':'skillTool')}${skillName?` · ${esc(skillName)}`:''}`:app?i18n.t(app.title):i18n.t('systemTool'),protectedAction=metadata.risk==='high'||execution.risk==='high';
      return `<section class="ai-tool-call ${skillTool?'ai-skill-tool-call':''} ${skillTool?.kind==='loader'?'ai-skill-loader-call':''} ai-tool-${phase}" data-tool-call="${esc(toolCallId)}"><header>${toolIcon(metadata.appId||execution.appId,skillTool)}<strong>${esc(label)}</strong><em>${i18n.t(`toolStatus_${phase}`)}</em><button data-ai-tool-expand aria-expanded="false" title="${i18n.t('showDetails')}">${icon('chevron',10)}</button></header><div class="ai-tool-call-details"><div class="ai-tool-detail-meta"><span><small>${esc(source)}</small><code>${esc(name)}</code></span>${protectedAction?`<b class="ai-risk-badge">${icon('lock',10)} ${i18n.t('approvalRequired')}</b>`:''}</div>${Object.keys(displayArgs).length?`<section><strong>${i18n.t('toolParameters')}</strong><pre data-copyable>${esc(JSON.stringify(displayArgs,null,2))}</pre></section>`:''}${output?`<section class="ai-tool-output"><strong>${i18n.t('toolResult')}</strong><p data-copyable>${esc(output).slice(0,1200)}</p></section>`:''}</div></section>`;
    };
    const assistantText = turn => (turn.responses||[]).filter(message=>message.role==='assistant').map(messageText).filter(Boolean).join('\n\n');
    const thinkingMarkup=(block,{active=false}={})=>{
      const content=String(block?.thinking||'').trim();
      if(!content&&!active)return'';
      return `<details class="ai-thinking ${active?'is-thinking':''}" ${active?'open':''}><summary><span>${icon('sparkles',12)}</span><strong>${i18n.t(active?'thinkingInProgress':'thinking')}</strong><i>${active?'<b></b>':icon('chevron',9)}</i></summary><div class="ai-thinking-content" data-copyable>${content?renderText(content):`<span class="ai-thinking-placeholder">${i18n.t('thinkingInProgress')}</span>`}</div></details>`;
    };
    const assistantBlocksMarkup=(message,{streaming=false,resultForCall=null,turnStatus='running'}={})=>{
      const blocks=messageBlocks(message),lastMeaningfulIndex=blocks.reduce((last,block,index)=>block?.type==='thinking'||block?.type==='text'||block?.type==='toolCall'?index:last,-1),parts=[];
      blocks.forEach((block,index)=>{
        if(block?.type==='thinking')parts.push(thinkingMarkup(block,{active:streaming&&index===lastMeaningfulIndex}));
        else if(block?.type==='text'&&String(block.text||'').trim())parts.push(`<div class="ai-message-content ai-turn-text" data-copyable>${renderText(block.text)}</div>`);
        else if(block?.type==='toolCall'){
          const result=resultForCall?.(block.id);parts.push(toolCard({name:result?.toolName||block.name,toolCallId:block.id,args:block.arguments,details:result?.details,output:result?messageText(result):'',isError:result?.isError,turnStatus}));
        }
      });
      return parts.filter(Boolean).join('');
    };
    const answerMarkup = (turn, session) => {
      const responses=turn.responses||[],results=new Map(responses.filter(message=>message.role==='toolResult').map(message=>[message.toolCallId,message])),usedResults=new Set(),parts=[];
      for(const response of responses){
        if(response.role==='assistant'){
          parts.push(assistantBlocksMarkup(response,{resultForCall:id=>{const result=results.get(id);if(result)usedResults.add(id);return result},turnStatus:turn.status}));
        }else if(response.role==='toolResult'&&!usedResults.has(response.toolCallId))parts.push(toolCard({name:response.toolName,toolCallId:response.toolCallId,details:response.details,output:messageText(response),isError:response.isError,turnStatus:turn.status}));
      }
      const streaming=turn.id===session.activeTurnId?session.streamingMessage:null;
      if(streaming?.role==='assistant'){
        const streamMarkup=assistantBlocksMarkup(streaming,{streaming:true,turnStatus:turn.status});
        parts.push(`<div class="ai-turn-stream ai-assistant-stream" data-ai-turn-stream>${streamMarkup||'<span class="ai-typing"><i></i><i></i><i></i></span>'}</div>`);
      }else if(turn.status==='running'&&turn.id===session.activeTurnId&&session.streaming)parts.push(`<div class="ai-turn-stream" data-ai-turn-stream><span class="ai-typing"><i></i><i></i><i></i></span></div>`);
      if(turn.status==='failed'&&turn.error)parts.push(errorMarkup(turn.error));
      return parts.join('');
    };
    const turnMarkup = (turn, index, lastTurnIndex, session) => {
      const editing=turn.id===editingTurnId,userText=messageText(turn.user),answer=answerMarkup(turn,session),showAnswer=Boolean(answer||turn.status==='failed'||turn.status==='stopped');
      const actionsAvailable=turn.status!=='running'&&!(index===lastTurnIndex&&session.busy);
      const userActions=actionsAvailable?`<footer class="ai-message-actions"><button data-ai-copy-turn="${esc(turn.id)}" data-ai-copy-role="user" title="${i18n.t('copyMessage')}">${icon('copy',14)}</button>${index===lastTurnIndex&&!session.busy?`<button data-ai-edit-turn="${esc(turn.id)}" title="${i18n.t('editMessage')}">${icon('textedit',14)}</button>`:''}</footer>`:'';
      const assistantActions=actionsAvailable?`<footer class="ai-message-actions"><button data-ai-copy-turn="${esc(turn.id)}" data-ai-copy-role="assistant" title="${i18n.t('copyMessage')}">${icon('copy',14)}</button>${usageMarkup(turn)}</footer>`:'';
      const userBody=editing?`<div class="ai-inline-editor"><textarea data-ai-inline-edit rows="2">${esc(editDraft)}</textarea><footer><button data-ai-cancel-inline-edit>${i18n.t('cancel')}</button><button class="ai-primary" data-ai-submit-inline-edit>${i18n.t('send')}</button></footer></div>`:`<div class="ai-message-content" data-copyable>${renderText(userText)}</div>${userActions}`;
      return `<section class="ai-turn ${actionsAvailable?'':'ai-turn-running'}" data-ai-turn="${esc(turn.id)}">
        <article class="ai-message ai-message-user"><span class="ai-message-avatar">${icon('user',16)}</span><div class="ai-message-body ${editing?'editing':''}">${userBody}</div></article>
        ${showAnswer?`<article class="ai-message ai-message-assistant" data-ai-turn-answer="${esc(turn.id)}"><span class="ai-message-avatar">${icon('aerisAi',17)}</span><div class="ai-message-body"><header>${i18n.t('aerisAI')}</header><div class="ai-turn-response">${answer}</div>${assistantActions}</div></article>`:''}
      </section>`;
    };
    const conversationMarkup=(state,session,configured)=>{
      const turns=session?.turns||[];displayedTurns=turns;
      if(!state.ready)return`<div class="ai-center-state"><span class="ai-orb waiting">${icon('aerisAi',30)}</span><h2>${i18n.t('preparingAI')}</h2>${state.error?errorMarkup(state.error,'ai-center-error'):`<p>${i18n.t('waitingForLinuxAI')}</p>`}</div>`;
      if(!configured)return`<div class="ai-center-state"><span class="ai-orb">${icon('aerisAi',30)}</span><h2>${i18n.t('meetAerisAI')}</h2><p>${i18n.t('configureAICopy')}</p><button data-ai-settings class="ai-primary">${i18n.t('configureAI')}</button></div>`;
      if(!turns.length)return`<div class="ai-welcome"><h1>${i18n.t('howCanIHelp')}</h1><p>${i18n.t('aiWelcomeCopy')}</p><div class="ai-suggestions">${['aiSuggestionOne','aiSuggestionTwo','aiSuggestionThree'].map(key=>`<button data-ai-suggestion="${esc(i18n.t(key))}">${icon('sparkles',14)}<span>${i18n.t(key)}</span>${icon('chevron',13)}</button>`).join('')}</div></div>`;
      return`<div class="ai-message-stack">${turns.map((turn,index)=>turnMarkup(turn,index,turns.length-1,session)).join('')}${session.error?errorMarkup(session.error):''}</div>`;
    };
    const nearConversationBottom=conversation=>!conversation||conversation.scrollHeight-conversation.scrollTop-conversation.clientHeight<120;
    const scrollConversationToBottom=()=>{if(!followConversation)return;requestAnimationFrame(()=>{const conversation=root.querySelector('[data-ai-conversation]');if(conversation)conversation.scrollTop=conversation.scrollHeight})};
    const bindConversationViewport=conversation=>{conversationResizeObserver?.disconnect();conversationResizeObserver=null;if(!conversation)return;conversation.onscroll=()=>{followConversation=nearConversationBottom(conversation)};const content=conversation.firstElementChild;if(content&&typeof ResizeObserver!=='undefined'){conversationResizeObserver=new ResizeObserver(()=>{if(followConversation)conversation.scrollTop=conversation.scrollHeight});conversationResizeObserver.observe(content)}};

    const render = ({ preserveComposer = false, preserveConversation = false, focusSearch = false, focusComposer = preserveComposer } = {}) => {
      const draft = preserveComposer ? root.querySelector('[data-ai-composer]')?.value ?? composerDraft : composerDraft;composerDraft=draft;
      const previousConversation=root.querySelector('[data-ai-conversation]'),previousConversationScroll=previousConversation?.scrollTop||0,shouldFollowConversation=followConversation||nearConversationBottom(previousConversation);
      const previousWorkspace=root.querySelector('[data-ai-app-workspace]');
      const state = aiAgent.snapshot(), session = current(), configured = Boolean(aiAgent.config().apiKey), notificationState=notifications.snapshot();
      const taskActive=Boolean(session?.busy);
      const turns=session?.turns||[];displayedTurns=turns;
      const currentConversationSignature=conversationSignature(session),reuseConversation=Boolean(preserveConversation&&previousConversation&&previousConversation.dataset.aiConversationSignature===currentConversationSignature);
      const sessions = visibleSessions();
      const currentLive=session?.streaming&&session.activeTurnId===liveExecutionTurnId?liveExecution:null;
      const activities=collectToolActivities(session,tools,currentLive),latestActivity=activities.at(-1)||null,activeActivity=[...activities].reverse().find(activity=>activity.phase==='running'||activity.phase==='approval')||null,foregroundActivity=activeActivity||latestActivity;
      if(activeActivity&&activeActivity.id!==lastObservedToolId){lastObservedToolId=activeActivity.id;workspaceSelectedId=activeActivity.id;workspaceOpen=true;persistWorkspacePrefs()}
      let workspaceActivity=activities.find(activity=>activity.id===workspaceSelectedId)||foregroundActivity;
      if(workspaceActivity)workspaceSelectedId=workspaceActivity.id;
      displayedActivities=activities;
      const workspaceVisible=workspaceOpen;
      const workspaceContext=agentContext.snapshot(),contextWindows=shell.windowManager.contextWindows();
      if(workspaceView==='activity'&&!activityAppIds.includes(activityAppId))activityAppId=activityAppIds[0]||null;
      const activityApps=activityAppIds.map(id=>tools.registry.get(id)).filter(Boolean);
      const localeSignature=i18n.t('dateFormat'),historySignature=activities.map(item=>`${item.id}:${item.phase}:${item.finishedAt||0}`).join('|'),contextSignature=workspaceView==='context'?JSON.stringify({context:workspaceContext,windows:contextWindows.map(item=>({id:item.id,title:item.title,path:item.path,minimized:item.minimized}))}):workspaceView==='activity'?JSON.stringify({activityAppId,activityAppIds,target:activityTarget?.id||activityTarget?.result?.id||activityTarget?.path||''}):'';
      const signature=workspaceView==='activity'?`activity:${localeSignature}:${contextSignature}`:workspaceView==='context'?`context:${localeSignature}:${contextSignature}`:workspaceSignature(workspaceActivity,`${localeSignature}:results:${historySignature}`),reuseWorkspace=Boolean(previousWorkspace&&workspaceVisible&&previousWorkspace.dataset.workspaceSignature===signature),animateWorkspace=!previousWorkspace||previousWorkspace.dataset.workspaceToolId!==(workspaceActivity?.id||'');
      const shellMarkup=`<div class="system-app ai-system-app ${workspaceVisible?'has-app-workspace':''}" style="--agent-workspace-width:${workspaceWidth}px">
        <aside class="ai-sidebar">
          <header><span class="ai-brand-icon">${icon('aerisAi', 21)}</span><strong>${i18n.t('aerisAI')}</strong></header>
          <button class="ai-new-chat" data-ai-new>${icon('plus',15)}<span>${i18n.t('newChat')}</span></button>
          <div class="ai-conversation-heading"><strong>${i18n.t('conversations')}</strong><button data-ai-toggle-search class="${searchOpen?'selected':''}" aria-pressed="${searchOpen}" title="${i18n.t('searchChats')}">${icon('search',14)}</button></div>
          ${searchOpen?`<label class="ai-search">${icon('search',14)}<input data-ai-search value="${esc(query)}" placeholder="${i18n.t('searchChats')}"></label>`:''}
          <nav class="ai-session-list">${sessions.length ? sessions.map(item => `<div class="ai-session-row ${item.id === activeId ? 'selected' : ''}"><button data-ai-session="${item.id}"><span>${icon('message', 15)}</span><span><strong>${esc(item.title)}</strong><small>${new Intl.DateTimeFormat(i18n.t('dateFormat'), { month: 'short', day: 'numeric' }).format(item.updatedAt)}</small></span>${item.streaming ? '<i></i>' : ''}</button><button data-ai-delete="${item.id}" title="${i18n.t('deleteChat')}">${icon('delete', 13)}</button></div>`).join('') : `<div class="ai-sidebar-empty">${i18n.t(query ? 'noSearchResults' : 'noConversations')}</div>`}</nav>
          <footer><button data-ai-settings>${icon('settings', 16)}<span><strong>${i18n.t('settings')}</strong></span></button></footer>
        </aside>
        <section class="ai-workspace">
          <header class="ai-toolbar"><div><strong>${session ? esc(session.title) : i18n.t('aerisAI')}</strong><small>${configured ? esc(aiAgent.config().model) : i18n.t('notConnected')}</small></div><span class="ai-local-badge">${icon('lock', 12)} ${i18n.t('storedOnThisComputer')}</span><button class="ai-workspace-toggle ${workspaceVisible?'selected':''}" data-ai-toggle-workspace aria-pressed="${workspaceVisible}" title="${i18n.t(workspaceVisible?'closeWorkspace':'openWorkspace')}">${icon('panelRight', 17)}</button><button class="ai-applications-button ${activityAppsOpen?'selected':''}" data-ai-applications aria-pressed="${activityAppsOpen}" title="${i18n.t('openApplication')}">${icon('grid', 17)}</button><button class="ai-notification-button ${notificationOpen?'selected':''} ${notificationState.unread?'has-unread':''}" data-ai-notifications title="${i18n.t('notifications')}" aria-label="${notificationState.unread?`${i18n.t('notifications')}, ${notificationState.unread}`:i18n.t('notifications')}">${icon('bell', 17)}<i class="${notificationState.unread?'visible':''}" data-ai-notification-dot></i></button></header>
          <main class="ai-conversation" data-ai-conversation data-ai-conversation-signature="${esc(currentConversationSignature)}">
            ${conversationMarkup(state,session,configured)}
          </main>
          <footer class="ai-composer-area">
            ${localError ? errorMarkup(localError,'ai-composer-error') : ''}
            ${clarificationMarkup()}
            ${approvalMarkup()}
            <div class="ai-composer-shell ${taskActive ? 'streaming' : ''}"><div data-ai-skill-command-host>${skillCommandMarkup()}</div><div class="ai-composer-input">${selectedSkillMarkup()}<textarea data-ai-composer rows="1" placeholder="${i18n.t('messageAerisAI')}" ${!state.ready || !configured || editingTurnId !== null || taskActive ? 'disabled' : ''}>${esc(draft)}</textarea></div><div class="ai-composer-toolbar">${contextMarkup()}<label class="ai-composer-model" title="${i18n.t('aiModel')}">${icon('sparkles',12)}<select data-ai-composer-model ${taskActive?'disabled':''}>${aiAgent.modelOptions().map(model=>`<option value="${esc(model.key)}" ${model.key===aiAgent.config().activeModelKey?'selected':''}>${esc(model.label)}</option>`).join('')}<option value="__settings__">${i18n.t('modelSettings')}…</option></select><em>${i18n.t(`reasoning_${aiAgent.config().reasoningEffort||'medium'}`)}</em>${icon('chevron',9)}</label><span></span><button data-ai-send ${!state.ready || !configured || editingTurnId !== null ? 'disabled' : ''} aria-label="${i18n.t(taskActive ? 'stopGenerating' : 'send')}">${icon(taskActive ? 'stopSquare' : 'arrowUp', 17)}</button></div></div>
            <small>${i18n.t('aiMayMakeMistakes')}</small>
          </footer>
          ${settingsOpen ? settingsMarkup() : ''}
          ${activityAppsOpen ? applicationsMarkup() : ''}
          ${notificationOpen ? notificationMarkup() : ''}
        </section>
        ${workspaceVisible?workspaceMarkup(workspaceActivity,activities,tools,i18n,{animate:animateWorkspace,signature,view:workspaceView,context:workspaceContext,windows:contextWindows,activityApps,activityAppId}):''}
      </div>`;
      const currentShell=root.querySelector(':scope > .ai-system-app'),template=document.createElement('template');template.innerHTML=shellMarkup.trim();const nextShell=template.content.firstElementChild;
      if(!currentShell){root.replaceChildren(nextShell)}else{
        const nextConversation=nextShell.querySelector('[data-ai-conversation]');
        if(reuseConversation&&previousConversation&&nextConversation)nextConversation.replaceWith(previousConversation);
        const currentSidebar=currentShell.querySelector(':scope > .ai-sidebar'),nextSidebar=nextShell.querySelector(':scope > .ai-sidebar'),currentCenter=currentShell.querySelector(':scope > .ai-workspace'),nextCenter=nextShell.querySelector(':scope > .ai-workspace');
        if(currentSidebar&&nextSidebar)currentSidebar.replaceWith(nextSidebar);
        if(currentCenter&&nextCenter)currentCenter.replaceWith(nextCenter);
        currentShell.className=nextShell.className;currentShell.setAttribute('style',nextShell.getAttribute('style')||'');
        const nextWorkspace=nextShell.querySelector(':scope > [data-ai-app-workspace]');
        if(reuseWorkspace&&previousWorkspace&&nextWorkspace){
          previousWorkspace.className=`${nextWorkspace.className} ai-app-workspace-stable`.trim();
          previousWorkspace.dataset.workspaceToolId=nextWorkspace.dataset.workspaceToolId||'';
          previousWorkspace.dataset.workspaceSignature=nextWorkspace.dataset.workspaceSignature||'empty';
          const currentHeader=previousWorkspace.querySelector(':scope > header'),nextHeader=nextWorkspace.querySelector(':scope > header');
          if(currentHeader&&nextHeader&&currentHeader.innerHTML!==nextHeader.innerHTML)currentHeader.replaceWith(nextHeader);
        }else if(workspaceVisible&&nextWorkspace){
          unmountActivitySurface();
          if(previousWorkspace){
            previousWorkspace.className=`${nextWorkspace.className} ai-app-workspace-stable`.trim();
            previousWorkspace.dataset.workspaceToolId=nextWorkspace.dataset.workspaceToolId||'';
            previousWorkspace.dataset.workspaceSignature=nextWorkspace.dataset.workspaceSignature||'empty';
            previousWorkspace.replaceChildren(...nextWorkspace.childNodes);
          }else currentShell.append(nextWorkspace);
        }else if(previousWorkspace){
          unmountActivitySurface();previousWorkspace.remove();
        }
      }
      bind();
      mountActivitySurface();
      requestAnimationFrame(() => {
        const conversation = root.querySelector('[data-ai-conversation]');
        bindConversationViewport(conversation);
        if (conversation) {followConversation=shouldFollowConversation;conversation.scrollTop=shouldFollowConversation?conversation.scrollHeight:previousConversationScroll}
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
        if(message?.role!=='assistant')return;
        const blocks=messageBlocks(message);
        if(blocks.some(block=>block.type==='toolCall'))return refreshActiveAnswer();
        const answer=[...root.querySelectorAll('[data-ai-turn-answer]')].find(node=>node.dataset.aiTurnAnswer===session.activeTurnId),target=answer?.querySelector('[data-ai-turn-stream]'),conversation=root.querySelector('[data-ai-conversation]');
        if(!target||!conversation)return render({preserveComposer:true});
        const text=messageText(message);
        // The next assistant protocol message is briefly empty after tool
        // results are appended to the same turn. Keep the existing UI until
        // the final response begins producing text.
        if(!text&&!blocks.some(block=>block.type==='thinking'))return;
        const nearBottom=followConversation||nearConversationBottom(conversation);
        target.innerHTML=blocks.some(block=>block.type==='thinking')
          ? assistantBlocksMarkup(message,{streaming:true,turnStatus:'running'})
          : `<div class="ai-message-content ai-turn-text" data-copyable>${renderText(text)}</div>`;
        if(nearBottom){followConversation=true;scrollConversationToBottom()}
      });
    };

    const settingsMarkup = () => {
      const config = aiAgent.config();
      const usageDays=Array.from({length:7},(_,offset)=>{const date=new Date();date.setHours(12,0,0,0);date.setDate(date.getDate()-(6-offset));const key=`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;return{key,label:new Intl.DateTimeFormat(i18n.t('dateFormat'),{month:'numeric',day:'numeric'}).format(date),full:new Intl.DateTimeFormat(i18n.t('dateFormat'),{year:'numeric',month:'short',day:'numeric'}).format(date)}});
      const modelRow=(provider,model)=>`<article class="ai-model-row" data-ai-model-row><label class="ai-model-active"><input type="radio" name="ai-active-model" ${config.activeModelKey===`${provider.id}::${model.id}`?'checked':''}><i></i></label><label><span>${i18n.t('modelId')}</span><input data-ai-model-id value="${esc(model.id)}" spellcheck="false"></label><label><span>${i18n.t('displayName')}</span><input data-ai-model-name value="${esc(model.name)}"></label><label><span>${i18n.t('reasoningEffort')}</span><select data-ai-model-effort>${['low','medium','high'].map(level=>`<option value="${level}" ${model.reasoningEffort===level?'selected':''}>${i18n.t(`reasoning_${level}`)}</option>`).join('')}</select></label><button data-ai-remove-model title="${i18n.t('removeModel')}">${icon('delete',13)}</button></article>`;
      const providerCard=(provider,{open=false}={})=>`<section class="ai-provider-card" data-ai-provider="${esc(provider.id)}"><details data-ai-provider-details ${open?'open':''}><summary><span>${icon('globe',16)}</span><span><strong data-ai-provider-summary-name>${esc(provider.name||i18n.t('unnamedProvider'))}</strong><small data-ai-provider-summary-base>${esc(provider.baseUrl||i18n.t('endpointNotSet'))}</small></span><i>${icon('chevron',11)}</i></summary><div class="ai-provider-details"><label><span>${i18n.t('providerName')}</span><input data-ai-provider-name value="${esc(provider.name)}" placeholder="${i18n.t('providerName')}"></label><label><span>${i18n.t('apiBaseUrl')}</span><input data-ai-provider-base type="url" value="${esc(provider.baseUrl)}" spellcheck="false"></label><label><span>${i18n.t('apiKey')}</span><div class="ai-secret-field"><input data-ai-provider-key type="text" value="${esc(provider.apiKey)}" spellcheck="false" autocomplete="off" data-lpignore="true"><button data-ai-reveal type="button">${icon('eye',14)}</button></div></label><div class="ai-provider-models">${provider.models.map(model=>modelRow(provider,model)).join('')}</div><footer><button class="ai-add-model" data-ai-add-model>${icon('plus',12)} ${i18n.t('addModel')}</button><button class="ai-remove-provider" data-ai-remove-provider>${icon('delete',12)} ${i18n.t('removeProvider')}</button></footer></div></details></section>`;
      const modelContent=`<div class="ai-settings-scroll ai-model-settings"><header><div><h3>${i18n.t('configuredModels')}</h3><p>${i18n.t('configuredModelsCopy')}</p></div><button data-ai-add-provider>${icon('plus',12)} ${i18n.t('addProvider')}</button></header><div data-ai-provider-list>${config.providers.map(providerCard).join('')}</div><label><span>${i18n.t('systemInstructions')}</span><textarea data-ai-prompt rows="5">${esc(config.systemPrompt)}</textarea></label><div class="ai-storage-card">${icon('folder',18)}<span><strong>${i18n.t('conversationStorage')}</strong><code>localStorage · ${AI_STATE_STORAGE_KEY}</code></span></div></div>`;
      const usageRows=aiAgent.usageSummary(),usageChart=row=>{const days=usageDays.map(day=>({...day,...(row.daily?.[day.key]||{})})),maximum=Math.max(1,...days.flatMap(day=>[Number(day.input)||0,Number(day.output)||0,Number(day.cacheRead)||0])),metrics=[['input',i18n.t('inputTokens')],['output',i18n.t('outputTokens')],['cacheRead',i18n.t('cacheReadTokens')]];return`<div class="ai-usage-chart"><header><strong>${i18n.t('lastSevenDays')}</strong><span>${metrics.map(([field,label])=>`<i class="${field}"></i>${label}`).join('')}</span></header><div class="ai-usage-grouped-bars">${days.map(day=>`<div class="ai-usage-day"><div>${metrics.map(([field,label])=>{const value=Number(day[field])||0,height=value?Math.max(6,value/maximum*100):0;return`<i class="${field}" style="height:${height}%" title="${esc(`${day.full} · ${label} ${formatTokens(value)}`)}"></i>`}).join('')}</div><small>${esc(day.label)}</small></div>`).join('')}</div></div>`},usageContent=`<div class="ai-usage-settings"><header><h3>${i18n.t('usage')}</h3><p>${i18n.t('usageSettingsCopy')}</p></header>${usageRows.length?`<div class="ai-usage-table"><div class="head"><span>${i18n.t('aiModel')}</span><span>${i18n.t('inputTokens')}</span><span>${i18n.t('outputTokens')}</span><span>${i18n.t('cacheReadTokens')}</span><span>${i18n.t('totalTokens')}</span><i></i></div>${usageRows.map(row=>`<details class="ai-usage-row"><summary><span><strong>${esc(row.modelName)}</strong><small>${esc(row.providerName)} · ${row.requests} ${i18n.t('requests')}</small></span><b>${formatTokens(row.input)}</b><b>${formatTokens(row.output)}</b><b>${formatTokens(row.cacheRead)}</b><b>${formatTokens(row.totalTokens)}</b><i>${icon('chevron',10)}</i></summary>${usageChart(row)}</details>`).join('')}</div>`:`<div class="ai-usage-empty">${icon('chart',28)}<strong>${i18n.t('noUsageData')}</strong><small>${i18n.t('noUsageDataCopy')}</small></div>`}</div>`;
      const toolContent=`<div class="ai-tool-settings"><header><h3>${i18n.t('registeredApps')}</h3><p>${i18n.t('toolAccessCopy')}</p></header><div>${aiAgent.toolApps().map(app=>{const definitions=tools.list().filter(tool=>tool.appId===app.id),hasHigh=definitions.some(tool=>tool.risk==='high');return`<button class="ai-tool-permission ${app.enabled?'enabled':''}" data-ai-tool-toggle="${app.id}" aria-pressed="${app.enabled}">${toolIcon(app.id)}<span><strong>${i18n.t(app.title)}</strong><small>${i18n.t('toolCount').replace('{count}',definitions.length)}${hasHigh?` · ${i18n.t('includesProtectedActions')}`:''}</small></span><em>${i18n.t(app.enabled?'registered':'notRegistered')}</em><i></i></button>`}).join('')}</div></div>`;
      const skillContent=`<div class="ai-tool-settings ai-skill-settings"><header><div><h3>${i18n.t('skillSettings')}</h3><p>${i18n.t('skillAccessCopy')}</p></div><button data-ai-import-skill>${icon('plus',12)} ${i18n.t('importSkill')}</button></header><div>${skillRegistry.list().map(skill=>`<button class="ai-tool-permission ai-skill-permission ${skill.enabled?'enabled':''}" data-ai-skill-toggle="${esc(skill.name)}" aria-pressed="${skill.enabled}"><span class="ai-skill-icon">${icon('skill',17)}</span><span><strong>${esc(skill.name)}</strong><small>${esc(skill.description)}</small></span><em>${i18n.t(skill.bundled?'builtInSkill':'importedSkill')}${skill.toolCount?` · ${i18n.t('skillToolCount').replace('{count}',skill.toolCount)}`:''}</em><i></i></button>`).join('')}</div></div>`;
      const sectionIcon=settingsSection==='model'?'settings':settingsSection==='usage'?'chart':settingsSection==='tools'?'wrench':'skill',sectionCopy=settingsSection==='model'?'providerConfiguration':settingsSection==='usage'?'usageSettingsCopy':settingsSection==='tools'?'toolConfiguration':'skillConfiguration',sectionContent=settingsSection==='model'?modelContent:settingsSection==='usage'?usageContent:settingsSection==='tools'?toolContent:skillContent;
      return `<div class="ai-settings-backdrop" data-ai-close-settings></div><section class="ai-settings-panel ai-settings-root">
        <header><div><span>${icon(sectionIcon,20)}</span><div><h2>${i18n.t('settings')}</h2><p>${i18n.t(sectionCopy)}</p></div></div><button data-ai-close-settings>${icon('close',16)}</button></header>
        <div class="ai-settings-layout"><nav><button class="${settingsSection==='model'?'selected':''}" data-ai-settings-section="model">${icon('settings',16)}<span><strong>${i18n.t('modelSettings')}</strong><small>${i18n.t('modelSettingsCopy')}</small></span>${icon('chevron',12)}</button><button class="${settingsSection==='usage'?'selected':''}" data-ai-settings-section="usage">${icon('chart',16)}<span><strong>${i18n.t('usage')}</strong><small>${i18n.t('usageSettingsNavCopy')}</small></span>${icon('chevron',12)}</button><button class="${settingsSection==='tools'?'selected':''}" data-ai-settings-section="tools">${icon('wrench',16)}<span><strong>${i18n.t('toolSettings')}</strong><small>${i18n.t('toolSettingsCopy')}</small></span>${icon('chevron',12)}</button><button class="${settingsSection==='skills'?'selected':''}" data-ai-settings-section="skills">${icon('skill',16)}<span><strong>${i18n.t('skillSettings')}</strong><small>${i18n.t('skillSettingsCopy')}</small></span>${icon('chevron',12)}</button></nav><main>${sectionContent}</main></div>
        ${settingsSection==='model'?`<footer><button data-ai-close-settings>${i18n.t('cancel')}</button><button class="ai-primary" data-ai-save-settings>${i18n.t('save')}</button></footer>`:''}
      </section>`;
    };

    const applicationsMarkup=()=>{
      const apps=tools.registry.list().filter(app=>app.id!=='ai');
      return `<div class="ai-settings-backdrop" data-ai-close-applications></div><section class="ai-settings-panel ai-applications-panel">
        <header><div><span>${icon('grid',20)}</span><div><h2>${i18n.t('applications')}</h2><p>${i18n.t('workspaceActivityCopy')}</p></div></div><button data-ai-close-applications aria-label="${i18n.t('close')}">${icon('close',16)}</button></header>
        <main><div class="ai-applications-grid">${apps.map(app=>`<button data-ai-activity-open-app="${esc(app.id)}"><span class="app-icon app-icon-${esc(app.color||'grey')}">${icon(app.icon,22)}</span><span><strong>${esc(i18n.t(app.title))}</strong><small>${activityAppIds.includes(app.id)?i18n.t('activityActive'):shell.windowManager.isOpen(app.id)?i18n.t('running'):i18n.t('openApplication')}</small></span>${icon('chevron',11)}</button>`).join('')}</div></main>
      </section>`;
    };
    const closeApplicationsPanel=()=>{
      activityAppsOpen=false;
      root.querySelectorAll('.ai-applications-panel,[data-ai-close-applications].ai-settings-backdrop').forEach(node=>node.remove());
      const button=root.querySelector('[data-ai-applications]');
      button?.classList.remove('selected');button?.setAttribute('aria-pressed','false');
    };
    const bindApplicationControls=(scope=root)=>{
      scope.querySelectorAll('[data-ai-activity-open-app]').forEach(button=>button.onclick=()=>{activityAppsOpen=false;const app=activateApp(button.dataset.aiActivityOpenApp);focusActivityContext(app);render({preserveComposer:true,preserveConversation:true,focusComposer:false})});
      scope.querySelectorAll('[data-ai-close-applications]').forEach(button=>button.onclick=closeApplicationsPanel);
    };
    const toggleApplicationsPanel=()=>{
      if(activityAppsOpen)return closeApplicationsPanel();
      activityAppsOpen=true;settingsOpen=false;closeNotificationPanel();
      root.querySelectorAll('.ai-settings-root,[data-ai-close-settings].ai-settings-backdrop').forEach(node=>node.remove());
      const workspace=root.querySelector('.ai-workspace');
      if(!workspace)return render({preserveComposer:true,preserveConversation:true,focusComposer:false});
      workspace.insertAdjacentHTML('beforeend',applicationsMarkup());
      const button=root.querySelector('[data-ai-applications]');
      button?.classList.add('selected');button?.setAttribute('aria-pressed','true');
      bindApplicationControls(workspace);
    };

    const send = async () => {
      const input = root.querySelector('[data-ai-composer]'), text = input?.value.trim();
      if (!text) return;
      if(!activeId)activeId=await aiAgent.createSession();
      const skillName=selectedSkillName;selectedSkillName='';skillCommandQuery=null;
      localError = '';liveExecution=null;liveExecutionTurnId=null;
      input.value = '';composerDraft='';followConversation=true;
      const run=aiAgent.send(activeId, text,{skillName});
      render();
      run.catch(error => { localError = friendlyError(error); render(); });
    };

    const submitInlineEdit = () => {
      const text = root.querySelector('[data-ai-inline-edit]')?.value.trim(), turnId = editingTurnId;
      if (!text || turnId === null || !activeId) return;
      editingTurnId = null; editDraft = ''; localError = '';liveExecution=null;liveExecutionTurnId=null;followConversation=true; render();
      aiAgent.editAndResend(activeId, turnId, text).catch(error => { localError = friendlyError(error); render(); });
    };

    const bindToolCards=(scope=root)=>scope.querySelectorAll('[data-tool-call]').forEach(card=>{const button=card.querySelector('[data-ai-tool-expand]');if(!button)return;button.onclick=event=>{event.stopPropagation();const expanded=card.classList.toggle('expanded');button.setAttribute('aria-expanded',String(expanded));button.title=i18n.t(expanded?'hideDetails':'showDetails')}});
    const setContextMenuOpen=open=>{contextMenuOpen=open;const wrap=root.querySelector('.ai-native-context-wrap'),selector=wrap?.querySelector('[data-ai-context-selector]'),picker=wrap?.querySelector('.ai-context-picker');selector?.setAttribute('aria-expanded',String(open));if(picker)picker.hidden=!open};
    const bindContextControls=()=>{
      const close=root.querySelector('[data-ai-close-context]');if(close)close.onclick=()=>setContextMenuOpen(false);
      root.querySelectorAll('[data-ai-context-desktop]').forEach(button=>button.onclick=()=>{contextMenuOpen=false;agentContext.focusDesktop()});
      root.querySelectorAll('[data-ai-context-window]').forEach(button=>button.onclick=()=>{const target=shell.windowManager.contextWindows().find(item=>item.id===button.dataset.aiContextWindow);contextMenuOpen=false;if(target)agentContext.focusWindow(target)});
      root.querySelectorAll('[data-ai-context-activity]').forEach(button=>button.onclick=()=>{const app=tools.registry.get(button.dataset.aiContextActivity);contextMenuOpen=false;if(app){selectActivityApp(app.id,activityTarget);focusActivityContext(app);workspaceOpen=true;workspaceView='activity';persistWorkspacePrefs();render({preserveComposer:true,preserveConversation:true,focusComposer:false})}});
      root.querySelectorAll('[data-ai-clear-context]').forEach(button=>button.onclick=()=>{contextMenuOpen=false;agentContext.clear()});
      root.querySelectorAll('[data-ai-open-context-app]').forEach(button=>button.onclick=()=>shell.open(button.dataset.aiOpenContextApp));
    };
    const replaceElement=(element,markup)=>{if(!element)return null;const template=document.createElement('template');template.innerHTML=markup.trim();const next=template.content.firstElementChild;element.replaceWith(next);return next};
    const updateContextUi=()=>{
      replaceElement(root.querySelector('.ai-native-context-wrap'),contextMarkup());
      const workspaceContext=root.querySelector('.ai-context-workspace');
      if(workspaceContext){const context=agentContext.snapshot(),windows=shell.windowManager.contextWindows(),activityApps=activityAppIds.map(id=>tools.registry.get(id)).filter(Boolean);replaceElement(workspaceContext,contextViewMarkup(context,windows,tools,i18n,activityApps))}
      bindContextControls();
    };
    const bindConversationControls=(scope=root)=>{
      scope.querySelectorAll('[data-ai-copy-turn]').forEach(button=>button.onclick=async()=>{const turn=displayedTurns.find(item=>item.id===button.dataset.aiCopyTurn),text=button.dataset.aiCopyRole==='user'?messageText(turn?.user):assistantText(turn||{responses:[]});if(text&&await clipboard.copyText(text))shell.toast(i18n.t('copiedToClipboard'))});
      scope.querySelectorAll('[data-ai-copy-error]').forEach(button=>button.onclick=async event=>{event.stopPropagation();const text=button.closest('.ai-copyable-error')?.querySelector('.ai-error-text')?.textContent||'';if(await clipboard.copyText(text))shell.toast(i18n.t('copiedToClipboard'))});
      scope.querySelectorAll('[data-ai-edit-turn]').forEach(button=>button.onclick=()=>{editingTurnId=button.dataset.aiEditTurn;editDraft=messageText(displayedTurns.find(turn=>turn.id===editingTurnId)?.user);localError='';render();requestAnimationFrame(()=>{const editor=root.querySelector('[data-ai-inline-edit]');editor?.focus();editor?.setSelectionRange(editor.value.length,editor.value.length);editor?.style.setProperty('height',`${editor.scrollHeight}px`);})});
      const cancelEdit=scope.querySelector('[data-ai-cancel-inline-edit]');if(cancelEdit)cancelEdit.onclick=()=>{editingTurnId=null;editDraft='';render()};
      const submitEdit=scope.querySelector('[data-ai-submit-inline-edit]');if(submitEdit)submitEdit.onclick=submitInlineEdit;
      const inlineEditor=scope.querySelector('[data-ai-inline-edit]');
      if(inlineEditor){inlineEditor.oninput=()=>{editDraft=inlineEditor.value;inlineEditor.style.height='auto';inlineEditor.style.height=`${inlineEditor.scrollHeight}px`};inlineEditor.onkeydown=event=>{if(event.key==='Escape'){event.preventDefault();editingTurnId=null;editDraft='';render()}else if(event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();submitInlineEdit()}}}
      scope.querySelectorAll('[data-ai-settings]').forEach(button=>button.onclick=()=>{settingsOpen=true;notificationOpen=false;render({preserveComposer:true,focusComposer:false})});
      scope.querySelectorAll('[data-ai-suggestion]').forEach(button=>button.onclick=()=>{const input=root.querySelector('[data-ai-composer]');input.value=button.dataset.aiSuggestion;input.focus()});
      bindToolCards(scope);
    };
    const syncConversation=({forceBottom=false}={})=>{
      const conversation=root.querySelector('[data-ai-conversation]');if(!conversation)return render({preserveComposer:true,focusComposer:false});
      const nearBottom=forceBottom||followConversation||nearConversationBottom(conversation),state=aiAgent.snapshot(),session=current(),configured=Boolean(aiAgent.config().apiKey);
      conversation.dataset.aiConversationSignature=conversationSignature(session);conversation.innerHTML=conversationMarkup(state,session,configured);bindConversationControls(conversation);
      bindConversationViewport(conversation);if(nearBottom){followConversation=true;scrollConversationToBottom()}
    };
    const refreshActiveAnswer=()=>{
      const session=current(),turnId=session?.activeTurnId,turn=(session?.turns||[]).find(item=>item.id===turnId);if(!turn)return;
      const answer=[...root.querySelectorAll('[data-ai-turn-answer]')].find(node=>node.dataset.aiTurnAnswer===turnId),body=answer?.querySelector('.ai-turn-response');
      if(!body)return render({preserveComposer:true,focusComposer:false});
      const conversation=root.querySelector('[data-ai-conversation]'),nearBottom=followConversation||nearConversationBottom(conversation);
      body.innerHTML=answerMarkup(turn,session);bindToolCards(body);displayedTurns=session.turns||[];
      if(nearBottom){followConversation=true;scrollConversationToBottom()}
    };
    const updateToolExecution=detail=>{
      const card=[...root.querySelectorAll('[data-tool-call]')].find(node=>node.dataset.toolCall===detail.toolCallId);if(!card)return;
      [...card.classList].filter(name=>name.startsWith('ai-tool-')&&name!=='ai-tool-call').forEach(name=>card.classList.remove(name));card.classList.add(`ai-tool-${detail.phase||'running'}`);
      const status=card.querySelector('header>em');if(status)status.textContent=i18n.t(`toolStatus_${detail.phase||'running'}`);
    };

    const appendModelEditor=host=>{if(!host)return;host.insertAdjacentHTML('beforeend',`<article class="ai-model-row" data-ai-model-row><label class="ai-model-active"><input type="radio" name="ai-active-model"><i></i></label><label><span>${i18n.t('modelId')}</span><input data-ai-model-id value="" spellcheck="false"></label><label><span>${i18n.t('displayName')}</span><input data-ai-model-name value=""></label><label><span>${i18n.t('reasoningEffort')}</span><select data-ai-model-effort>${['low','medium','high'].map(level=>`<option value="${level}" ${level==='medium'?'selected':''}>${i18n.t(`reasoning_${level}`)}</option>`).join('')}</select></label><button data-ai-remove-model title="${i18n.t('removeModel')}">${icon('delete',13)}</button></article>`);const row=host.lastElementChild;row.querySelector('[data-ai-remove-model]').onclick=()=>row.remove();row.querySelector('[data-ai-model-id]').focus()};
    const refreshSettingsPanel=()=>{
      const current=root.querySelector('.ai-settings-root');if(!current||!settingsOpen)return;
      const template=document.createElement('template');template.innerHTML=settingsMarkup();const next=template.content.querySelector('.ai-settings-root');if(!next)return;
      const currentHeader=current.querySelector(':scope > header'),nextHeader=next.querySelector(':scope > header');if(currentHeader&&nextHeader)currentHeader.replaceWith(nextHeader);
      const currentNav=current.querySelector('.ai-settings-layout > nav'),nextNav=next.querySelector('.ai-settings-layout > nav');if(currentNav&&nextNav)currentNav.replaceWith(nextNav);
      const currentMain=current.querySelector('.ai-settings-layout > main'),nextMain=next.querySelector('.ai-settings-layout > main');if(currentMain&&nextMain)currentMain.replaceWith(nextMain);
      const currentFooter=current.querySelector(':scope > footer'),nextFooter=next.querySelector(':scope > footer');if(currentFooter&&nextFooter)currentFooter.replaceWith(nextFooter);else if(currentFooter)currentFooter.remove();else if(nextFooter)current.append(nextFooter);
      bindSettingsControls(current);
    };
    const bindSettingsControls=(scope=root)=>{
      scope.querySelectorAll('[data-ai-settings-section]').forEach(button=>button.onclick=()=>{const next=button.dataset.aiSettingsSection;if(next===settingsSection)return;settingsSection=next;refreshSettingsPanel()});
      scope.querySelectorAll('[data-ai-tool-toggle]').forEach(button=>button.onclick=async()=>{const enabled=button.getAttribute('aria-pressed')!=='true';try{await aiAgent.setToolAppEnabled(button.dataset.aiToolToggle,enabled);button.setAttribute('aria-pressed',String(enabled));button.classList.toggle('enabled',enabled);button.querySelector('em').textContent=i18n.t(enabled?'registered':'notRegistered')}catch(error){localError=friendlyError(error);render({preserveComposer:true})}});
      scope.querySelectorAll('[data-ai-skill-toggle]').forEach(button=>button.onclick=()=>{const enabled=button.getAttribute('aria-pressed')!=='true';try{skillRegistry.setEnabled(button.dataset.aiSkillToggle,enabled);button.setAttribute('aria-pressed',String(enabled));button.classList.toggle('enabled',enabled)}catch(error){localError=friendlyError(error);render({preserveComposer:true})}});
      scope.querySelector('[data-ai-import-skill]')?.addEventListener('click',async()=>{const raw=await dialog.prompt({title:i18n.t('importSkill'),message:i18n.t('importSkillCopy'),placeholder:'---\nname: my-skill\ndescription: …\n---\n\n# Instructions',multiline:true,submitLabel:i18n.t('import')});if(!raw)return;try{const name=skillRegistry.install(raw);shell.toast(i18n.t('skillInstalled').replace('{name}',name));refreshSettingsPanel()}catch(error){localError=friendlyError(error);render({preserveComposer:true})}});
      scope.querySelectorAll('[data-ai-close-settings]').forEach(button => button.onclick = () => { settingsOpen = false; render({ preserveComposer: true }); });
      scope.querySelectorAll('[data-ai-reveal]').forEach(button=>button.onclick=event=>event.currentTarget.closest('.ai-secret-field').classList.toggle('revealed'));
      scope.querySelectorAll('[data-ai-provider]').forEach(provider=>{const name=provider.querySelector('[data-ai-provider-name]'),base=provider.querySelector('[data-ai-provider-base]'),summaryName=provider.querySelector('[data-ai-provider-summary-name]'),summaryBase=provider.querySelector('[data-ai-provider-summary-base]');if(name)name.oninput=()=>{if(summaryName)summaryName.textContent=name.value.trim()||i18n.t('unnamedProvider')};if(base)base.oninput=()=>{if(summaryBase)summaryBase.textContent=base.value.trim()||i18n.t('endpointNotSet')}});
      scope.querySelectorAll('[data-ai-remove-provider]').forEach(button=>button.onclick=()=>button.closest('[data-ai-provider]')?.remove());
      scope.querySelectorAll('[data-ai-remove-model]').forEach(button=>button.onclick=()=>button.closest('[data-ai-model-row]')?.remove());
      scope.querySelectorAll('[data-ai-add-model]').forEach(button=>button.onclick=()=>appendModelEditor(button.closest('[data-ai-provider]')?.querySelector('.ai-provider-models')));
      scope.querySelector('[data-ai-add-provider]')?.addEventListener('click',()=>{const host=scope.querySelector('[data-ai-provider-list]'),id=`provider-${crypto.randomUUID().slice(0,8)}`;if(!host)return;host.insertAdjacentHTML('beforeend',`<section class="ai-provider-card" data-ai-provider="${id}"><details data-ai-provider-details open><summary><span>${icon('globe',16)}</span><span><strong data-ai-provider-summary-name>${i18n.t('unnamedProvider')}</strong><small data-ai-provider-summary-base>${i18n.t('endpointNotSet')}</small></span><i>${icon('chevron',11)}</i></summary><div class="ai-provider-details"><label><span>${i18n.t('providerName')}</span><input data-ai-provider-name value="" placeholder="${i18n.t('providerName')}"></label><label><span>${i18n.t('apiBaseUrl')}</span><input data-ai-provider-base type="url" value="" spellcheck="false"></label><label><span>${i18n.t('apiKey')}</span><div class="ai-secret-field"><input data-ai-provider-key type="text" value="" spellcheck="false" autocomplete="off" data-lpignore="true"><button data-ai-reveal type="button">${icon('eye',14)}</button></div></label><div class="ai-provider-models"></div><footer><button class="ai-add-model" data-ai-add-model>${icon('plus',12)} ${i18n.t('addModel')}</button><button class="ai-remove-provider" data-ai-remove-provider>${icon('delete',12)} ${i18n.t('removeProvider')}</button></footer></div></details></section>`);const card=host.lastElementChild;bindSettingsControls(card);card.querySelector('[data-ai-provider-name]').focus()});
      scope.querySelector('[data-ai-save-settings]')?.addEventListener('click',async()=>{try{const providerNodes=[...root.querySelectorAll('[data-ai-provider]')],providers=providerNodes.map(provider=>({id:provider.dataset.aiProvider,name:provider.querySelector('[data-ai-provider-name]').value,baseUrl:provider.querySelector('[data-ai-provider-base]').value,apiKey:provider.querySelector('[data-ai-provider-key]').value,models:[...provider.querySelectorAll('[data-ai-model-row]')].map(row=>({id:row.querySelector('[data-ai-model-id]').value,name:row.querySelector('[data-ai-model-name]').value,reasoningEffort:row.querySelector('[data-ai-model-effort]').value,reasoning:true,contextWindow:128000,maxTokens:8192}))})),selected=root.querySelector('input[name="ai-active-model"]:checked')?.closest('[data-ai-model-row]'),selectedProvider=selected?.closest('[data-ai-provider]'),selectedModel=selected?.querySelector('[data-ai-model-id]')?.value,activeModelKey=selectedProvider&&selectedModel?`${selectedProvider.dataset.aiProvider}::${selectedModel}`:'',systemPrompt=root.querySelector('[data-ai-prompt]').value;await aiAgent.updateConfig({providers,activeModelKey,systemPrompt});settingsOpen=false;localError='';shell.toast(i18n.t('aiSettingsSaved'));render()}catch(error){localError=friendlyError(error);render()}});
    };

    const bind = () => {
      root.querySelectorAll('[data-ai-new]').forEach(button => button.onclick = () => { activeId = aiAgent.createSession();query='';searchOpen=false;selectedSkillName='';skillCommandQuery=null; localError = '';liveExecution=null;liveExecutionTurnId=null;workspaceSelectedId=null;lastObservedToolId=null;activityAppId=null;activityAppIds=[];activityTarget=null;followConversation=true;unmountActivitySurface();render(); });
      root.querySelectorAll('[data-ai-session]').forEach(button => { button.onclick = () => { activeId = button.dataset.aiSession;selectedSkillName='';skillCommandQuery=null; localError = '';liveExecution=null;liveExecutionTurnId=null;workspaceSelectedId=null;lastObservedToolId=null;activityAppId=null;activityAppIds=[];activityTarget=null;followConversation=true;unmountActivitySurface();render(); }; button.ondblclick = async () => { const session = aiAgent.sessionState(button.dataset.aiSession), title = await dialog.prompt({ title: i18n.t('renameChat'), value: session.title }); if (title) await aiAgent.renameSession(session.id, title); }; });
      root.querySelectorAll('[data-ai-delete]').forEach(button => button.onclick = async event => { event.stopPropagation(); const session = aiAgent.sessionState(button.dataset.aiDelete), approved = await dialog.confirm({ title: i18n.t('deleteChat'), message: i18n.t('deleteChatConfirm').replace('{name}', session.title), confirmLabel: i18n.t('delete'), danger: true }); if (!approved) return; await aiAgent.deleteSession(session.id); if (activeId === session.id) activeId = aiAgent.snapshot().sessions[0]?.id || null; render(); });
      bindConversationControls();
      const search = root.querySelector('[data-ai-search]');
      if (search) search.oninput = event => { query = event.target.value; render({ preserveComposer: true, focusSearch: true }); };
      root.querySelector('[data-ai-toggle-search]')?.addEventListener('click',()=>{searchOpen=!searchOpen;if(!searchOpen)query='';render({preserveComposer:true,focusSearch:searchOpen,focusComposer:false})});
      root.querySelector('[data-ai-notifications]')?.addEventListener('click',toggleNotificationPanel);
      bindNotificationControls();
      bindContextControls();
      root.querySelector('[data-ai-deny-approval]')?.addEventListener('click',event=>{event.currentTarget.closest('.ai-inline-approval')?.classList.add('resolving');tools.resolveApproval(event.currentTarget.dataset.aiDenyApproval,false)});
      root.querySelector('[data-ai-approve]')?.addEventListener('click',event=>{event.currentTarget.closest('.ai-inline-approval')?.classList.add('resolving');tools.resolveApproval(event.currentTarget.dataset.aiApprove,true)});
      root.querySelectorAll('[data-ai-query-choice]').forEach(button=>button.addEventListener('click',event=>{const card=event.currentTarget.closest('[data-ai-query]');if(!card)return;card.classList.add('resolving');card.querySelectorAll('button').forEach(item=>item.disabled=true);queryUser.resolve(card.dataset.aiQuery,event.currentTarget.dataset.aiQueryChoice)}));
      bindSettingsControls();
      root.querySelectorAll('[data-ai-workspace-turn]').forEach(button=>button.onclick=()=>{const target=[...root.querySelectorAll('[data-ai-turn]')].find(turn=>turn.dataset.aiTurn===button.dataset.aiWorkspaceTurn);if(!target)return;target.scrollIntoView({block:'center',behavior:document.documentElement.dataset.reduceMotion==='true'?'auto':'smooth'});target.classList.remove('workspace-linked');requestAnimationFrame(()=>target.classList.add('workspace-linked'));clearTimeout(workspaceHighlightTimer);workspaceHighlightTimer=setTimeout(()=>target.classList.remove('workspace-linked'),1500);});
      root.querySelectorAll('[data-ai-workspace-view]').forEach(button=>button.onclick=()=>{workspaceView=button.dataset.aiWorkspaceView;persistWorkspacePrefs();render({preserveComposer:true,preserveConversation:true,focusComposer:false})});
      root.querySelectorAll('[data-ai-activity-app]').forEach(button=>button.onclick=()=>{selectActivityApp(button.dataset.aiActivityApp);workspaceView='activity';persistWorkspacePrefs();render({preserveComposer:true,preserveConversation:true,focusComposer:false})});
      root.querySelectorAll('[data-ai-close-activity-app]').forEach(button=>button.onclick=event=>{event.stopPropagation();closeActivityApp(button.dataset.aiCloseActivityApp);render({preserveComposer:true,preserveConversation:true,focusComposer:false})});
      bindApplicationControls();
      root.querySelectorAll('[data-ai-open-workspace-app]').forEach(button=>button.onclick=()=>shell.open(button.dataset.aiOpenWorkspaceApp));
      root.querySelectorAll('[data-ai-open-result]').forEach(button=>button.onclick=()=>{const activity=displayedActivities.find(item=>item.id===button.dataset.aiOpenResult);if(!activity)return;shell.open(button.dataset.resultApp,button.dataset.resultPath||undefined);kernel.bus.emit('agent:open-result',{appId:activity.appId,operation:activity.operation,result:structuredClone(activity.result),params:structuredClone(activity.params),path:button.dataset.resultPath||''})});
      root.querySelectorAll('[data-ai-reveal-result]').forEach(button=>button.onclick=()=>{const activity=displayedActivities.find(item=>item.id===button.dataset.aiRevealResult),path=activity?.result?.path||activity?.params?.path;if(!path)return;const parent=path.split('/').slice(0,-1).join('/')||'/home/aeris';shell.open('files',parent)});
      root.querySelectorAll('[data-ai-copy-result]').forEach(button=>button.onclick=async()=>{const activity=displayedActivities.find(item=>item.id===button.dataset.aiCopyResult);if(!activity)return;const value=activity.result??activity.output??activity.params;if(await clipboard.copyText(typeof value==='object'?JSON.stringify(value,null,2):String(value??''))){button.innerHTML=`${icon('check',12)} ${i18n.t('copiedToClipboard')}`}});
      const setWorkspaceOpen=open=>{workspaceOpen=open;if(!open)unmountActivitySurface();persistWorkspacePrefs();render({preserveComposer:true,preserveConversation:true,focusComposer:false})};
      root.querySelector('[data-ai-toggle-workspace]')?.addEventListener('click',()=>setWorkspaceOpen(!workspaceOpen));
      root.querySelector('[data-ai-applications]')?.addEventListener('click',toggleApplicationsPanel);
      const closeWorkspace=root.querySelector('[data-ai-close-workspace]');if(closeWorkspace)closeWorkspace.onclick=()=>setWorkspaceOpen(false);
      const resizeHandle=root.querySelector('[data-ai-workspace-resize]');
      if(resizeHandle){
        let resize=null;
        const clampWidth=value=>{const host=root.querySelector('.ai-system-app'),compact=(host?.clientWidth||0)<=900,room=compact?(host?.clientWidth||MAX_WORKSPACE_WIDTH)-110:(host?.clientWidth||MAX_WORKSPACE_WIDTH)-248-340;return Math.max(MIN_WORKSPACE_WIDTH,Math.min(MAX_WORKSPACE_WIDTH,Math.max(MIN_WORKSPACE_WIDTH,room),value))};
        const applyWidth=value=>{workspaceWidth=Math.round(clampWidth(value));root.querySelector('.ai-system-app')?.style.setProperty('--agent-workspace-width',`${workspaceWidth}px`)};
        const finishResize=event=>{if(!resize)return;resize=null;root.querySelector('.ai-system-app')?.classList.remove('is-resizing-workspace');if(event&&resizeHandle.hasPointerCapture(event.pointerId))resizeHandle.releasePointerCapture(event.pointerId);persistWorkspacePrefs()};
        resizeHandle.onpointerdown=event=>{if(event.button!==0)return;resize={pointerId:event.pointerId,startX:event.clientX,startWidth:workspaceWidth};resizeHandle.setPointerCapture(event.pointerId);root.querySelector('.ai-system-app')?.classList.add('is-resizing-workspace');event.preventDefault()};
        resizeHandle.onpointermove=event=>{if(!resize||event.pointerId!==resize.pointerId)return;if(!(event.buttons&1))return finishResize(event);applyWidth(resize.startWidth-(event.clientX-resize.startX))};
        resizeHandle.onpointerup=finishResize;resizeHandle.onpointercancel=finishResize;
        resizeHandle.ondblclick=()=>{applyWidth(DEFAULT_WORKSPACE_WIDTH);persistWorkspacePrefs()};
        resizeHandle.onkeydown=event=>{if(!['ArrowLeft','ArrowRight','Home'].includes(event.key))return;event.preventDefault();applyWidth(event.key==='Home'?DEFAULT_WORKSPACE_WIDTH:workspaceWidth+(event.key==='ArrowLeft'?24:-24));persistWorkspacePrefs()};
      }
      root.querySelector('[data-ai-composer-model]')?.addEventListener('change',async event=>{const key=event.target.value;if(key==='__settings__'){settingsSection='model';settingsOpen=true;notificationOpen=false;render({preserveComposer:true,focusComposer:false});return}if(!key||key===aiAgent.config().activeModelKey)return;try{await aiAgent.updateConfig({activeModelKey:key});localError='';shell.toast(i18n.t('aiSettingsSaved'));render({preserveComposer:true,focusComposer:false})}catch(error){localError=friendlyError(error);render({preserveComposer:true})}});
      const bindSkillChoices=()=>root.querySelectorAll('[data-ai-select-skill]').forEach(button=>button.onpointerdown=event=>{event.preventDefault();chooseComposerSkill(button.dataset.aiSelectSkill)});bindSkillChoices();
      root.querySelector('[data-ai-remove-skill]')?.addEventListener('click',()=>{selectedSkillName='';syncComposerSkill();root.querySelector('[data-ai-composer]')?.focus()});
      const composer = root.querySelector('[data-ai-composer]');
      if (composer) { const showSkillCommand=()=>{const match=composer.value.match(/^\/([a-z0-9-]*)$/i);skillCommandQuery=match?match[1]:null;skillCommandIndex=0;const host=root.querySelector('[data-ai-skill-command-host]');if(host){host.innerHTML=skillCommandMarkup();bindSkillChoices()}};composer.oninput = () => { composerDraft=composer.value;showSkillCommand();composer.style.height = 'auto'; composer.style.height = `${Math.min(150, composer.scrollHeight)}px`; };composer.onfocus=showSkillCommand; composer.onblur=()=>setTimeout(()=>closeSkillCommand(),0);composer.onkeydown = event => { const skills=matchingSkills();if(skillCommandQuery!==null&&event.key==='Escape'){event.preventDefault();closeSkillCommand();return}if(skillCommandQuery!==null&&skills.length&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();skillCommandIndex=(skillCommandIndex+(event.key==='ArrowDown'?1:-1)+skills.length)%skills.length;const host=root.querySelector('[data-ai-skill-command-host]');host.innerHTML=skillCommandMarkup();bindSkillChoices();host.querySelector('.selected')?.scrollIntoView({block:'nearest'});return}if(skillCommandQuery!==null&&event.key==='Enter'&&!event.shiftKey){const selected=skills[skillCommandIndex]||skills[0];if(selected){event.preventDefault();chooseComposerSkill(selected.name);return}}if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault();if(!current()?.busy)send(); } }; }
      root.querySelector('[data-ai-send]')?.addEventListener('click', () => {if(current()?.busy){liveExecution=null;liveExecutionTurnId=null;aiAgent.abort(activeId)}else send()});
    };

    const offReady = kernel.bus.on('ai:ready', () => {
      ensureSession();
      activeId ||= aiAgent.snapshot().sessions[0]?.id || null;
      render({ preserveComposer: true, focusComposer: false });
    });
    const offChanged = kernel.bus.on('ai:changed', detail => {
      const sessions=aiAgent.snapshot().sessions,activeStillExists=activeId&&sessions.some(item=>item.id===activeId);
      if(activeId&&!activeStillExists)activeId=sessions[0]?.id||null;
      if(detail?.sessionId===activeId&&current()?.streaming)return;
      if(settingsOpen){refreshSettingsPanel();return}
      render({preserveComposer:true});
    });
    const offAgent = kernel.bus.on('ai:agent-event', detail => {
      if(detail.sessionId!==activeId||settingsOpen)return;
      const event=detail.event;
      if(event?.type==='message_update')return updateStreamingMessage();
      if(event?.type==='agent_idle'){
        // Settle the composer and sidebar once Pi has cleared its streaming
        // state. The conversation is rebuilt from the persisted turn below.
        return render({preserveComposer:true,focusComposer:true});
      }
      if(['turn_start','turn_end','tool_execution_start','tool_execution_update','tool_execution_end'].includes(event?.type))return;
      // Provider implementations differ in whether the first useful frame is
      // agent_start, message_start, message_end, or agent_end. Reconcile the
      // visible turn from service state at every lifecycle boundary instead of
      // depending on one provider-specific event order.
      syncConversation({forceBottom:event?.type==='turn_created'||event?.type==='agent_start'});
    });
    const offCapability = kernel.bus.on('capability:execution', detail => {
      const session=current();if(session?.streaming){liveExecution=detail;liveExecutionTurnId=session.activeTurnId}updateToolExecution(detail);
      if(detail?.operation!=='open'&&detail?.appId&&detail.appId!=='ai')activateApp(detail.appId,'',detail);
      // Execution phases update the workspace and approval controls, but the
      // conversation itself remains the same DOM node throughout the tool run.
      if(!settingsOpen)render({preserveComposer:true,preserveConversation:true,focusComposer:false})
    });
    const offQuery = kernel.bus.on('agent:query-user',detail=>{if(detail?.sessionId===activeId&&!settingsOpen)render({preserveComposer:true,preserveConversation:true,focusComposer:false})});
    const offNotifications = kernel.bus.on('notification:changed',refreshNotificationPanel);
    const offContext = kernel.bus.on('agent:context-changed',updateContextUi);
    const offEntry = kernel.bus.on('ai:entry',detail=>{if(!activeId||current()?.turns?.length)activeId=aiAgent.createSession();composerDraft=detail.prompt||'';settingsOpen=Boolean(detail.settings);if(detail.settings)settingsSection='model';notificationOpen=false;followConversation=true;render({focusComposer:!detail.settings});if(detail.autoSend&&composerDraft)send()});
    const offOpenApp = kernel.bus.on('agent:open-app',detail=>{activateApp(detail?.appId,detail?.path,detail);render({preserveComposer:true,preserveConversation:true,focusComposer:false})});
    const offAppBeforeUpdate = kernel.bus.on('app-runtime:before-update',({appId})=>{if(activitySurface?.appId===appId)unmountActivitySurface()});
    const offAppUpdated = kernel.bus.on('app-runtime:updated',({appId})=>{if(activityAppIds.includes(appId))render({preserveComposer:true,preserveConversation:true,focusComposer:false})});
    const offAppBeforeUninstall = kernel.bus.on('app-runtime:before-uninstall',({appId})=>{if(!activityAppIds.includes(appId))return;closeActivityApp(appId);render({preserveComposer:true,preserveConversation:true,focusComposer:false})});
    const offLocale = kernel.bus.on('settings:change', ({ key }) => { if (key === 'locale') render({ preserveComposer: true }); });
    const offSkills = kernel.bus.on('skill:changed',()=>{if(selectedSkillName&&!selectedSkill())selectedSkillName='';if(!settingsOpen&&skillCommandQuery!==null)render({preserveComposer:true,focusComposer:false})});
    const closeContextOnClick=event=>{const selector=event.target.closest('[data-ai-context-selector]');if(selector){event.preventDefault();setContextMenuOpen(selector.getAttribute('aria-expanded')!=='true');return}const active=root.querySelector('[data-ai-context-selector]');if(active?.getAttribute('aria-expanded')==='true'&&!event.target.closest('.ai-native-context-wrap'))setContextMenuOpen(false)};
    const closeContextOnEscape=event=>{const selector=root.querySelector('[data-ai-context-selector]');if(selector?.getAttribute('aria-expanded')==='true'&&event.key==='Escape'){event.stopPropagation();setContextMenuOpen(false)}};
    const closeSkillOnPointerDown=event=>{if(skillCommandQuery!==null&&!event.target.closest('[data-ai-composer],[data-ai-skill-command-host]'))closeSkillCommand()};
    root.addEventListener('click',closeContextOnClick);root.addEventListener('keydown',closeContextOnEscape,true);document.addEventListener('pointerdown',closeSkillOnPointerDown,true);
    ensureSession();render();
    return () => { unmountActivitySurface();conversationResizeObserver?.disconnect();if(streamingFrame)cancelAnimationFrame(streamingFrame);clearTimeout(workspaceHighlightTimer);root.removeEventListener('click',closeContextOnClick);root.removeEventListener('keydown',closeContextOnEscape,true);document.removeEventListener('pointerdown',closeSkillOnPointerDown,true);offReady(); offChanged(); offAgent(); offCapability(); offQuery(); offNotifications(); offContext(); offEntry(); offOpenApp();offAppBeforeUpdate();offAppUpdated();offAppBeforeUninstall();offLocale();offSkills(); };
  },
};
