import en from '../locales/en.js';
import zh from '../locales/zh.js';

export class I18nService {
  constructor(settings) { this.settings = settings; this.packs = { en, zh }; }
  start() {
    try { Object.assign(this.packs, JSON.parse(localStorage.getItem('aeris.languagePacks') || '{}')); } catch {}
  }
  get locale() { return this.settings.get('locale'); }
  t(key) {
    if(key&&typeof key==='object')return key[this.locale]??key.en??Object.values(key)[0]??'';
    return this.packs[this.locale]?.[key] ?? this.packs.en[key] ?? key;
  }
  list() { return Object.entries(this.packs).map(([code, pack]) => ({ code, name: pack._name })); }
  use(locale) { if (this.packs[locale]) this.settings.set('locale', locale); }
  install(pack) {
    if (!pack?._code || !pack?._name) throw new Error('Invalid language pack');
    this.packs[pack._code] = pack;
    localStorage.setItem('aeris.languagePacks', JSON.stringify(Object.fromEntries(Object.entries(this.packs).filter(([k]) => !['en','zh'].includes(k)))));
    this.kernel?.bus.emit('i18n:installed', pack._code);
  }
}
