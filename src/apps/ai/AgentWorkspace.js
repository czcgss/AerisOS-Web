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

const durationCopy = activity => {
  if (!activity.startedAt || !activity.finishedAt || activity.finishedAt < activity.startedAt) return '';
  const milliseconds = activity.finishedAt - activity.startedAt;
  if (milliseconds < 1000) return '<1s';
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(milliseconds / 60_000)}m ${Math.round((milliseconds % 60_000) / 1000)}s`;
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

export const contextViewMarkup = (context, windows, tools, i18n) => {
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

const resultValue = activity => Array.isArray(activity.result) ? activity.result : [activity.result].filter(value => value !== null && value !== undefined);
const resultPath = activity => activity.result?.path || activity.params?.path || '';
const resultTitle = (activity, i18n) => {
  const value=resultValue(activity)[0]||{},count=Array.isArray(activity.result)?activity.result.length:0;
  if(Array.isArray(activity.result)&&count!==1)return i18n.t('resultItemCount').replace('{count}',count);
  if(activity.appId==='weather')return value.location?.name||activity.params.location||i18n.t('weather');
  if(activity.appId==='terminal')return activity.params.command||activity.label;
  if(activity.appId==='calculator')return value.expression||activity.params.expression||activity.label;
  if(activity.appId==='settings')return i18n.t('settingChanged').replace('{name}',value.key||activity.params.key||'');
  if(['files','textedit','preview'].includes(activity.appId)){const path=activity.operation==='delete'?activity.params.path:value.path||activity.params.path;return path?.split('/').filter(Boolean).at(-1)||activity.label}
  return value.title||value.name||value.path||activity.params.title||activity.label;
};
const resultSummary = (activity, i18n) => {
  const value=resultValue(activity)[0]||{},values=resultValue(activity);
  if(Array.isArray(activity.result))return values.slice(0,3).map(item=>item?.title||item?.name||item?.path||displayValue(item)).join(' · ')||i18n.t('emptyResult');
  if(activity.appId==='calendar')return [value.start,value.location].filter(Boolean).join(' · ');
  if(activity.appId==='reminders')return [value.due,value.dueTime].filter(Boolean).join(' · ')||i18n.t(value.done?'completed':'noDueDate');
  if(activity.appId==='notes')return shortText(value.content||activity.params.content,150);
  if(activity.appId==='contacts')return [value.email,value.phone].filter(Boolean).join(' · ');
  if(activity.appId==='files')return activity.operation==='read_file'?shortText(value.content,180):value.bytes?i18n.t('resultBytes').replace('{count}',value.bytes):'';
  if(activity.appId==='preview')return shortText(value.content,180);
  if(['textedit','trash'].includes(activity.appId))return '';
  if(activity.appId==='weather'){const current=value.data?.current||value.current||{};return [current.temperature_2m??current.temperature,current.wind_speed_10m??current.windSpeed].filter(item=>item!==undefined).join(' · ')}
  if(activity.appId==='terminal')return shortText(value.output||activity.output,180)||i18n.t('commandCompleted');
  if(activity.appId==='calculator')return String(value.value??activity.output??'');
  return shortText(typeof activity.result==='object'?displayValue(activity.result):activity.result||activity.output,180);
};
const resultIcon = activity => ({calendar:'calendar',reminders:'reminder',notes:'note',contacts:'contacts',files:'folder',textedit:'document',preview:'preview',photos:'image',trash:'delete',weather:'sun',terminal:'terminal',calculator:'calc',settings:'settings'}[activity.appId]||'sparkles');
const resultOperationKind = operation => ({app_capability:'used',create:'created',create_event:'created',create_folder:'created',create_document:'created',write_file:'written',delete:'deleted',delete_event:'deleted',empty:'emptied',list:'listed',list_events:'listed',list_volumes:'inspected',read_file:'read',read_text:'read',read_metrics:'inspected',current:'checked',current_time:'checked',copy:'copied',move:'moved',rename:'renamed',complete:'completed',search:'searched',update:'updated',run_command:'executed',restart:'restarted',calculate:'calculated'}[operation]||'completed');
const resultOperationIcon = kind => ({used:'wrench',created:'plus',written:'document',deleted:'delete',emptied:'delete',listed:'list',read:'eye',inspected:'info',checked:'check',copied:'copy',moved:'upload',renamed:'textedit',completed:'check',searched:'search',updated:'settings',executed:'terminal',restarted:'refresh',calculated:'calc'}[kind]||'check');
const resultOperationCopy = (activity, i18n) => i18n.t(`resultOperation_${resultOperationKind(activity.operation)}`);
const resultTone = activity => ['deleted','emptied'].includes(resultOperationKind(activity.operation))?'removed':['created','written','copied'].includes(resultOperationKind(activity.operation))?'created':'neutral';
const resultBoolean = (value, i18n) => i18n.t(value?'resultYes':'resultNo');
const resultFacts = (activity, i18n) => {
  const params=activity.params||{},raw=activity.result,value=resultValue(activity)[0]||{},facts=[],add=(label,item)=>{if(item!==''&&item!==null&&item!==undefined)facts.push({label:i18n.t(label),value:String(item)})},count=Array.isArray(raw)?raw.length:null;
  if(count!==null)add('resultFieldItems',count);
  if(activity.appId==='calendar'){
    if(params.date)add('date',params.date);
    if(!Array.isArray(raw)){add('resultFieldStart',value.start||params.start);add('resultFieldEnd',value.end||params.end);add('resultFieldCalendar',value.calendarId||params.calendarId);add('location',value.location||params.location);add('resultFieldAlert',value.alert||params.alert);if(value.allDay||params.allDay)add('resultFieldAllDay',resultBoolean(true,i18n))}
  }else if(activity.appId==='reminders'){
    if(Array.isArray(raw))add('resultFieldIncludeCompleted',resultBoolean(!!params.includeCompleted,i18n));
    else{const due=value.due||params.due||'';add('dueDate',due||i18n.t('noDueDate'));add('time',value.dueTime||params.dueTime);add('resultFieldState',i18n.t(value.done?'completed':'resultStateActive'));add('priority',resultBoolean(!!(value.priority??params.priority),i18n));if(due)add('notifications',resultBoolean((value.notify??params.notify)!==false,i18n))}
  }else if(activity.appId==='notes'){
    add('resultFieldQuery',params.query);if(!Array.isArray(raw)){add('pinned',resultBoolean(!!(value.pinned??params.pinned),i18n));if(value.updatedAt)add('updated',new Intl.DateTimeFormat(i18n.t('dateFormat'),{dateStyle:'medium',timeStyle:'short'}).format(new Date(value.updatedAt)))}
  }else if(activity.appId==='contacts'){
    add('resultFieldQuery',params.query);if(!Array.isArray(raw)){add('email',value.email||params.email);add('phone',value.phone||params.phone)}
  }else if(activity.appId==='files'){
    if(activity.operation==='rename'){add('resultFieldSource',params.path);add('resultFieldName',params.name);add('resultFieldResultPath',value.path)}
    else if(activity.operation==='move'){add('resultFieldSource',params.path);add('resultFieldDestination',params.destination);add('resultFieldResultPath',value.path)}
    else if(activity.operation==='copy'){add('resultFieldSource',params.path);add('resultFieldResultPath',value.path)}
    else if(activity.operation==='delete'){add('resultFieldSource',params.path);add('resultFieldTrashPath',value.path)}
    else{add('resultFieldPath',value.path||params.path);add('resultFieldBytes',value.bytes);if(activity.operation==='read_file')add('resultFieldTruncated',resultBoolean(!!value.truncated,i18n))}
  }else if(activity.appId==='textedit'){add('resultFieldPath',value.path||params.path);add('resultFieldCharacters',String(params.content||'').length)}
  else if(activity.appId==='preview'){add('resultFieldPath',value.path||params.path);add('resultFieldTruncated',resultBoolean(!!value.truncated,i18n))}
  else if(activity.appId==='photos'){add('resultFieldLibrary','/home/aeris/Pictures')}
  else if(activity.appId==='weather'){
    const data=value.data||value,current=data?.current||value.current||{},units=data?.current_units||{};add('location',[value.location?.name,value.location?.admin1,value.location?.country].filter(Boolean).join(', ')||params.location);add('resultFieldTemperature',current.temperature_2m!==undefined?`${current.temperature_2m}${units.temperature_2m||'°C'}`:current.temperature);add('resultFieldFeelsLike',current.apparent_temperature!==undefined?`${current.apparent_temperature}${units.apparent_temperature||'°C'}`:null);add('resultFieldHumidity',current.relative_humidity_2m!==undefined?`${current.relative_humidity_2m}${units.relative_humidity_2m||'%'}`:null);add('resultFieldWind',current.wind_speed_10m!==undefined?`${current.wind_speed_10m} ${units.wind_speed_10m||'km/h'}`:current.windSpeed)
  }else if(activity.appId==='terminal'){add('resultFieldExitCode',value.exitCode);add('resultFieldCommand',params.command)}
  else if(activity.appId==='calculator'){add('resultFieldExpression',value.expression||params.expression);add('toolResult',value.value)}
  else if(activity.appId==='settings'){add('resultFieldSetting',value.key||params.key);add('resultFieldValue',value.value??params.value)}
  else if(activity.appId==='clock'){add('time',value.local);add('timezone',value.timezone)}
  else if(activity.appId==='monitor'){add('resultFieldMemory',value.percent!==undefined?`${value.percent}%`:null);add('resultFieldLoad',value.loadAverage);if(value.uptimeSeconds!==undefined)add('resultFieldUptime',i18n.t('resultMinutes').replace('{count}',Math.floor(value.uptimeSeconds/60)))}
  else if(activity.appId==='diskutility'){add('resultFieldScope',i18n.t('resultMountedVolumes'))}
  else if(activity.appId==='machine'){add('resultFieldState',value.restarted?i18n.t('resultStateRestarting'):phaseCopy(activity,i18n))}
  else if(activity.appId==='trash'){add('resultFieldState',value.emptied?i18n.t('resultStateTrashEmptied'):phaseCopy(activity,i18n))}
  if(!facts.length)for(const [key,item] of Object.entries(params).slice(0,4))if(item!==''&&item!==null&&item!==undefined)facts.push({label:key.replace(/([A-Z])/g,' $1').replace(/_/g,' '),value:displayValue(item)});
  return facts.slice(0,6);
};
const resultFactsMarkup = (activity, i18n, limit = 6) => {
  const facts=resultFacts(activity,i18n).slice(0,limit);if(!facts.length)return'';
  return `<dl class="ai-result-facts">${facts.map(fact=>`<div><dt>${esc(fact.label)}</dt><dd title="${esc(fact.value)}" data-copyable>${esc(fact.value)}</dd></div>`).join('')}</dl>`;
};
const resultBodyMarkup = (activity, i18n) => {
  const value=resultValue(activity)[0]||{},summary=resultSummary(activity,i18n),path=resultPath(activity);
  if(Array.isArray(activity.result))return `<div class="ai-result-summary">${icon('list',14)}<p data-copyable>${esc(summary)}</p></div>`;
  if(activity.appId==='calendar'){
    const date=new Date(value.start||activity.params.start||''),valid=!Number.isNaN(date.getTime());
    return `<div class="ai-result-calendar"><time><small>${valid?esc(new Intl.DateTimeFormat(i18n.t('dateFormat'),{month:'short'}).format(date)):'—'}</small><strong>${valid?date.getDate():'—'}</strong></time><div><strong>${esc(value.title||activity.params.title||activity.label)}</strong><small>${esc(summary)}</small></div></div>`;
  }
  if(activity.appId==='reminders')return `<div class="ai-result-reminder"><i class="${value.done?'done':''}">${value.done?icon('check',10):''}</i><div><strong>${esc(value.title||activity.params.title||activity.label)}</strong><small>${esc(summary)}</small></div></div>`;
  if(activity.appId==='notes')return `<div class="ai-result-note"><i></i><p data-copyable>${esc(summary||i18n.t('emptyNote'))}</p></div>`;
  if(activity.appId==='contacts'){const name=value.name||activity.params.name||activity.label;return `<div class="ai-result-contact"><span>${esc(String(name).split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase())}</span><div><strong>${esc(name)}</strong><small>${esc(summary)}</small></div></div>`}
  if(activity.appId==='weather'){
    const current=value.data?.current||value.current||{},temperature=current.temperature_2m??current.temperature??'—';
    return `<div class="ai-result-weather">${icon('sun',25)}<div><strong>${esc(temperature)}${temperature==='—'?'':'°'}</strong><small>${esc(value.location?.name||activity.params.location||i18n.t('weather'))}</small></div></div>`;
  }
  if(activity.appId==='terminal')return `<div class="ai-result-terminal"><code>❯ ${esc(activity.params.command||'')}</code>${summary?`<pre data-copyable>${esc(summary)}</pre>`:''}</div>`;
  if(activity.appId==='calculator')return `<div class="ai-result-calculation"><small>${esc(value.expression||activity.params.expression||'')}</small><strong>${esc(value.value??activity.output??'')}</strong></div>`;
  if(path)return `<div class="ai-result-file"><span>${icon(activity.operation==='create_folder'?'folder':'document',19)}</span><div><strong>${esc(path.split('/').filter(Boolean).at(-1)||path)}</strong>${summary?`<small>${esc(summary)}</small>`:''}<code data-copyable>${esc(path)}</code></div></div>`;
  return summary?`<div class="ai-result-summary">${icon(resultIcon(activity),14)}<p data-copyable>${esc(summary)}</p></div>`:'';
};
const resultOpenTarget = activity => {
  const path=resultPath(activity);
  if(activity.appId==='textedit')return{appId:'textedit',path};
  if(activity.appId==='preview')return{appId:'preview',path};
  if(activity.appId==='files'&&activity.operation==='delete')return{appId:'trash',path:''};
  if(activity.appId==='files'&&['read_file','write_file'].includes(activity.operation))return{appId:/\.(png|jpe?g|gif|webp|svg|pdf)$/i.test(path)?'preview':'textedit',path};
  if(activity.appId==='files')return{appId:'files',path:activity.operation==='create_folder'?path:path.split('/').slice(0,-1).join('/')||'/home/aeris'};
  if(activity.appId==='trash')return{appId:'trash',path:''};
  return{appId:activity.appId,path:''};
};

const resultsViewMarkup = (activities, tools, i18n) => {
  const results=activities;
  return `<section class="ai-results-workspace">
    <header><div><strong>${esc(i18n.t('workspaceResults'))}</strong><small>${esc(i18n.t('workspaceResultsCopy'))}</small></div><em>${results.length}</em></header>
    <div class="ai-results-scroll">${results.length?[...results].reverse().map(activity=>{
      const app=tools.registry.get(activity.appId),target=resultOpenTarget(activity),path=resultPath(activity),time=(activity.finishedAt||activity.startedAt)?new Intl.DateTimeFormat(i18n.t('dateFormat'),{hour:'2-digit',minute:'2-digit'}).format(new Date(activity.finishedAt||activity.startedAt)):'',duration=durationCopy(activity),meta=[app?i18n.t(app.title):i18n.t('systemTool'),phaseCopy(activity,i18n),activity.risk==='high'&&['completed','failed'].includes(activity.phase)?i18n.t('resultApproved'):'',time,duration].filter(Boolean).join(' · ');
      const operationKind=resultOperationKind(activity.operation);
      return `<article class="ai-result-card tone-${resultTone(activity)} operation-${esc(operationKind)} phase-${esc(activity.phase)}">
        <header><span class="app-icon app-icon-${esc(app?.color||'blue')}">${icon(app?.icon||resultIcon(activity),17)}</span><div><small>${esc(meta)}</small><strong>${esc(resultTitle(activity,i18n))}</strong></div><b class="ai-result-operation">${icon(resultOperationIcon(operationKind),10)} ${esc(resultOperationCopy(activity,i18n))}</b></header>
        ${resultBodyMarkup(activity,i18n)}
        ${resultFactsMarkup(activity,i18n)}
        <details class="ai-activity-inspector ai-result-inspector"><summary>${esc(i18n.t('toolCallDetails'))}${icon('chevron',11)}</summary><div><section><small>${esc(i18n.t('toolParameters'))}</small><pre data-copyable>${esc(displayValue(activity.params))}</pre></section>${activity.result!=null||activity.output?`<section><small>${esc(i18n.t('toolResult'))}</small><pre data-copyable>${esc(displayValue(activity.result??activity.output))}</pre></section>`:''}</div></details>
        <footer><button data-ai-workspace-turn="${esc(activity.turnId)}" title="${esc(i18n.t('locateInConversation'))}">${icon('message',12)}</button>${path?`<button data-ai-reveal-result="${esc(activity.id)}" title="${esc(i18n.t('showInFiles'))}">${icon('folder',12)}</button>`:''}<span></span><button data-ai-copy-result="${esc(activity.id)}">${icon('copy',12)} ${esc(i18n.t('copy'))}</button>${target.appId?`<button class="primary" data-ai-open-result="${esc(activity.id)}" data-result-app="${esc(target.appId)}" data-result-path="${esc(target.path)}">${esc(i18n.t('open'))} ${icon('chevron',11)}</button>`:''}</footer>
      </article>`;
    }).join(''):`<div class="ai-results-empty"><span>${icon('sparkles',25)}</span><strong>${esc(i18n.t('noResultsTitle'))}</strong><p>${esc(i18n.t('noResultsCopy'))}</p></div>`}</div>
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

export function workspaceMarkup(activity, activities, tools, i18n, { animate = true, signature: suppliedSignature = '', view = 'activity', context = null, windows = [], activityApps = [], activityAppId = '' } = {}) {
  const resizeHandle = `<div class="ai-workspace-resize" data-ai-workspace-resize role="separator" aria-orientation="vertical" aria-label="${esc(i18n.t('resizeWorkspace'))}" tabindex="0"><i></i></div>`;
  const signature=suppliedSignature||workspaceSignature(activity);
  const countCopy=i18n.t('workspaceToolCallCount').replace('{count}',activities.length);
  return `<aside class="ai-app-workspace ${activity?`ai-app-workspace-${esc(activity.phase)}`:'ai-app-workspace-empty'} ${animate?'':'ai-app-workspace-stable'}" data-ai-app-workspace data-workspace-tool-id="${esc(activity?.id||'')}" data-workspace-signature="${esc(signature||'empty')}">
    ${resizeHandle}
    <header>
      <span class="ai-workspace-brand">${icon('aerisAi', 20)}</span>
      <div><strong>${esc(i18n.t('agentWorkspace'))}</strong><small>${esc(activities.length?countCopy:i18n.t('workspaceReady'))}</small></div>
      <button data-ai-close-workspace title="${esc(i18n.t('closeWorkspace'))}">${icon('close', 15)}</button>
    </header>
    <nav class="ai-workspace-view-switch" aria-label="${esc(i18n.t('agentWorkspace'))}"><button class="${view==='activity'?'selected':''}" data-ai-workspace-view="activity" aria-pressed="${view==='activity'}">${icon('maximize',12)} ${esc(i18n.t('workspaceActivity'))}</button><button class="${view==='context'?'selected':''}" data-ai-workspace-view="context" aria-pressed="${view==='context'}">${icon('focus',12)} ${esc(i18n.t('workspaceContextView'))}</button><button class="${view==='results'?'selected':''}" data-ai-workspace-view="results" aria-pressed="${view==='results'}">${icon('sparkles',12)} ${esc(i18n.t('workspaceResults'))}</button></nav>
    <main class="ai-workspace-content-layout">
      ${view==='activity'?activityViewMarkup(activityApps,activityAppId,i18n):view==='context'?contextViewMarkup(context,windows,tools,i18n):resultsViewMarkup(activities,tools,i18n)}
    </main>
    <footer><span>${icon(view==='context'?'lock':view==='results'?'sparkles':'maximize',14)} ${esc(i18n.t(view==='context'?'contextManagedByAeris':view==='results'?'resultsManagedByAeris':'activityManagedByAeris'))}</span></footer>
  </aside>`;
}
