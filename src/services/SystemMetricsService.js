export class SystemMetricsService {
  constructor(system, machine) {
    this.system = system;
    this.machine = machine;
    this.timer = null;
    this.inflight = null;
    this.state = this.#loadCache() || this.#empty();
  }

  start() {
    this.kernel.bus.on('system:ready', () => {
      this.refresh().catch(() => {});
      this.#schedule();
    });
    this.kernel.bus.on('machine:status', status => {
      if (status !== 'running') {
        this.state = this.#empty();
        this.kernel.bus.emit('metrics:update', this.snapshot());
      }
    });
    if (this.system.ready) {
      this.refresh().catch(() => {});
      this.#schedule();
    }
  }

  stop() { clearInterval(this.timer);clearTimeout(this.retryTimer); }

  snapshot() { return structuredClone(this.state); }

  async refresh() {
    if (this.inflight) return this.inflight;
    if (!this.system.ready) return this.snapshot();
    this.inflight = (async () => {
      const command = `awk '
        /^MemTotal:/ { total=$2 }
        /^MemFree:/ { free=$2 }
        /^MemAvailable:/ { available=$2 }
        /^Buffers:/ { buffers=$2 }
        /^Cached:/ { cached=$2 }
        /^SwapTotal:/ { swapTotal=$2 }
        /^SwapFree:/ { swapFree=$2 }
        END { if (!available) available=free+buffers+cached; printf "__AERIS_METRICS__%s|%s|%s|%s|%s|%s", total,available,buffers,cached,swapTotal,swapFree }
      ' /proc/meminfo; read uptime idle < /proc/uptime; read load rest < /proc/loadavg; printf '|%s|%s' "$uptime" "$load"`;
      const { output } = await this.system.exec(command, 12000);
      const payload = output.split('__AERIS_METRICS__').at(-1)?.trim() || '';
      const [totalKb, availableKb, buffersKb, cachedKb, swapTotalKb, swapFreeKb, uptimeSeconds, loadAverage] = payload.split('|');
      const total = Number(totalKb) || this.machine.settings.get('memory') * 1024;
      const available = Math.max(0, Number(availableKb) || 0);
      const used = Math.max(0, total - available);
      const swapTotal = Number(swapTotalKb) || 0, swapFree = Number(swapFreeKb) || 0;
      this.state = {
        ready: true,
        totalKb: total,
        usedKb: used,
        availableKb: available,
        buffersKb: Number(buffersKb) || 0,
        cachedKb: Number(cachedKb) || 0,
        swapTotalKb: swapTotal,
        swapUsedKb: Math.max(0, swapTotal - swapFree),
        percent: total ? Math.round(used / total * 100) : 0,
        uptimeSeconds: Number.parseFloat(uptimeSeconds) || 0,
        loadAverage: Number.parseFloat(loadAverage) || 0,
        updatedAt: Date.now(),
      };
      this.#saveCache();
      clearTimeout(this.retryTimer);
      this.kernel.bus.emit('metrics:update', this.snapshot());
      return this.snapshot();
    })().catch(error => {
      this.kernel.bus.emit('metrics:error', { error: error.message });
      clearTimeout(this.retryTimer);this.retryTimer=setTimeout(()=>this.refresh().catch(()=>{}),2500);
      return this.snapshot();
    }).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  #schedule() {
    clearInterval(this.timer);
    this.timer = setInterval(() => this.refresh().catch(() => {}), 30000);
  }

  #empty() {
    const totalKb = (this.machine?.settings.get('memory') || 256) * 1024;
    return { ready: false, totalKb, usedKb: 0, availableKb: totalKb, buffersKb: 0, cachedKb: 0, swapTotalKb: 0, swapUsedKb: 0, percent: 0, uptimeSeconds: 0, loadAverage: 0, updatedAt: 0 };
  }

  #loadCache(){try{const value=JSON.parse(localStorage.getItem('aeris.metrics.last-sample')||'null');return value?.ready&&value.totalKb?value:null}catch{return null}}
  #saveCache(){try{localStorage.setItem('aeris.metrics.last-sample',JSON.stringify(this.state))}catch{}}
}
