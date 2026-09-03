import { icon } from '../../icons.js';

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const displayValue = value => {
  if (value === null || value === undefined || value === '') return '—';
  const rendered = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  return rendered.length > 1200 ? `${rendered.slice(0, 1200)}…` : rendered;
};

const shortText = (value, limit = 88) => {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
};

const durationCopy = activity => {
  if (!activity.startedAt || !activity.finishedAt || activity.finishedAt < activity.startedAt) return '';
  const milliseconds = activity.finishedAt - activity.startedAt;
  if (milliseconds < 1000) return '<1s';
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1000)}s`;
};

const rows = (values, limit = 6) => Object.entries(values || {}).slice(0, limit).map(([key, value]) => `
  <div class="agent-surface-row"><span>${esc(key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' '))}</span><strong>${esc(displayValue(value))}</strong></div>`).join('');

const resourceIcon = resource => resource?.kind === 'desktop'
  ? 'desktop'
  : ['folder', 'directory', 'reminder-list'].includes(resource?.kind) ? 'folder'
    : ['file', 'note'].includes(resource?.kind) ? 'document'
      : resource?.kind?.includes('calendar') ? 'calendar'
        : resource?.kind === 'reminder' ? 'reminder' : 'maximize';

export const contextViewMarkup = (context, windows, tools, i18n, activityApps = []) => {
  const app=context?.appId?tools.registry.get(context.appId):null,resource=context?.resource||null,selection=context?.selection||null;
  const label=resource?.name||resource?.path||resource?.date||context?.label||i18n.t('desktop');
  const metadata=resource?.metadata&&typeof resource.metadata==='object'?Object.fromEntries(Object.entries(resource.metadata).filter(([key,value])=>key!=='content'&&value!==''&&value!==null&&value!==undefined)):{};
  const documentContent=resource?.metadata?.content||'';
  const selectionItems=selection?.items||[];
  return `<section class="ai-context-workspace">
    <header><div><strong>${esc(i18n.t('currentContext'))}</strong><small>${esc(i18n.t('contextWorkspaceCopy'))}</small></div>${context?`<button data-ai-clear-context>${esc(i18n.t('clearContext'))}</button>`:''}</header>
    <div class="ai-context-workspace-scroll">
      ${context?`<article class="ai-context-primary">
        <span class="app-icon app-icon-${esc(app?.color||'blue')}">${icon(app?.icon||resourceIcon(resource),19)}</span>
        <div><small>${esc(app?i18n.t(app.title):i18n.t(resource?.kind==='desktop'?'desktop':'systemContext'))}</small><strong>${esc(label)}</strong>${resource?.path?`<code data-copyable>${esc(resource.path)}</code>`:''}${resource?.date?`<time>${esc(resource.date)}</time>`:''}</div>
        ${app?`<button data-ai-open-context-app="${esc(app.id)}" title="${esc(i18n.t('openInApp'))}">${icon('maximize',13)}</button>`:''}
      </article>`:`<article class="ai-context-empty"><span>${icon('focus',24)}</span><strong>${esc(i18n.t('noContextTitle'))}</strong><p>${esc(i18n.t('noContextCopy'))}</p></article>`}
      ${selection?.text?`<section class="ai-context-selection"><header><span>${icon('textedit',13)}</span><strong>${esc(i18n.t('selectedText'))}</strong></header><blockquote data-copyable>${esc(selection.text)}</blockquote></section>`:''}
      ${selectionItems.length?`<section class="ai-context-items"><header><strong>${esc(i18n.t('selectedItemsContext').replace('{count}',selectionItems.length))}</strong></header><div>${selectionItems.map(item=>`<article><span>${icon(resourceIcon(item),13)}</span><div><strong>${esc(item.name||item.path||item.id)}</strong>${item.path?`<small>${esc(item.path)}</small>`:''}</div></article>`).join('')}</div></section>`:''}
      ${documentContent?`<details class="ai-context-content"><summary>${esc(i18n.t('contextDocumentContent'))}${icon('chevron',10)}</summary><pre data-copyable>${esc(documentContent)}</pre></details>`:''}
      ${Object.keys(metadata).length?`<details class="ai-context-content"><summary>${esc(i18n.t('contextResourceDetails'))}${icon('chevron',10)}</summary><div>${rows(metadata,10)}</div></details>`:''}
      <section class="ai-context-choices"><header><strong>${esc(i18n.t('availableContext'))}</strong><small>${esc(i18n.t('availableContextCopy'))}</small></header><div>
        <button data-ai-context-desktop class="${resource?.kind==='desktop'?'selected':''}"><span class="app-icon app-icon-blue">${icon('desktop',14)}</span><span><strong>${esc(i18n.t('desktop'))}</strong><small>${esc(i18n.t('desktopContext'))}</small></span>${resource?.kind==='desktop'?icon('check',11):''}</button>
        ${windows.map(item=>`<button data-ai-context-window="${esc(item.id)}" class="${context?.windowId===item.id?'selected':''}"><span class="app-icon app-icon-${esc(item.color)}">${icon(item.icon,14)}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.resourceLabel||item.path||i18n.t(item.minimized?'minimizedWindow':'openWindow'))}</small></span>${context?.windowId===item.id?icon('check',11):''}</button>`).join('')}
        ${activityApps.map(app=>`<button data-ai-context-activity="${esc(app.id)}" class="${context?.appId===app.id&&context?.resource?.kind==='application-view'?'selected':''}"><span class="app-icon app-icon-${esc(app.color||'grey')}">${icon(app.icon,14)}</span><span><strong>${esc(i18n.t(app.title))}</strong><small>${esc(i18n.t('activityCompactView'))}</small></span>${context?.appId===app.id&&context?.resource?.kind==='application-view'?icon('check',11):''}</button>`).join('')}
      </div></section>
      <aside class="ai-context-scope"><span>${icon('lock',14)}</span><div><strong>${esc(i18n.t('contextScope'))}</strong><p>${esc(i18n.t('contextScopeCopy'))}</p></div></aside>
    </div>
  </section>`;
};

const activityViewMarkup = (apps, activeAppId, i18n) => {
  const active=apps.find(app=>app.id===activeAppId)||null;
  return `<section class="ai-live-activity" data-ai-live-activity data-activity-app-id="${esc(active?.id||'')}">
    ${apps.length?`<nav class="ai-activity-window-list" aria-label="${esc(i18n.t('activeApps'))}">${apps.map(app=>`<div class="ai-activity-window-item ${app.id===active?.id?'selected':''}"><button data-ai-activity-app="${esc(app.id)}" title="${esc(i18n.t(app.title))}"><span class="app-icon app-icon-${esc(app.color||'grey')}">${icon(app.icon,14)}</span><span>${esc(i18n.t(app.title))}</span><i></i></button><button data-ai-close-activity-app="${esc(app.id)}" aria-label="${esc(i18n.t('close'))}" title="${esc(i18n.t('close'))}">${icon('close',9)}</button></div>`).join('')}</nav>`:''}
    <div class="ai-activity-stage ${active?'has-window':''}" data-ai-activity-host>
      ${active?'':`<div class="ai-activity-empty"><span>${icon('maximize',26)}</span><strong>${esc(i18n.t('noActiveAppTitle'))}</strong><p>${esc(i18n.t('noActiveAppCopy'))}</p></div>`}
    </div>
  </section>`;
};

const workflowViewMarkup=(workflows,tools,i18n,expandedWorkflowIds)=>{
  if(!workflows.length)return`<section class="ai-workflow-empty"><span>${icon('list',28)}</span><strong>${esc(i18n.t('noAgentWorkflow'))}</strong><p>${esc(i18n.t('noAgentWorkflowCopy'))}</p></section>`;
  const renderTool=tool=>{
    const metadata=tools.metadata(tool.name)||{},app=tools.registry.get(metadata.appId),phase=tool.phase||'completed',duration=durationCopy(tool),hasDetails=Boolean(tool.args||tool.output||tool.error);
    return `<details class="ai-workflow-tool phase-${esc(phase)}" ${['running','approval'].includes(phase)?'open':''}><summary><span class="app-icon app-icon-${esc(app?.color||'grey')}">${icon(app?.icon||'wrench',12)}</span><strong>${esc(metadata.label||tool.name)}</strong><em>${esc(i18n.t(`toolStatus_${phase}`))}${duration?` · ${esc(duration)}`:''}</em>${hasDetails?`<i>${icon('chevron',9)}</i>`:''}</summary>${hasDetails?`<div>${tool.args?`<section><small>${esc(i18n.t('toolParameters'))}</small><pre data-copyable>${esc(tool.args)}</pre></section>`:''}${tool.output?`<section><small>${esc(i18n.t('toolResult'))}</small><pre data-copyable>${esc(tool.output)}</pre></section>`:''}</div>`:''}</details>`;
  };
  const workflowTree=workflow=>{
    const nodes=workflow.nodes||[],children=new Map();for(const node of nodes){const list=children.get(node.parentId)||[];list.push(node);children.set(node.parentId,list)}
    const renderNode=(node,level=0)=>`<article class="ai-workflow-node workflow-status-${esc(node.status)}" style="--agent-depth:${level}">
      <div class="ai-workflow-rail"><i></i></div><span class="app-icon app-icon-${node.agentId==='main'?'ai':esc(node.color||'blue')}">${icon(node.agentId==='main'?'agentMain':node.icon||'agentGeneral',16)}</span>
      <div><header><strong>${esc(node.agentName)}</strong><em>${esc(i18n.t(`agentStatus_${node.phase||node.status}`))}</em></header><p>${esc(node.task)}</p>${node.tools?.length?`<div class="ai-workflow-tools">${node.tools.map(renderTool).join('')}</div>`:node.currentTool?`<small>${icon('wrench',10)} ${esc(node.currentTool)}</small>`:''}${node.error?`<small class="error">${esc(node.error)}</small>`:''}<div class="ai-workflow-node-progress"><i style="width:${Math.max(0,Math.min(100,node.progress||0))}%"></i></div></div>
    </article>${(children.get(node.id)||[]).map(child=>renderNode(child,level+1)).join('')}`;
    const root=nodes.find(node=>!node.parentId)||nodes[0];
    return root?renderNode(root):'';
  };
  return`<section class="ai-workflow-view ai-workflow-history"><header><div><strong>${esc(i18n.t('workflowHistory'))}</strong><small>${esc(i18n.t('workflowHistoryCount').replace('{count}',workflows.length))}</small></div></header><div class="ai-workflow-records">${workflows.map(workflow=>`<details class="ai-workflow-record" data-ai-workflow-record="${esc(workflow.id)}" ${expandedWorkflowIds.has(workflow.id)?'open':''}><summary><span>${icon('message',13)}</span><div><small>${esc(i18n.t('userRequest'))}</small><strong>${esc(shortText(workflow.task,120))}</strong></div><em class="workflow-status-${esc(workflow.status)}">${esc(i18n.t(`agentStatus_${workflow.status}`))} · ${Math.max(0,Math.min(100,workflow.progress||0))}%</em><i>${icon('chevron',10)}</i></summary><div class="ai-workflow-record-body"><div class="ai-workflow-progress"><i style="width:${Math.max(0,Math.min(100,workflow.progress||0))}%"></i></div><div class="ai-workflow-tree">${workflowTree(workflow)}</div></div></details>`).join('')}</div></section>`;
};

const workspaceViews=[['workflow','list','agentWorkflow'],['tasks','history','taskCenter'],['activity','maximize','workspaceActivity'],['context','focus','workspaceContextView']];

export function workspacePickerMarkup(i18n,{view='activity',menuOpen=false,workspaceOpen=false,runningTasks=0}={}){
  return `<nav class="ai-toolbar-workspace-picker ${menuOpen?'open':''}" data-ai-workspace-picker aria-label="${esc(i18n.t('agentWorkspace'))}">
    <button class="ai-workspace-toggle ${workspaceOpen?'selected':''} ${runningTasks?'has-running':''}" data-ai-workspace-view-menu aria-expanded="${menuOpen}" title="${esc(i18n.t('agentWorkspace'))}">${icon('layers',17)}<i ${runningTasks?'':'hidden'}>${runningTasks||''}</i></button>
    <div class="ai-workspace-view-menu">${workspaceViews.map(([value,viewIcon,label])=>`<button class="${workspaceOpen&&view===value?'selected':''}" data-ai-workspace-view="${value}" aria-pressed="${workspaceOpen&&view===value}">${icon(viewIcon,12)}<span>${esc(i18n.t(label))}</span>${workspaceOpen&&view===value?icon('check',10):''}</button>`).join('')}</div>
  </nav>`;
}

export function workspaceMarkup(tools, i18n, { animate = true, signature = '', view = 'activity', context = null, windows = [], activityApps = [], activityAppId = '', workflows = [], expandedWorkflowIds = new Set(), taskMarkup = '' } = {}) {
  const resizeHandle = `<div class="ai-workspace-resize" data-ai-workspace-resize role="separator" aria-orientation="vertical" aria-label="${esc(i18n.t('resizeWorkspace'))}" tabindex="0"><i></i></div>`;
  return `<aside class="ai-app-workspace ai-app-workspace-empty ${animate?'':'ai-app-workspace-stable'}" data-ai-app-workspace data-workspace-signature="${esc(signature||'empty')}">
    ${resizeHandle}
    <button class="ai-workspace-close" data-ai-close-workspace title="${esc(i18n.t('closeWorkspace'))}" aria-label="${esc(i18n.t('closeWorkspace'))}">${icon('close',14)}</button>
    <main class="ai-workspace-content-layout">
      ${view==='workflow'?workflowViewMarkup(workflows,tools,i18n,expandedWorkflowIds):view==='tasks'?taskMarkup:view==='context'?contextViewMarkup(context,windows,tools,i18n,activityApps):activityViewMarkup(activityApps,activityAppId,i18n)}
    </main>
  </aside>`;
}
