import { icon } from '../../icons.js';

const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
const mb = kb => `${Math.max(0, Number(kb) || 0) / 1024 < 10 ? (Math.max(0, Number(kb) || 0) / 1024).toFixed(1) : Math.round(Math.max(0, Number(kb) || 0) / 1024)} MB`;
const duration = seconds => {
  const value = Math.max(0, Math.floor(seconds || 0));
  const hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m ${value % 60}s`;
};

export default {
  id: 'monitor', title: 'monitor', icon: 'memory', color: 'aqua', width: 940, height: 640, singleInstance: true,
  mount(root, { machine, system, metrics, i18n, kernel }) {
    let query = '', rows = [], processLoading = false, processError = '';
    const processState = status => {
      const code = String(status || '').charAt(0).toUpperCase();
      return { R: i18n.t('processRunning'), S: i18n.t('processSleeping'), D: i18n.t('processWaiting'), T: i18n.t('processStopped'), Z: i18n.t('processZombie'), W: i18n.t('processWaiting') }[code] || i18n.t('processUnknown');
    };
    root.innerHTML = `<div class="system-app monitor-pro monitor-readable">
      <header class="monitor-toolbar"><div><span>${icon('memory', 22)}</span><div><strong>${i18n.t('systemMonitor')}</strong><small>${i18n.t('systemMonitorCopy')}</small></div></div><div class="toolbar-spacer"></div><label class="app-search">${icon('search',14)}<input data-process-search placeholder="${i18n.t('searchProcesses')}"></label><button data-refresh-processes title="${i18n.t('refresh')}">${icon('refresh',15)}</button></header>
      <section class="monitor-overview">
        <article class="monitor-memory-card">
          <div class="monitor-memory-heading"><span><strong>${i18n.t('memory')}</strong><small data-memory-updated>${i18n.t('waitingForMemorySample')}</small></span><b data-memory-percent>0%</b></div>
          <div class="monitor-memory-bar"><i data-memory-bar></i></div>
          <div class="monitor-memory-values"><span><i class="used"></i><small>${i18n.t('memoryUsed')}</small><strong data-memory-used>—</strong></span><span><i class="available"></i><small>${i18n.t('memoryAvailable')}</small><strong data-memory-available>—</strong></span><span><i class="total"></i><small>${i18n.t('memoryTotal')}</small><strong data-memory-total>${machine.settings.get('memory')} MB</strong></span></div>
        </article>
        <article class="monitor-facts">
          <div><span>${icon('refresh',18)}</span><small>${i18n.t('uptime')}</small><strong data-uptime>—</strong></div>
          <div><span>${icon('chart',18)}</span><small>${i18n.t('systemLoad')}</small><strong data-system-load>—</strong></div>
          <div><span>${icon('terminal',18)}</span><small>${i18n.t('instructions')}</small><strong data-instructions>0</strong></div>
          <div><span>${icon('vm',18)}</span><small>${i18n.t('architecture')}</small><strong>i686</strong></div>
        </article>
      </section>
      <section class="monitor-process-section"><header><div><strong>${i18n.t('processes')}</strong><small data-process-status>${i18n.t('processesCopy')}</small></div><span data-process-count>0</span></header><div class="process-table"><header><span>${i18n.t('processName')}</span><span>${i18n.t('pid')}</span><span>${i18n.t('processState')}</span></header><main data-process-list></main></div></section>
      <footer class="app-statusbar"><span data-monitor-status>${i18n.t('memoryRefreshInterval')}</span><span>${i18n.t('processRefreshInterval')}</span></footer>
    </div>`;

    const drawProcesses = () => {
      const shown = rows.filter(row => `${row.name} ${row.pid}`.toLowerCase().includes(query.toLowerCase())), list = root.querySelector('[data-process-list]');
      root.querySelector('[data-process-count]').textContent = i18n.t('processCount').replace('{count}', shown.length);
      root.querySelector('[data-process-status]').textContent = processError ? i18n.t(rows.length ? 'showingLastProcessSample' : 'processesUnavailable') : i18n.t('processesCopy');
      list.innerHTML = shown.length ? shown.map(process => `<div><strong>${esc(process.name)}</strong><span>${process.pid}</span><span class="process-state"><i class="state-${String(process.status).charAt(0).toLowerCase()}"></i><b>${processState(process.status)}</b><small>${esc(process.status)}</small></span></div>`).join('') : `<div class="empty-state">${i18n.t(query ? 'noSearchResults' : processError ? 'processesUnavailable' : 'noMachine')}</div>`;
    };
    const drawMetrics = sample => {
      const percent = Math.max(0, Math.min(100, sample.percent || 0));
      root.querySelector('[data-memory-percent]').textContent = sample.ready ? `${percent}%` : '—';
      root.querySelector('[data-memory-bar]').style.width = `${percent}%`;
      root.querySelector('[data-memory-used]').textContent = sample.ready ? mb(sample.usedKb) : '—';
      root.querySelector('[data-memory-available]').textContent = sample.ready ? mb(sample.availableKb) : '—';
      root.querySelector('[data-memory-total]').textContent = mb(sample.totalKb);
      root.querySelector('[data-uptime]').textContent = sample.ready ? duration(sample.uptimeSeconds) : '—';
      root.querySelector('[data-system-load]').textContent = sample.ready ? sample.loadAverage.toFixed(2) : '—';
      root.querySelector('[data-memory-updated]').textContent = sample.updatedAt ? `${sample.stale?i18n.t('showingLastMemorySample'):i18n.t('updated')} ${new Intl.DateTimeFormat(i18n.t('dateFormat'), { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(sample.updatedAt)}` : i18n.t('waitingForMemorySample');
    };
    const updateFastStats = () => { root.querySelector('[data-instructions]').textContent = machine.instructionCount().toLocaleString(); };
    const updateProcesses = async () => {
      if (processLoading) return;
      if (!system.ready) { processError = 'offline';drawProcesses();return; }
      processLoading = true;
      try { rows = await system.processes();processError='';drawProcesses(); }
      catch(error) { processError=error.message||'unavailable';drawProcesses(); }
      finally { processLoading = false; }
    };
    root.querySelector('[data-process-search]').oninput = event => { query = event.target.value; drawProcesses(); };
    root.querySelector('[data-refresh-processes]').onclick = () => { updateProcesses(); metrics.refresh(); };
    const fastTimer = setInterval(updateFastStats, 1000), processTimer = setInterval(updateProcesses, 5000);
    const offReady = kernel.bus.on('guest:ready', () => { updateProcesses(); metrics.refresh(); });
    const offMetrics = kernel.bus.on('metrics:update', drawMetrics);
    drawMetrics(metrics.snapshot()); updateFastStats(); updateProcesses();
    return () => { clearInterval(fastTimer); clearInterval(processTimer); offReady(); offMetrics(); };
  },
};
