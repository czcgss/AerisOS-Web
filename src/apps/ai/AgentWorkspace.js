import { icon } from '../../icons.js';

const esc = value => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const terminalText = value => String(value ?? '')
  .replace(new RegExp('\\u001b\\][^\\u0007]*(?:\\u0007|\\u001b\\\\)', 'g'), '')
  .replace(new RegExp('\\u001b\\[[0-?]*[ -/]*[@-~]', 'g'), '')
  .replace(/\r\n?/g, '\n')
  .split('')
  .filter(character => {
    const code = character.charCodeAt(0);
    return code === 9 || code === 10 || code >= 32;
  })
  .join('')
  .replace(/\n{4,}/g, '\n\n\n')
  .trimEnd();

const messageText = message => typeof message?.content === 'string'
  ? message.content
  : (message?.content || []).filter(block => block.type === 'text').map(block => block.text).join('\n');

const displayValue = value => {
  if (value === null || value === undefined || value === '') return '—';
  const rendered = typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
  return rendered.length > 1200 ? `${rendered.slice(0, 1200)}…` : rendered;
};

const resultFor = (details, output) => {
  if (details?.result !== undefined) return details.result;
  if (!output) return null;
  try { return JSON.parse(output); } catch { return output; }
};

const shortText = (value, limit = 88) => {
  const text = String(value || '').trim().replace(/\s+/g, ' ');
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
};

export function collectToolActivities(session, tools, liveExecution = null) {
  if (!session) return [];
  const activities = new Map();
  const order = [];
  const add = ({ id, name, args, resultMessage, turnId, turnStatus = 'running' }) => {
    if (!id) return;
    if (!activities.has(id)) order.push(id);
    const previous = activities.get(id) || {};
    const metadata = tools.metadata(name || previous.name) || {};
    const persisted = resultMessage?.details || {};
    const execution = tools.execution(id) || {};
    const details = { ...persisted, ...execution };
    const output = resultMessage ? messageText(resultMessage) : previous.output || '';
    let phase = details.phase || (resultMessage ? 'completed' : 'running');
    if (['running','approval'].includes(phase)) {
      if (resultMessage?.isError || turnStatus === 'failed') phase = 'failed';
      else if (turnStatus === 'stopped') phase = 'cancelled';
      else if (turnStatus === 'completed' && resultMessage) phase = 'completed';
    }
    activities.set(id, {
      ...previous,
      id,
      name: name || previous.name,
      appId: details.appId || metadata.appId || previous.appId,
      operation: details.operation || metadata.operation || previous.operation || '',
      label: details.label || metadata.label || previous.label || name,
      risk: details.risk || metadata.risk || previous.risk || 'safe',
      params: details.params || args || previous.params || {},
      phase,
      result: resultFor(details, output),
      output,
      turnId: turnId || previous.turnId,
      startedAt: details.startedAt || previous.startedAt || 0,
      finishedAt: details.finishedAt || previous.finishedAt || 0,
    });
  };

  for (const turn of session.turns || []) {
    const results = new Map((turn.responses || []).filter(message => message.role === 'toolResult').map(message => [message.toolCallId, message]));
    for (const response of turn.responses || []) {
      if (response.role === 'assistant') {
        for (const call of (response.content || []).filter?.(block => block.type === 'toolCall') || []) {
          add({ id: call.id, name: results.get(call.id)?.toolName || call.name, args: call.arguments, resultMessage: results.get(call.id), turnId: turn.id, turnStatus:turn.status });
        }
      } else if (response.role === 'toolResult' && !activities.has(response.toolCallId)) {
        add({ id: response.toolCallId, name: response.toolName, resultMessage: response, turnId: turn.id, turnStatus:turn.status });
      }
    }
    if (turn.id === session.activeTurnId && session.streamingMessage?.role === 'assistant') {
      for (const call of (session.streamingMessage.content || []).filter?.(block => block.type === 'toolCall') || []) {
        add({ id: call.id, name: call.name, args: call.arguments, turnId: turn.id });
      }
    }
  }

  if (liveExecution?.toolCallId) {
    add({ id: liveExecution.toolCallId, name: liveExecution.name, args: liveExecution.params, turnId: session.activeTurnId });
  }
  return order.map(id => activities.get(id)).filter(activity => activity.appId);
}

export const workspaceSignature = (activity, localeKey = '') => {
  const value=JSON.stringify({phase:activity?.phase,params:activity?.params,result:activity?.result,output:activity?.output,localeKey});
  let hash=2166136261;
  for(let index=0;index<value.length;index++){hash^=value.charCodeAt(index);hash=Math.imul(hash,16777619)}
  return`${activity?.id||''}:${(hash>>>0).toString(36)}`;
};

const phaseCopy = (activity, i18n) => ({
  running: i18n.t('agentWorking'),
  approval: i18n.t('agentWaitingApproval'),
  completed: i18n.t('agentFinished'),
  failed: i18n.t('agentToolFailed'),
  denied: i18n.t('agentToolDenied'),
  cancelled: i18n.t('toolStatus_cancelled'),
}[activity.phase] || i18n.t(`toolStatus_${activity.phase}`));

const phaseIcon = phase => phase === 'completed'
  ? 'check'
  : ['failed', 'denied', 'cancelled'].includes(phase)
    ? 'warning'
    : phase === 'approval' ? 'lock' : 'refresh';

const durationCopy = activity => {
  if (!activity.startedAt || !activity.finishedAt || activity.finishedAt < activity.startedAt) return '';
  const milliseconds = activity.finishedAt - activity.startedAt;
  if (milliseconds < 1000) return '<1s';
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1000)}s`;
};

const activityGroups = (session, activities) => {
  const byTurn = new Map();
  for (const activity of activities) {
    if (!byTurn.has(activity.turnId)) byTurn.set(activity.turnId, []);
    byTurn.get(activity.turnId).push(activity);
  }
  return (session?.turns || []).map(turn => ({
    id: turn.id,
    prompt: shortText(messageText(turn.user)) || '—',
    createdAt: turn.createdAt,
    activities: byTurn.get(turn.id) || [],
  })).filter(group => group.activities.length).reverse();
};

const activityHistoryMarkup = (session, activities, selectedId, tools, i18n, expanded = true) => {
  const groups = activityGroups(session, activities);
  if (!groups.length) return '';
  return `<section class="ai-activity-history ${expanded ? 'is-expanded' : 'is-collapsed'}" data-ai-activity-history>
    <header><button data-ai-toggle-activity-history aria-expanded="${expanded}" title="${esc(i18n.t(expanded ? 'collapseActivityHistory' : 'expandActivityHistory'))}"><div><strong>${esc(i18n.t('activityHistory'))}</strong><small>${esc(i18n.t('workspaceActivityCount').replace('{count}', activities.length))}</small></div>${icon('chevron', 12)}</button></header>
    <div class="ai-activity-groups">${groups.map(group => {
      const time = group.createdAt ? new Intl.DateTimeFormat(i18n.t('dateFormat'), { hour: '2-digit', minute: '2-digit' }).format(new Date(group.createdAt)) : '';
      return `<article class="ai-activity-group">
        <header><div><small>${esc(i18n.t('workspaceRequest'))}${time ? ` · ${esc(time)}` : ''}</small><strong title="${esc(group.prompt)}">${esc(group.prompt)}</strong></div><button data-ai-workspace-turn="${esc(group.id)}" title="${esc(i18n.t('locateInConversation'))}">${icon('message', 13)}</button></header>
        <div>${group.activities.map(activity => {
          const app = tools.registry.get(activity.appId);
          const duration = durationCopy(activity);
          return `<button class="ai-activity-item phase-${esc(activity.phase)} ${activity.id === selectedId ? 'selected' : ''}" data-ai-workspace-activity="${esc(activity.id)}">
            <span class="app-icon app-icon-${esc(app?.color || 'grey')}">${icon(app?.icon || 'wrench', 14)}</span>
            <span><strong>${esc(activity.label)}</strong><small>${esc(app ? i18n.t(app.title) : i18n.t('systemTool'))}${duration ? ` · ${esc(duration)}` : ''}</small></span>
            <em title="${esc(phaseCopy(activity, i18n))}">${icon(phaseIcon(activity.phase), 11)}</em>
          </button>`;
        }).join('')}</div>
      </article>`;
    }).join('')}</div>
  </section>`;
};

const rows = (values, limit = 6) => Object.entries(values || {}).slice(0, limit).map(([key, value]) => `
  <div class="agent-surface-row"><span>${esc(key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' '))}</span><strong>${esc(displayValue(value))}</strong></div>`).join('');

const calendarSurface = (activity, i18n) => {
  const value = Array.isArray(activity.result) ? activity.result[0] || {} : activity.result || activity.params;
  const start = value.start || activity.params.start;
  const date = start ? new Date(start) : new Date();
  const valid = !Number.isNaN(date.getTime());
  return `<div class="agent-calendar-surface">
    <div class="agent-calendar-date"><span>${valid ? new Intl.DateTimeFormat(i18n.t('dateFormat'), { month: 'short' }).format(date) : '—'}</span><strong>${valid ? date.getDate() : '—'}</strong></div>
    <section><small>${esc(value.calendarId || i18n.t('personal'))}</small><h3>${esc(value.title || activity.params.title || activity.label)}</h3><p>${valid ? new Intl.DateTimeFormat(i18n.t('dateFormat'), { weekday: 'long', hour: '2-digit', minute: '2-digit' }).format(date) : esc(start || '')}</p>${value.location ? `<p>${icon('location', 13)} ${esc(value.location)}</p>` : ''}</section>
  </div>`;
};

const reminderSurface = (activity, i18n) => {
  const values = Array.isArray(activity.result) ? activity.result : [activity.result || activity.params];
  return `<div class="agent-reminder-surface"><header><span>${icon('reminder', 18)}</span><strong>${i18n.t('reminders')}</strong></header>${values.slice(0, 6).map(value => `<article><i class="${value?.done ? 'done' : ''}">${value?.done ? '✓' : ''}</i><span><strong>${esc(value?.title || activity.params.title || activity.label)}</strong><small>${esc(value?.due || i18n.t('noDueDate'))}</small></span></article>`).join('')}</div>`;
};

const noteSurface = activity => {
  const value = Array.isArray(activity.result) ? activity.result[0] || {} : activity.result || activity.params;
  return `<article class="agent-note-surface"><span></span><h3>${esc(value.title || activity.params.title || activity.label)}</h3><p>${esc(value.content || activity.params.content || activity.output || '')}</p></article>`;
};

const contactSurface = activity => {
  const value = Array.isArray(activity.result) ? activity.result[0] || {} : activity.result || activity.params;
  const name = value.name || activity.params.name || activity.label;
  return `<div class="agent-contact-surface"><span>${esc(String(name).split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase())}</span><h3>${esc(name)}</h3><p>${esc(value.email || activity.params.email || '')}</p><p>${esc(value.phone || activity.params.phone || '')}</p></div>`;
};

const fileSurface = (activity, i18n) => {
  const values = Array.isArray(activity.result) ? activity.result : [];
  const path = activity.params.path || activity.result?.path || (activity.appId === 'photos' ? '/home/aeris/Pictures' : activity.appId === 'trash' ? '/home/aeris/.local/share/Trash' : '/home/aeris');
  return `<div class="agent-file-surface"><header>${icon('folder', 16)}<span>${esc(path)}</span></header><div>${values.length ? values.slice(0, 8).map(item => `<article>${icon(item.type === 'directory' ? 'folder' : 'file', 16)}<span><strong>${esc(item.name || item.path || displayValue(item))}</strong><small>${esc(item.type || '')}</small></span></article>`).join('') : `<div class="agent-file-operation">${icon(activity.operation === 'delete' ? 'delete' : activity.operation === 'read_file' || activity.operation === 'write_file' ? 'document' : 'folder', 30)}<strong>${esc(activity.label)}</strong><small>${esc(path)}</small></div>`}</div><footer>${values.length} ${i18n.t('items')}</footer></div>`;
};

const weatherSurface = (activity, i18n) => {
  const value = activity.result || {};
  const current = value.data?.current || value.current || {};
  const location = value.location?.name || activity.params.location || i18n.t('weather');
  const temperature = current.temperature_2m ?? current.temperature ?? '—';
  return `<div class="agent-weather-surface"><span>${icon('sun', 58)}</span><h3>${esc(location)}</h3><strong>${esc(temperature)}${temperature === '—' ? '' : '°'}</strong><p>${i18n.t('weatherUpdated')} ${new Intl.DateTimeFormat(i18n.t('dateFormat'), { hour: '2-digit', minute: '2-digit' }).format(new Date())}</p></div>`;
};

const terminalSurface = (activity, i18n) => {
  const result = activity.result || {};
  const command = terminalText(activity.params.command || '');
  const output = terminalText(typeof result === 'object' ? (result.output || activity.output) : (result || activity.output));
  const exitCode = typeof result === 'object' ? (result.exitCode ?? result.code) : undefined;
  const finished = ['completed', 'failed', 'denied', 'cancelled'].includes(activity.phase);
  const failed = activity.phase === 'failed' || (Number.isInteger(exitCode) && exitCode !== 0);
  return `<div class="agent-terminal-surface">
    <header><span class="agent-terminal-lights"><i></i><i></i><i></i></span><strong>Terminal</strong><small class="phase-${esc(activity.phase)}">${esc(phaseCopy(activity, i18n))}</small></header>
    <div class="agent-terminal-session" data-copyable>
      <div class="agent-terminal-command"><b>❯</b><code>${esc(command)}</code></div>
      ${output ? `<pre>${esc(output)}</pre>` : `<div class="agent-terminal-empty ${finished ? '' : 'is-running'}">${finished ? '—' : '<i></i><i></i><i></i>'}</div>`}
    </div>
    <footer><span>ash</span><span>UTF-8</span>${Number.isInteger(exitCode) ? `<strong class="${failed ? 'is-error' : ''}">exit ${exitCode}</strong>` : ''}</footer>
  </div>`;
};

const calculatorSurface = activity => {
  const value = activity.result || {};
  return `<div class="agent-calculator-surface"><small>${esc(value.expression || activity.params.expression || '')}</small><strong>${esc(value.value ?? activity.output ?? '0')}</strong><div><i></i><i></i><i></i><b>=</b></div></div>`;
};

const settingsSurface = activity => `<div class="agent-settings-surface"><span>${icon('settings', 30)}</span><section><small>${esc(activity.params.key || activity.operation)}</small><strong>${esc(activity.params.value || activity.label)}</strong></section><i class="enabled"></i></div>`;

const genericSurface = activity => `<div class="agent-generic-surface"><span>${icon('sparkles', 26)}</span><h3>${esc(activity.label)}</h3>${rows(activity.result && typeof activity.result === 'object' ? activity.result : activity.params)}${activity.output && typeof activity.result !== 'object' ? `<pre data-copyable>${esc(activity.output).slice(0, 1800)}</pre>` : ''}</div>`;

const surfaceFor = (activity, i18n) => ({
  calendar: calendarSurface,
  reminders: reminderSurface,
  notes: noteSurface,
  contacts: contactSurface,
  files: fileSurface,
  photos: fileSurface,
  trash: fileSurface,
  weather: weatherSurface,
  terminal: terminalSurface,
  calculator: calculatorSurface,
  settings: settingsSurface,
}[activity.appId]?.(activity, i18n) || genericSurface(activity, i18n));

const resourceIcon = resource => resource?.kind === 'desktop'
  ? 'desktop'
  : ['folder', 'directory', 'reminder-list'].includes(resource?.kind) ? 'folder'
    : ['file', 'note'].includes(resource?.kind) ? 'document'
      : resource?.kind?.includes('calendar') ? 'calendar'
        : resource?.kind === 'reminder' ? 'reminder' : 'maximize';

const contextViewMarkup = (context, windows, tools, i18n) => {
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
        ${windows.map(item=>`<button data-ai-context-window="${esc(item.id)}" class="${context?.windowId===item.id?'selected':''}"><span class="app-icon app-icon-${esc(item.color)}">${icon(item.icon,14)}</span><span><strong>${esc(item.title)}</strong><small>${esc(item.path||i18n.t(item.minimized?'minimizedWindow':'openWindow'))}</small></span>${context?.windowId===item.id?icon('check',11):''}</button>`).join('')}
      </div></section>
      <aside class="ai-context-scope"><span>${icon('lock',14)}</span><div><strong>${esc(i18n.t('contextScope'))}</strong><p>${esc(i18n.t('contextScopeCopy'))}</p></div></aside>
    </div>
  </section>`;
};

export function workspaceMarkup(activity, activities, tools, i18n, { animate = true, signature: suppliedSignature = '', session = null, activityExpanded = true, view = 'app', context = null, windows = [] } = {}) {
  const resizeHandle = `<div class="ai-workspace-resize" data-ai-workspace-resize role="separator" aria-orientation="vertical" aria-label="${esc(i18n.t('resizeWorkspace'))}" tabindex="0"><i></i></div>`;
  const signature=suppliedSignature||workspaceSignature(activity);
  const history=activityHistoryMarkup(session,activities,activity?.id,tools,i18n,activityExpanded);
  const countCopy=i18n.t('workspaceActivityCount').replace('{count}',activities.length);
  const app=activity?tools.registry.get(activity.appId):null;
  const detail=activity&&app?`<section class="ai-activity-detail">
    <header><span class="app-icon app-icon-${esc(app.color)}">${icon(app.icon, 16)}</span><div><strong>${esc(activity.label)}</strong><small><i class="phase-${esc(activity.phase)}"></i>${esc(phaseCopy(activity, i18n))}</small></div><button data-ai-open-workspace-app="${esc(app.id)}" title="${esc(i18n.t('openInApp'))}">${icon('maximize', 14)}</button></header>
    <div class="agent-app-window">
      <div class="agent-app-chrome"><span></span><span></span><span></span><strong>${esc(i18n.t(app.title))}</strong></div>
      <div class="agent-app-surface">${surfaceFor(activity, i18n)}</div>
      ${activity.phase === 'running' || activity.phase === 'approval' ? `<div class="agent-work-overlay"><span>${icon(activity.phase === 'approval' ? 'lock' : 'sparkles', 18)}</span><strong>${esc(phaseCopy(activity, i18n))}</strong></div>` : ''}
    </div>
    <details class="ai-activity-inspector"><summary>${esc(i18n.t('activityDetails'))}${icon('chevron', 11)}</summary><div>
      <section><small>${esc(i18n.t('toolParameters'))}</small><pre data-copyable>${esc(displayValue(activity.params))}</pre></section>
      ${activity.result != null || activity.output ? `<section><small>${esc(i18n.t('toolResult'))}</small><pre data-copyable>${esc(displayValue(activity.result ?? activity.output))}</pre></section>` : ''}
    </div></details>
  </section>`:`<section class="ai-workspace-empty-state"><span>${icon('panelRight',27)}</span><strong>${esc(i18n.t('workspaceEmptyTitle'))}</strong><p>${esc(i18n.t('workspaceEmptyCopy'))}</p></section>`;
  return `<aside class="ai-app-workspace ${activity?`ai-app-workspace-${esc(activity.phase)}`:'ai-app-workspace-empty'} ${animate?'':'ai-app-workspace-stable'}" data-ai-app-workspace data-workspace-tool-id="${esc(activity?.id||'')}" data-workspace-signature="${esc(signature||'empty')}">
    ${resizeHandle}
    <header>
      <span class="ai-workspace-brand">${icon('aerisAi', 20)}</span>
      <div><strong>${esc(i18n.t('agentWorkspace'))}</strong><small>${esc(activities.length?countCopy:i18n.t('workspaceReady'))}</small></div>
      <button data-ai-close-workspace title="${esc(i18n.t('closeWorkspace'))}">${icon('close', 15)}</button>
    </header>
    <nav class="ai-workspace-view-switch" aria-label="${esc(i18n.t('agentWorkspace'))}"><button class="${view==='app'?'selected':''}" data-ai-workspace-view="app" aria-pressed="${view==='app'}">${icon('maximize',12)} ${esc(i18n.t('workspaceAppView'))}</button><button class="${view==='context'?'selected':''}" data-ai-workspace-view="context" aria-pressed="${view==='context'}">${icon('focus',12)} ${esc(i18n.t('currentContext'))}</button></nav>
    <main class="ai-workspace-activity-layout">
      ${view==='context'?contextViewMarkup(context,windows,tools,i18n):detail}
      ${history}
    </main>
    <footer><span>${icon(view==='context'?'lock':'aerisAi',14)} ${esc(i18n.t(view==='context'?'contextManagedByAeris':'agentWorkspace'))}</span>${view==='app'&&app?`<button data-ai-open-workspace-app="${esc(app.id)}">${esc(i18n.t('openInApp'))} ${icon('chevron',12)}</button>`:''}</footer>
  </aside>`;
}
