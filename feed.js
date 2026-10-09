// Market data feeds. DerivFeed = real live prices straight from the phone (public Deriv WebSocket API:
// forex, gold, crypto, indices and synthetics - no account, key or PC needed). MockFeed = simulated market.
import { TF_SECONDS } from './engine.js';
import { HTF } from './strategies.js';

export const GRAN = { M1: 60, M5: 300, M15: 900, M30: 1800, H1: 3600, H4: 14400, D1: 86400 };
const TF_BY_GRAN = Object.fromEntries(Object.entries(GRAN).map(([k, v]) => [v, k]));
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const DEFAULT_INSTRUMENTS = [
  { code: 'frxXAUUSD', name: 'XAUUSD', label: 'Gold', category: 'Gold' },
  { code: 'frxEURUSD', name: 'EURUSD', label: 'Euro / US Dollar', category: 'Forex' },
  { code: 'frxGBPUSD', name: 'GBPUSD', label: 'Pound / US Dollar', category: 'Forex' },
  { code: 'frxUSDJPY', name: 'USDJPY', label: 'US Dollar / Yen', category: 'Forex' },
  { code: 'frxAUDUSD', name: 'AUDUSD', label: 'Aussie / US Dollar', category: 'Forex' },
  { code: 'cryBTCUSD', name: 'BTCUSD', label: 'Bitcoin', category: 'Crypto' },
  { code: 'cryETHUSD', name: 'ETHUSD', label: 'Ethereum', category: 'Crypto' },
  { code: 'OTC_DJI', name: 'US30', label: 'Wall Street 30', category: 'Indices' },
  { code: 'OTC_NDX', name: 'NAS100', label: 'US Tech 100', category: 'Indices' },
  { code: 'R_75', name: 'Volatility 75', label: 'Volatility 75 Index', category: 'Synthetics' },
  { code: 'R_100', name: 'Volatility 100', label: 'Volatility 100 Index', category: 'Synthetics' },
  { code: 'BOOM1000', name: 'Boom 1000', label: 'Boom 1000 Index', category: 'Synthetics' },
  { code: 'CRASH1000', name: 'Crash 1000', label: 'Crash 1000 Index', category: 'Synthetics' },
];

export const MARKET_CATEGORY = { forex: 'Forex', commodities: 'Gold', cryptocurrency: 'Crypto', indices: 'Indices', synthetic_index: 'Synthetics' };

// ----------------------------------------------------------------- Deriv (live)
export class DerivFeed {
  constructor({ endpoints = ['wss://ws.derivws.com/websockets/v3', 'wss://ws.binaryws.com/websockets/v3'], appId = 1089,
                WS = globalThis.WebSocket, clock = () => Date.now(), heartbeat = 30000, connectTimeout = 8000, retryBase = 2000, gap = 80 } = {}) {
    Object.assign(this, { endpoints, appId, WS, clock, heartbeat, connectTimeout, retryBase, gap });
    this.ws = null; this.reqId = 0; this.pending = new Map(); this.store = new Map(); this.htfStore = new Map();
    this.metas = []; this.skipped = []; this.active = []; this.tf = 'M5'; this.state = 'idle'; this.msg = '';
    this.lastMsg = 0; this.stopping = false; this.hb = null; this.listeners = new Set();
  }
  onStatus(fn) { this.listeners.add(fn); }
  _status(state, msg = '') { this.state = state; this.msg = msg; this.listeners.forEach(f => f(this.status())); }
  status() { return { state: this.state, msg: this.msg, ready: this.metas.filter(m => this.store.has(`${m.code}|${this.tf}`)).length, total: this.metas.length, lastMsg: this.lastMsg }; }

  _openOne(ep) {
    return new Promise((resolve, reject) => {
      let done = false, ws;
      const fail = e => { if (!done) { done = true; try { ws && ws.close(); } catch (x) { /* ignore */ } reject(e); } };
      const timer = setTimeout(() => fail(new Error('timeout')), this.connectTimeout);
      try { ws = new this.WS(`${ep}?app_id=${this.appId}`); } catch (e) { clearTimeout(timer); return fail(e); }
      ws.onopen = () => { if (!done) { done = true; clearTimeout(timer); resolve(ws); } };
      ws.onerror = () => { clearTimeout(timer); fail(new Error('connection error')); };
      ws.onclose = () => { clearTimeout(timer); fail(new Error('closed')); };
    });
  }
  async _open() {
    let last = null;
    for (const ep of this.endpoints) {
      try {
        const ws = await this._openOne(ep);
        ws.onmessage = ev => this._onMsg(ev);
        ws.onerror = () => {};
        ws.onclose = () => this._onClose(ws);
        this.ws = ws;
        clearInterval(this.hb);
        if (this.heartbeat) this.hb = setInterval(() => { try { this.ws && this.ws.readyState === 1 && this.ws.send(JSON.stringify({ ping: 1 })); } catch (e) { /* ignore */ } }, this.heartbeat);
        return ep;
      } catch (e) { last = e; }
    }
    throw new Error('Could not reach the market-data servers (' + (last ? last.message : 'no endpoint') + '). Check your internet connection.');
  }
  _send(obj, timeout = 15000) {
    return new Promise((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== 1) return reject(new Error('not connected'));
      const id = ++this.reqId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('request timed out')); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws.send(JSON.stringify({ ...obj, req_id: id }));
    });
  }
  _onMsg(ev) {
    let d; try { d = JSON.parse(ev.data); } catch (e) { return; }
    this.lastMsg = this.clock();
    const p = d.req_id && this.pending.get(d.req_id);
    if (p) {
      this.pending.delete(d.req_id); clearTimeout(p.timer);
      if (d.error) p.reject(new Error(d.error.message || d.error.code || 'API error')); else p.resolve(d);
    }
    if (d.msg_type === 'ohlc' && d.ohlc) this._ohlc(d.ohlc);
  }
  _ohlc(o) {
    const tf = TF_BY_GRAN[+o.granularity];
    if (!tf) return;
    const arr = this.store.get(`${o.symbol}|${tf}`);
    if (!arr) return;
    const t = +o.open_time, k = { t, o: +o.open, h: +o.high, l: +o.low, c: +o.close }, last = arr[arr.length - 1];
    if (last && last.t === t) { last.o = k.o; last.h = k.h; last.l = k.l; last.c = k.c; }
    else if (!last || t > last.t) { arr.push(k); if (arr.length > 400) arr.shift(); }
  }
  _onClose(ws) {
    if (this.stopping || ws !== this.ws) return;
    this.pending.forEach(p => { clearTimeout(p.timer); p.reject(new Error('connection lost')); }); this.pending.clear();
    this._status('reconnecting', 'Connection lost - reconnecting...');
    this._reconnect();
  }
  async _reconnect() {
    let wait = this.retryBase;
    while (!this.stopping) {
      try {
        await this._open();
        await this._subscribeAll();
        this._status('live', '');
        return;
      } catch (e) { this._status('reconnecting', e.message); await sleep(wait); wait = Math.min(wait * 2, 30000); }
    }
  }
  async _loadActive() {
    try {
      const r = await this._send({ active_symbols: 'brief', product_type: 'basic' });
      this.active = (r.active_symbols || []).map(s => ({ code: s.symbol, label: s.display_name, market: s.market,
        category: MARKET_CATEGORY[s.market] || 'Other', open: !!s.exchange_is_open && !s.is_trading_suspended }));
    } catch (e) { this.active = []; }
  }
  async _loadCandles(meta, tf, subscribe) {
    const r = await this._send({ ticks_history: meta.code, adjust_start_time: 1, count: 300, end: 'latest',
      granularity: GRAN[tf], style: 'candles', ...(subscribe ? { subscribe: 1 } : {}) });
    const arr = (r.candles || []).map(c => ({ t: +c.epoch, o: +c.open, h: +c.high, l: +c.low, c: +c.close }));
    if (r.pip_size !== undefined) meta.digits = +r.pip_size;
    return arr;
  }
  async _subscribeAll() {
    for (const m of this.metas) {
      try { this.store.set(`${m.code}|${this.tf}`, await this._loadCandles(m, this.tf, true)); m.error = ''; }
      catch (e) { m.error = e.message; }
      if (this.gap) await sleep(this.gap);
    }
  }
  // metas: [{code, name, category}] -> returns the instruments that are really available
  async start(metas, tf = 'M5') {
    this.stopping = false; this.tf = tf; this._status('connecting', 'Connecting to live market data...');
    await this._open();
    await this._loadActive();
    const have = new Set(this.active.map(a => a.code));
    this.skipped = have.size ? metas.filter(m => !have.has(m.code)) : [];
    this.metas = metas.filter(m => !have.size || have.has(m.code)).map(m => ({ ...m, digits: m.digits ?? 2 }));
    await this._subscribeAll();
    const ok = this.metas.filter(m => this.store.has(`${m.code}|${tf}`));
    if (!ok.length) { this._status('error', 'Connected, but no price data was returned.'); throw new Error('no data'); }
    this._status('live', '');
    return this.metas.filter(m => this.store.has(`${m.code}|${tf}`));
  }
  async setTimeframe(tf) {
    if (tf === this.tf) return;
    this.tf = tf;
    try { await this._send({ forget_all: 'candles' }); } catch (e) { /* ignore */ }
    for (const k of [...this.store.keys()]) if (!k.endsWith('|' + tf)) this.store.delete(k);
    await this._subscribeAll();
  }
  candles(code, tf = this.tf) { return this.store.get(`${code}|${tf}`) || []; }
  price(code) { const c = this.candles(code); const p = c.length ? c[c.length - 1].c : 0; return [p, p]; }
  htf(code, tf = this.tf) {
    const g = HTF[tf]; if (!g) return null;
    const key = `${code}|${g}`, e = this.htfStore.get(key), now = this.clock();
    if ((!e || now - e.at > 600000) && !(e && e.loading)) {
      this.htfStore.set(key, { at: now, data: e ? e.data : null, loading: true });
      const meta = this.metas.find(m => m.code === code) || { code };
      this._loadCandles(meta, g, false).then(data => this.htfStore.set(key, { at: this.clock(), data, loading: false }))
        .catch(() => this.htfStore.set(key, { at: this.clock(), data: e ? e.data : null, loading: false }));
    }
    const cur = this.htfStore.get(key); return cur && cur.data;
  }
  step() {}
  stop() { this.stopping = true; clearInterval(this.hb); try { this.ws && this.ws.close(); } catch (e) { /* ignore */ } this._status('idle', ''); }
}

// ----------------------------------------------------------------- Mock (demo)
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const MOCK_START = { Gold: 2650, Forex: 1.1, Crypto: 64000, Indices: 18000, Synthetics: 1200, Other: 100 };

export class MockFeed {
  constructor({ seed = 7, seedCandles = 3000 } = {}) { this.rand = rng(seed); this.seedCandles = seedCandles; this.s = {}; this.tf = 'M5'; this.metas = []; this.speed = 6; this.state = 'idle'; }
  _rnd() { let t = 0; for (let i = 0; i < 6; i++) t += this.rand(); return t - 3; }
  async start(metas, tf = 'M5') {
    this.tf = tf;
    this.metas = metas.map(m => {
      const p = /JPY$/.test(m.name) ? 150 : (MOCK_START[m.category] ?? 100);
      this.s[m.code] = { c: [], tc: 12, tr: 0, sh: 0, n: 0, p, v: m.category === 'Forex' ? 0.0002 : 0.0004 };
      return { ...m, digits: p < 10 ? 5 : p < 500 ? 3 : 2 };
    });
    for (let i = 0; i < this.seedCandles * 12; i++) this._tick();
    this.state = 'live';
    return this.metas;
  }
  _tick() {
    for (const st of Object.values(this.s)) {
      if (!st.c.length || st.tc >= 12) {
        const o = st.c.length ? st.c[st.c.length - 1].c : st.p;
        st.n += 1; st.c.push({ t: 1699920000 + st.n * 60, o, h: o, l: o, c: o }); st.tc = 0;
        if (st.c.length > 4000) st.c.splice(0, st.c.length - 4000);
      }
      st.tr = st.tr * 0.98 + this._rnd() * 0.2; st.sh *= 0.8;
      const c = st.c[st.c.length - 1];
      c.c *= 1 + st.v * (this._rnd() * 0.5 + st.tr * 0.3 + st.sh);
      c.h = Math.max(c.h, c.c); c.l = Math.min(c.l, c.c); st.tc += 1;
    }
  }
  step() { for (let i = 0; i < this.speed; i++) this._tick(); }
  shock(code, dir = 1) { this.s[code].sh = dir * 1.6; }
  status() { return { state: this.state, msg: 'Demo mode - simulated prices', ready: this.metas.length, total: this.metas.length, lastMsg: Date.now() }; }
  onStatus() {}
  async setTimeframe(tf) { this.tf = tf; }
  candles(code, tf = this.tf) {
    const sec = TF_SECONDS[tf], out = [], base = this.s[code].c, f = Math.max(1, sec / 60);
    for (const b of base.slice(-(300 * f + f))) {
      const key = Math.floor(b.t / sec) * sec, last = out[out.length - 1];
      if (last && last.t === key) { last.h = Math.max(last.h, b.h); last.l = Math.min(last.l, b.l); last.c = b.c; }
      else out.push({ t: key, o: b.o, h: b.h, l: b.l, c: b.c });
    }
    return out.slice(-300);
  }
  price(code) { const p = this.s[code].c.at(-1).c; return [p, p]; }
  htf(code, tf = this.tf) { const g = HTF[tf]; return g ? this.candles(code, g).slice(-120) : null; }
  stop() { this.state = 'idle'; }
}
