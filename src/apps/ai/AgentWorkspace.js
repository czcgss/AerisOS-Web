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
  const value=JSON.stringify({phase:activity?.phase,params:activity?.params,result:activity?.result,output:activity?.output});
  let hash=2166136261;
  for(let index=0;index<value.length;index++){hash^=value.charCodeAt(index);hash=Math.imul(hash,16777619)}
  return`${activity?.id||''}:${(hash>>>0).toString(36)}:${localeKey}`;
};

const phaseCopy = (activity, i18n) => ({
  running: i18n.t('agentWorking'),
  approval: i18n.t('agentWaitingApproval'),
  completed: i18n.t('agentFinished'),
  failed: i18n.t('agentToolFailed'),
  denied: i18n.t('agentToolDenied'),
  cancelled: i18n.t('toolStatus_cancelled'),
}[activity.phase] || i18n.t(`toolStatus_${activity.phase}`));

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

export function workspaceMarkup(activity, activities, tools, i18n, { animate = true, signature: suppliedSignature = '' } = {}) {
  const resizeHandle = `<div class="ai-workspace-resize" data-ai-workspace-resize role="separator" aria-orientation="vertical" aria-label="${esc(i18n.t('resizeWorkspace'))}" tabindex="0"><i></i></div>`;
  if (!activity) return `<aside class="ai-app-workspace ai-app-workspace-empty ${animate ? '' : 'ai-app-workspace-stable'}" data-ai-app-workspace data-workspace-tool-id="" data-workspace-signature="${esc(suppliedSignature || 'empty')}">
    ${resizeHandle}
    <header>
      <span class="ai-workspace-brand">${icon('aerisAi', 20)}</span>
      <div><strong>${esc(i18n.t('agentWorkspace'))}</strong><small>${esc(i18n.t('workspaceReady'))}</small></div>
      <button data-ai-close-workspace title="${esc(i18n.t('closeWorkspace'))}">${icon('close', 15)}</button>
    </header>
    <main class="ai-workspace-empty-state">
      <span>${icon('panelRight', 27)}</span>
      <strong>${esc(i18n.t('workspaceEmptyTitle'))}</strong>
      <p>${esc(i18n.t('workspaceEmptyCopy'))}</p>
    </main>
    <footer><span>${icon('aerisAi', 14)} ${esc(i18n.t('agentWorkspace'))}</span></footer>
  </aside>`;
  const app = tools.registry.get(activity.appId);
  if (!app) return '';
  const recent = activities.filter(item => item.turnId === activity.turnId).slice(-4);
  const signature=suppliedSignature||workspaceSignature(activity);
  return `<aside class="ai-app-workspace ai-app-workspace-${esc(activity.phase)} ${animate?'':'ai-app-workspace-stable'}" data-ai-app-workspace data-workspace-tool-id="${esc(activity.id)}" data-workspace-signature="${esc(signature)}">
    ${resizeHandle}
    <header>
      <span class="app-icon app-icon-${esc(app.color)}">${icon(app.icon, 21)}</span>
      <div><strong>${esc(i18n.t(app.title))}</strong><small><i></i>${esc(phaseCopy(activity, i18n))}</small></div>
      <button data-ai-open-workspace-app="${esc(app.id)}" title="${esc(i18n.t('openInApp'))}">${icon('maximize', 15)}</button>
      <button data-ai-close-workspace title="${esc(i18n.t('closeWorkspace'))}">${icon('close', 15)}</button>
    </header>
    ${recent.length > 1 ? `<nav>${recent.map(item => { const itemApp = tools.registry.get(item.appId); return `<button class="${item.id === activity.id ? 'selected' : ''}" data-ai-workspace-tool="${esc(item.id)}" title="${esc(itemApp ? i18n.t(itemApp.title) : item.label)}"><span class="app-icon app-icon-${esc(itemApp?.color || 'grey')}">${icon(itemApp?.icon || 'wrench', 14)}</span><i class="phase-${esc(item.phase)}"></i></button>`; }).join('')}</nav>` : ''}
    <main>
      <div class="agent-app-window">
        <div class="agent-app-chrome"><span></span><span></span><span></span><strong>${esc(i18n.t(app.title))}</strong></div>
        <div class="agent-app-surface">${surfaceFor(activity, i18n)}</div>
        ${activity.phase === 'running' || activity.phase === 'approval' ? `<div class="agent-work-overlay"><span>${icon(activity.phase === 'approval' ? 'lock' : 'sparkles', 18)}</span><strong>${esc(phaseCopy(activity, i18n))}</strong></div>` : ''}
      </div>
    </main>
    <footer><span>${icon('aerisAi', 14)} ${esc(i18n.t('agentWorkspace'))}</span><button data-ai-open-workspace-app="${esc(app.id)}">${esc(i18n.t('openInApp'))} ${icon('chevron', 12)}</button></footer>
  </aside>`;
}
