// Scanner: candles -> strategies -> signal lifecycle -> in-app activity feed. Runs entirely on the phone.
import { analyze, advance, buildNewsStraddle, buildSignal, detectShadow, ema, params, publicSignal } from './engine.js';
import { detect, HTF } from './strategies.js';
import { currencies } from './news.js';

export const STRATS = ['SHADOW_ENTRY', 'SCALPING', 'ICT', 'PRICE_ACTION'];
export const STRATEGY_INFO = {
  ALL: { label: 'All', tf: 'M5', desc: 'Runs every strategy on each new candle.' },
  SHADOW_ENTRY: { label: 'Shadow Entry', tf: 'M5', desc: 'Wick rejection at support/resistance, entry at the 50% retrace.' },
  SCALPING: { label: 'Scalping', tf: 'M5', desc: 'EMA 9/21/50 trend + pullback + momentum trigger. Tight SL, quick TPs (1R / 1.5R / 2R). Use M1-M5.' },
  ICT: { label: 'ICT', tf: 'M15', desc: 'Liquidity sweep + market-structure shift, entry at FVG/OTE, killzone and higher-timeframe bias. Use M5-M15.' },
  PRICE_ACTION: { label: 'Price Action', tf: 'M15', desc: 'Engulfing at levels, break & retest, inside-bar breakout with trend filter. Use M15-H1.' },
};
const PHRASE = { new: 'New signal', activated: 'Order triggered - trade is live', tp1: 'TP1 hit - SL moved to entry', tp2: 'TP2 hit',
  tp3: 'TP3 hit - trade completed', sl: 'Stop-loss hit', breakeven: 'Closed at breakeven', expired: 'Pending order expired', cancelled: 'Order cancelled' };

export class Scanner {
  constructor({ feed, book, calendar, defaults = {}, tuning = {}, clock = () => Date.now() / 1000, onEvent = () => {} }) {
    this.feed = feed; this.book = book; this.cal = calendar; this.clock = clock; this.onEvent = onEvent;
    this.P = params(tuning);
    this.settings = { strategy: 'ALL', timeframe: 'M5', min_conf: this.P.min_conf, news: true, ...defaults, ...book.settings };
    this.P.min_conf = this.settings.min_conf;
    this.symbols = []; this.analysis = {}; this.candles = {}; this.lastCandle = {}; this.events = [];
    this.cycles = 0; this.lastCycle = 0; this.busy = false;
  }
  setSymbols(metas) { this.symbols = metas; this.lastCandle = {}; this.analysis = {}; this.candles = {}; }

  async updateSettings(n) {
    const s = this.settings, oldTf = s.timeframe;
    if (n.strategy && (n.strategy === 'ALL' || STRATS.includes(n.strategy))) s.strategy = n.strategy;
    if (['M1', 'M5', 'M15', 'M30', 'H1'].includes(n.timeframe)) s.timeframe = n.timeframe;
    if (typeof n.min_conf === 'number') s.min_conf = Math.max(40, Math.min(95, Math.trunc(n.min_conf)));
    if (typeof n.news === 'boolean') s.news = n.news;
    this.P.min_conf = s.min_conf;
    this.book.settings = { ...this.book.settings, strategy: s.strategy, timeframe: s.timeframe, min_conf: s.min_conf, news: s.news };
    this.lastCandle = {}; this.analysis = {}; this.candles = {};
    if (s.timeframe !== oldTf) await this.feed.setTimeframe(s.timeframe);
    this.book.save();
    return { ...s };
  }

  _emit(event, sig, reason = '') {
    let txt = PHRASE[event] || event;
    if (reason) txt += ` (${reason})`;
    const e = { t: this.clock(), event, symbol: sig.symbol, id: sig.id, direction: sig.direction, order_type: sig.order_type,
      strategy: sig.strategy, confidence: sig.confidence, text: `${sig.symbol} ${sig.direction} ${sig.order_type.replace('_', ' ')}: ${txt}` };
    this.events.unshift(e); this.events.length = Math.min(this.events.length, 120);
    this.onEvent(e, sig);
  }

  _blackout(ccys, now) {
    const w = this.P.blackout_min * 60;
    return this.cal.all().some(e => Math.abs(e.ts - now) <= w && ccys.includes(e.ccy));
  }
  static killzone(m, now) {
    if (m.category === 'Crypto' || m.category === 'Synthetics') return '';
    const h = new Date(now * 1000).getUTCHours();
    return h >= 7 && h < 10 ? 'London' : h >= 12 && h < 15 ? 'New York' : '';
  }

  _setups(m, closed, now, tf) {
    const names = this.settings.strategy === 'ALL' ? STRATS : [this.settings.strategy];
    const ccys = currencies(m), nb = ccys.length ? this._blackout(ccys, now) : false;
    let H = null;
    if (names.some(x => x !== 'SHADOW_ENTRY')) { const h = this.feed.htf(m.code, tf); H = h && h.length > 30 ? h.slice(0, -1) : null; }
    const ctx = { digits: m.digits, kz: Scanner.killzone(m, now) }, out = [];
    for (const name of names) {
      const s = name === 'SHADOW_ENTRY' ? detectShadow(closed, this.P, nb) : detect(name, closed, H, this.P, ctx);
      if (s && name !== 'SHADOW_ENTRY' && nb) { s.conf -= 10; s.reasons.push('A high-impact news release is within the blackout window (-10 confidence)'); }
      if (s && s.conf >= this.P.min_conf) out.push(s);
    }
    return out;
  }

  _newCandle(m, closed, bid, ask, now, tf) {
    for (const setup of this._setups(m, closed, now, tf)) {
      const sig = buildSignal(m, tf, setup, bid, ask, this.P, now, m.digits);
      if (!sig || this.book.signals.has(sig.id)) continue;
      for (const old of this.book.live(m.name)) {
        if (old.strategy === sig.strategy && old.state === 'PENDING') { old.state = 'CANCELLED'; this._emit('cancelled', old, 'replaced by a newer setup'); }
      }
      this.book.add(sig); this._emit('new', sig);
    }
  }

  _news(m, closed, bid, ask, now, tf) {
    const ccys = currencies(m);
    if (!ccys.length || !this.settings.news) return;
    const lead = this.P.news_lead_min * 60;
    for (const e of this.cal.all()) {
      const dt = e.ts - now, key = `NW:${m.name}:${Math.trunc(e.ts)}`;
      if (ccys.includes(e.ccy) && dt > 0 && dt <= lead && !this.book.flags.has(key)) {
        this.book.flags.add(key);
        for (const sig of buildNewsStraddle(m, tf, e, analyze(closed).atr, bid, ask, this.P, now, m.digits)) { this.book.add(sig); this._emit('new', sig); }
      }
    }
  }

  _process(m) {
    const name = m.name, tf = this.settings.timeframe;
    const c = this.feed.candles(m.code, tf);
    if (c.length < 80) return;
    const closed = c.slice(0, -1), [bid, ask] = this.feed.price(m.code);
    if (!bid || !ask) return;
    const now = this.clock();
    this.candles[name] = c.slice(-150);
    const an = analyze(closed);
    Object.assign(an, { symbol: name, category: m.category, bid, ask, digits: m.digits, timeframe: tf, code: m.code, label: m.label || name });
    this.analysis[name] = an;
    if (this.lastCandle[name] !== closed.at(-1).t) { this.lastCandle[name] = closed.at(-1).t; this._newCandle(m, closed, bid, ask, now, tf); }
    this._news(m, closed, bid, ask, now, tf);
    for (const s of this.book.live(name)) {
      for (const [ev, reason] of advance(s, bid, ask, now, this.P)) {
        if (ev === 'activated' && s.oco) {
          for (const o of this.book.live(name)) {
            if (o.oco === s.oco && o !== s && o.state === 'PENDING') { o.state = 'CANCELLED'; this._emit('cancelled', o, 'OCO: the opposite stop was triggered'); }
          }
        }
        this._emit(ev, s, reason);
      }
    }
  }

  cycle() {
    if (this.busy) return; this.busy = true;
    try {
      this.feed.step();
      this.cal.refresh().catch(() => {});
      for (const m of this.symbols) { try { this._process(m); } catch (e) { console.error('scan failed for', m.name, e); } }
      this.book.save();
      this.cycles += 1; this.lastCycle = this.clock();
    } finally { this.busy = false; }
  }

  // Everything the chart screen needs for one instrument.
  chartData(name) {
    const c = this.candles[name], an = this.analysis[name];
    if (!c || !an) return null;
    const cl = c.map(k => k.c), n = 80;
    return { symbol: name, digits: an.digits, candles: c.slice(-n), ema20: ema(cl, 20).slice(-n), ema50: ema(cl, 50).slice(-n),
      levels: an.levels, bias: an.bias, signals: this.book.live(name).map(publicSignal) };
  }
  state() {
    return { settings: { ...this.settings }, symbols: this.symbols.map(m => this.analysis[m.name]).filter(Boolean),
      signals: [...this.book.signals.values()].sort((a, b) => b.created - a.created).slice(0, 200).map(publicSignal),
      events: this.events.slice(0, 60), news: this.cal.all().filter(e => e.ts > this.clock() - 3600).slice(0, 12) };
  }
}
