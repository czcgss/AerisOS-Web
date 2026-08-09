import { addDays, migrate as migrateCalendar, occurrences } from '../apps/calendar/model.js';

const STATE_NAME = 'notifications';
const MAX_ITEMS = 80;
const MAX_DELIVERED = 500;
const LATE_WINDOW = 24 * 60 * 60 * 1000;
const ALERT_OFFSETS = { atTime: 0, '5m': 5, '15m': 15, '1h': 60, '1d': 1440 };
const initialState = () => ({ items: [], delivered: {} });

const normalize = value => ({
  items: Array.isArray(value?.items) ? value.items.slice(0, MAX_ITEMS).map(item => ({ ...item, read: !!item.read })) : [],
  delivered: value?.delivered && typeof value.delivered === 'object' ? { ...value.delivered } : {},
});

export class NotificationService {
  constructor(userdata, i18n) {
    this.userdata = userdata;
    this.i18n = i18n;
    this.state = initialState();
    this.scanning = false;
  }

  async start() {
    this.state = normalize(await this.userdata.load(STATE_NAME, initialState()));
    this.offData = this.kernel.bus.on('userdata:change', detail => {
      if (detail?.name === 'calendar' || detail?.name === 'reminders') this.scan().catch(() => {});
    });
    this.timer = setInterval(() => this.scan().catch(() => {}), 30_000);
    addEventListener('visibilitychange', this.onVisibility = () => { if (!document.hidden) this.scan().catch(() => {}); });
    await this.scan();
    this.#emit();
  }

  stop() {
    clearInterval(this.timer);
    this.offData?.();
    removeEventListener('visibilitychange', this.onVisibility);
  }

  snapshot() {
    const items = structuredClone(this.state.items);
    return { items, unread: items.filter(item => !item.read).length };
  }

  async markAllRead() {
    let changed = false;
    for (const item of this.state.items) if (!item.read) { item.read = true; changed = true; }
    if (changed) await this.#save();
  }

  async clear() {
    if (!this.state.items.length) return;
    this.state.items = [];
    await this.#save();
  }

  async dismiss(id) {
    const next = this.state.items.filter(item => item.id !== id);
    if (next.length === this.state.items.length) return;
    this.state.items = next;
    await this.#save();
  }

  async scan(now = new Date()) {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const pending = [];
      const calendar = migrateCalendar(await this.userdata.load('calendar', null));
      const rangeStart = new Date(now.getTime() - LATE_WINDOW - 24 * 60 * 60 * 1000);
      const rangeEnd = addDays(now, 2);
      for (const event of occurrences(calendar.events, calendar.calendars, rangeStart, rangeEnd)) {
        if (!(event.alert in ALERT_OFFSETS)) continue;
        const alertAt = event.occurrenceStart.getTime() - ALERT_OFFSETS[event.alert] * 60_000;
        const sourceKey = `calendar:${event.occurrenceKey}:${event.alert}`;
        if (alertAt <= now.getTime() && alertAt >= now.getTime() - LATE_WINDOW && !this.state.delivered[sourceKey]) {
          const start = this.#formatDateTime(event.occurrenceStart, event.allDay);
          pending.push({ appId: 'calendar', sourceKey, title: event.title || this.i18n.t('calendarEvent'), message: event.location ? `${start} · ${event.location}` : start, occurredAt: alertAt, context:{appId:'calendar',label:event.title,resource:{kind:'event',id:event.id,uri:`aeris://calendar/events/${event.id}`,name:event.title,date:event.start,metadata:{start:event.start,end:event.end,location:event.location,calendarId:event.calendarId}}} });
        }
      }

      const reminders = await this.userdata.load('reminders', []);
      for (const reminder of reminders) {
        if (reminder.done || !reminder.due || reminder.notify === false) continue;
        const dueAt = new Date(`${reminder.due}T${reminder.dueTime || '09:00'}:00`).getTime();
        const sourceKey = `reminders:${reminder.id}:${reminder.due}:${reminder.dueTime || '09:00'}`;
        if (Number.isFinite(dueAt) && dueAt <= now.getTime() && dueAt >= now.getTime() - LATE_WINDOW && !this.state.delivered[sourceKey]) {
          pending.push({ appId: 'reminders', sourceKey, title: reminder.title || this.i18n.t('reminder'), message: this.#formatDateTime(new Date(dueAt), false), occurredAt: dueAt, context:{appId:'reminders',label:reminder.title,resource:{kind:'reminder',id:reminder.id,uri:`aeris://reminders/items/${reminder.id}`,name:reminder.title,date:reminder.due,metadata:{dueTime:reminder.dueTime||'09:00',priority:!!reminder.priority}}} });
        }
      }

      if (!pending.length) return;
      pending.sort((a, b) => a.occurredAt - b.occurredAt);
      const added = pending.map(item => ({ id: crypto.randomUUID(), ...item, createdAt: Date.now(), read: false }));
      for (const item of added) this.state.delivered[item.sourceKey] = Date.now();
      this.state.items = [...added].reverse().concat(this.state.items).slice(0, MAX_ITEMS);
      this.#trimDelivered();
      await this.#save(false);
      for (const item of added) this.kernel.bus.emit('notification:added', structuredClone(item));
      this.#emit();
    } finally {
      this.scanning = false;
    }
  }

  #formatDateTime(date, allDay) {
    const options = allDay ? { weekday: 'short', month: 'short', day: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return new Intl.DateTimeFormat(this.i18n.t('dateFormat'), options).format(date);
  }

  #trimDelivered() {
    const entries = Object.entries(this.state.delivered).sort((a, b) => b[1] - a[1]).slice(0, MAX_DELIVERED);
    this.state.delivered = Object.fromEntries(entries);
  }

  async #save(emit = true) {
    await this.userdata.save(STATE_NAME, this.state);
    if (emit) this.#emit();
  }

  #emit() { this.kernel.bus.emit('notification:changed', this.snapshot()); }
}
