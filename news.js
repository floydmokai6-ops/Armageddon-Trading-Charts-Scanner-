// High-impact news: currency mapping + calendar (free weekly feed, cached on the phone, plus manual events).
export const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';

// Which currencies' news moves this instrument ([] = news-immune, e.g. synthetic indices).
export function currencies(meta) {
  if (Array.isArray(meta.ccy)) return meta.ccy.map(c => c.toUpperCase());
  const cat = meta.category, n = (meta.name || '').toUpperCase();
  if (cat === 'Synthetics') return [];
  if (cat === 'Forex') {
    const code = (meta.code || '').replace(/^frx/, '').toUpperCase();
    const p = code.length === 6 ? code : n;
    return [p.slice(0, 3), p.slice(3, 6)];
  }
  if (cat === 'Indices') {
    if (/UK|FTSE|GBP/.test(n)) return ['GBP'];
    if (/GER|DAX|DE40|EURO|FRANCE|CAC|EU50|SPAIN|NETH/.test(n)) return ['EUR'];
    if (/JP|NIKKEI/.test(n)) return ['JPY'];
    if (/AUS/.test(n)) return ['AUD'];
    return ['USD'];
  }
  return ['USD'];
}

export function parseCalendar(items, impacts = ['high']) {
  const out = [];
  for (const it of items || []) {
    try {
      if (!impacts.includes(String(it.impact || '').toLowerCase())) continue;
      const ts = new Date(it.date).getTime() / 1000;
      if (!Number.isFinite(ts)) continue;
      out.push({ title: it.title, ccy: String(it.country).toUpperCase(), ts, forecast: it.forecast || '', previous: it.previous || '' });
    } catch (e) { /* skip malformed row */ }
  }
  return out;
}

export class Calendar {
  constructor({ storage = null, fetchImpl = globalThis.fetch, clock = () => Date.now() / 1000, url = FF_URL, ttl = 7200 } = {}) {
    this.storage = storage; this.fetchImpl = fetchImpl; this.clock = clock; this.url = url; this.ttl = ttl;
    this.enabled = true; this.events = []; this.manual = []; this.fetched = 0; this.loading = false;
    this.status = 'not loaded'; this.nextId = 1;
    const load = k => { try { return JSON.parse(storage?.getItem(k) || 'null'); } catch (e) { return null; } };
    this.manual = load('acs_news_manual') || [];
    this.nextId = this.manual.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1;
    const cache = load('acs_news_cache');
    if (cache) { this.events = parseCalendar(cache); this.status = 'cached calendar'; }
  }
  _saveManual() { try { this.storage?.setItem('acs_news_manual', JSON.stringify(this.manual)); } catch (e) { /* ignore */ } }
  addManual(title, ccy, ts) {
    const e = { id: this.nextId++, title, ccy: ccy.toUpperCase(), ts, forecast: '', previous: '', manual: true };
    this.manual.push(e); this._saveManual(); return e;
  }
  removeManual(id) { this.manual = this.manual.filter(e => e.id !== id); this._saveManual(); }
  async refresh(force = false) {
    if (!this.enabled || this.loading) return;
    if (!force && this.clock() - this.fetched < this.ttl) return;
    this.fetched = this.clock(); this.loading = true;
    try {
      const r = await this.fetchImpl(this.url, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      this.events = parseCalendar(data);
      try { this.storage?.setItem('acs_news_cache', JSON.stringify(data)); } catch (e) { /* ignore */ }
      this.status = `live calendar (${this.events.length} high-impact events this week)`;
    } catch (e) {
      this.status = this.events.length ? 'using cached calendar (live fetch failed)' : 'calendar unavailable - add events manually';
    } finally { this.loading = false; }
  }
  all() { return [...this.events, ...this.manual].sort((a, b) => a.ts - b.ts); }
}
