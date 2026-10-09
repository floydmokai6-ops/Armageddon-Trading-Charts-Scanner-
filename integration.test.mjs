import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Book } from '../js/engine.js';
import { Calendar } from '../js/news.js';
import { MockFeed, DerivFeed, DEFAULT_INSTRUMENTS } from '../js/feed.js';
import { Scanner } from '../js/scanner.js';

const REF = JSON.parse(fs.readFileSync(new URL('./parity.json', import.meta.url)));
const memStore = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), m }; };
const T0 = Date.UTC(2026, 9, 9, 8, 0, 0) / 1000;          // 08:00 UTC = London killzone
const noNet = async () => { throw new Error('blocked'); };

test('demo market: every strategy runs, news straddle + OCO work, every signal has reasons', async () => {
  const feed = new MockFeed();
  const metas = DEFAULT_INSTRUMENTS.filter(i => ['XAUUSD', 'EURUSD', 'BTCUSD', 'US30', 'Volatility 75'].includes(i.name));
  let t = T0; const clock = () => t;
  const cal = new Calendar({ fetchImpl: noNet, clock });
  const sc = new Scanner({ feed, book: new Book(null), calendar: cal, clock, defaults: { min_conf: 50 } });
  sc.setSymbols(await feed.start(metas, 'M5'));
  cal.addManual('TEST CPI', 'USD', t + 600);
  let shocked = false;
  for (let i = 0; i < 2500; i++) {
    t += 1; sc.cycle();
    if (!shocked && [...sc.book.signals.values()].some(s => s.strategy === 'NEWS_STRADDLE')) { shocked = true; feed.shock('frxXAUUSD', 1); }
  }
  const sigs = [...sc.book.signals.values()], kinds = {};
  sigs.forEach(s => { kinds[s.strategy] = (kinds[s.strategy] || 0) + 1; });
  console.log('  signals:', sigs.length, JSON.stringify(kinds), '| events:', sc.events.length, '| calendar:', cal.status);
  assert.ok(sigs.length > 0); assert.ok(kinds.NEWS_STRADDLE > 0);
  assert.ok(Object.keys(kinds).filter(k => k !== 'NEWS_STRADDLE').length >= 2, 'several strategies should fire');
  assert.ok(!sigs.some(s => s.symbol === 'Volatility 75' && s.strategy === 'NEWS_STRADDLE'), 'synthetics ignore news');
  for (const s of sigs) {
    assert.ok(s.reasons.length >= 3 && s.title, s.id);
    assert.ok(s.reasons.some(r => /PENDING|MARKET|OCO/.test(r)), s.id);
  }
  const byOco = {};
  sigs.filter(s => s.oco).forEach(s => (byOco[s.oco] ||= []).push(s));
  for (const legs of Object.values(byOco)) {
    if (legs.some(l => ['ACTIVE', 'SL_HIT', 'COMPLETED', 'CLOSED_BE'].includes(l.state))) assert.equal(legs.filter(l => l.state === 'CANCELLED').length, 1);
  }
  const st = sc.state();
  assert.equal(st.symbols.length, 5); assert.ok(st.signals.length && st.events.length);
  const cd = sc.chartData('XAUUSD'); assert.equal(cd.candles.length, 80); assert.equal(cd.ema20.length, 80);
});

test('settings: strategy/timeframe/min-confidence persist across restarts', async () => {
  const store = memStore(), feed = new MockFeed();
  const metas = DEFAULT_INSTRUMENTS.slice(0, 3);
  const book = new Book(store), clock = () => T0;
  const sc = new Scanner({ feed, book, calendar: new Calendar({ fetchImpl: noNet, clock }), clock });
  sc.setSymbols(await feed.start(metas, 'M5'));
  const out = await sc.updateSettings({ strategy: 'ICT', timeframe: 'M15', min_conf: 70, news: false });
  assert.deepEqual([out.strategy, out.timeframe, out.min_conf, out.news], ['ICT', 'M15', 70, false]);
  await sc.updateSettings({ strategy: 'BOGUS', timeframe: 'W1', min_conf: 'x' });   // invalid values ignored
  assert.equal(sc.settings.strategy, 'ICT'); assert.equal(sc.settings.timeframe, 'M15'); assert.equal(sc.P.min_conf, 70);
  for (let i = 0; i < 5; i++) sc.cycle();
  assert.equal(sc.state().symbols[0].timeframe, 'M15');
  const sc2 = new Scanner({ feed, book: new Book(store), calendar: new Calendar({ fetchImpl: noNet, clock }), clock });
  assert.deepEqual([sc2.settings.strategy, sc2.settings.timeframe, sc2.settings.min_conf], ['ICT', 'M15', 70]);
});

// ---------------------------------------------------------------- Deriv protocol (fake server)
function makeServer({ failFirst = false } = {}) {
  const srv = { sockets: [], sent: [], opens: 0, urls: [], candlesFor: () => [], active: [], failTicks: new Set() };
  class FakeWS {
    constructor(url) {
      this.url = url; this.readyState = 0; srv.urls.push(url);
      setTimeout(() => {
        if (failFirst && srv.urls.length === 1) { this.readyState = 3; this.onerror && this.onerror({}); this.onclose && this.onclose({}); return; }
        this.readyState = 1; srv.opens++; srv.sockets.push(this); this.onopen && this.onopen({});
      }, 1);
    }
    send(raw) {
      const m = JSON.parse(raw); srv.sent.push(m);
      const reply = o => setTimeout(() => this.readyState === 1 && this.onmessage({ data: JSON.stringify({ req_id: m.req_id, ...o }) }), 1);
      if (m.ping) return reply({ msg_type: 'ping', ping: 'pong' });
      if (m.active_symbols) return reply({ msg_type: 'active_symbols', active_symbols: srv.active });
      if (m.forget_all) return reply({ msg_type: 'forget_all', forget_all: [] });
      if (m.ticks_history) {
        if (srv.failTicks.has(m.ticks_history)) return reply({ error: { code: 'MarketIsClosed', message: 'Market is closed' } });
        return reply({ msg_type: 'candles', candles: srv.candlesFor(m.ticks_history, m.granularity), pip_size: 2, ...(m.subscribe ? { subscription: { id: 'sub-' + m.ticks_history } } : {}) });
      }
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; setTimeout(() => this.onclose && this.onclose({}), 1); }
    push(o) { this.onmessage({ data: JSON.stringify(o) }); }
  }
  srv.WS = FakeWS;
  return srv;
}
const toDeriv = (cs, step = 300) => cs.map(k => ({ epoch: k.t, open: k.o, high: k.h, low: k.l, close: k.c }));
const wait = ms => new Promise(r => setTimeout(r, ms));
function liveFixture() {   // ICT fixture + 20 leading candles + a forming candle, as Deriv would send it
  const f = REF.fixtures.ict, pre = f.slice(0, 20).map((k, i) => ({ ...k, t: f[0].t - (20 - i) * 300 }));
  const closed = [...pre, ...f], last = closed.at(-1);
  return [...closed, { t: last.t + 300, o: last.c, h: last.c + 0.05, l: last.c - 0.05, c: last.c }];
}

test('Deriv feed: endpoint fallback, symbol validation, candles, streaming, errors, reconnect', async () => {
  const srv = makeServer({ failFirst: true });
  srv.active = [{ symbol: 'frxXAUUSD', display_name: 'Gold/USD', market: 'commodities', exchange_is_open: 1 },
                { symbol: 'frxEURUSD', display_name: 'EUR/USD', market: 'forex', exchange_is_open: 1 },
                { symbol: 'R_75', display_name: 'Volatility 75 Index', market: 'synthetic_index', exchange_is_open: 1 }];
  const data = liveFixture();
  srv.candlesFor = (sym, gran) => toDeriv(data);
  srv.failTicks.add('R_75');
  const feed = new DerivFeed({ WS: srv.WS, heartbeat: 0, retryBase: 5, gap: 0, endpoints: ['wss://bad.example/ws', 'wss://good.example/ws'] });
  const metas = DEFAULT_INSTRUMENTS.filter(i => ['XAUUSD', 'EURUSD', 'Volatility 75', 'BTCUSD'].includes(i.name));
  const ok = await feed.start(metas, 'M5');
  assert.ok(srv.urls[0].startsWith('wss://bad.example') && srv.urls[1].startsWith('wss://good.example'), 'falls back to the 2nd endpoint');
  assert.ok(srv.urls[1].includes('app_id=1089'));
  assert.deepEqual(feed.skipped.map(m => m.name), ['BTCUSD'], 'symbols the server does not list are skipped');
  assert.deepEqual(ok.map(m => m.name).sort(), ['EURUSD', 'XAUUSD'], 'a symbol whose history errors (market closed) is dropped');
  assert.equal(feed.metas.find(m => m.name === 'Volatility 75').error, 'Market is closed');
  assert.equal(feed.status().state, 'live');
  const req = srv.sent.find(m => m.ticks_history === 'frxXAUUSD');
  assert.deepEqual([req.granularity, req.style, req.subscribe, req.end, req.count], [300, 'candles', 1, 'latest', 300]);
  assert.equal(feed.candles('frxXAUUSD').length, data.length); assert.equal(feed.metas[0].digits, 2);
  // streaming update (strings, like the real ohlc messages) of the forming candle, then a new candle
  const ws = srv.sockets.at(-1), last = data.at(-1);
  ws.push({ msg_type: 'ohlc', ohlc: { symbol: 'frxXAUUSD', granularity: 300, open_time: last.t, open: String(last.o), high: String(last.h + 1), low: String(last.l), close: String(last.c + 0.5) } });
  let c = feed.candles('frxXAUUSD'); assert.equal(c.length, data.length); assert.equal(c.at(-1).c, last.c + 0.5); assert.equal(c.at(-1).h, last.h + 1);
  ws.push({ msg_type: 'ohlc', ohlc: { symbol: 'frxXAUUSD', granularity: 300, open_time: last.t + 300, open: '1', high: '3', low: '0.5', close: '2' } });
  c = feed.candles('frxXAUUSD'); assert.equal(c.length, data.length + 1); assert.deepEqual([c.at(-1).t, c.at(-1).c], [last.t + 300, 2]);
  assert.deepEqual(feed.price('frxXAUUSD'), [2, 2]);
  // higher-timeframe candles are fetched in the background (no subscription)
  assert.equal(feed.htf('frxXAUUSD', 'M5'), null); await wait(30);
  assert.equal(feed.htf('frxXAUUSD', 'M5').length, data.length);
  const hreq = srv.sent.filter(m => m.ticks_history === 'frxXAUUSD').at(-1); assert.deepEqual([hreq.granularity, hreq.subscribe], [3600, undefined]);
  // switching timeframe forgets old streams and re-subscribes
  await feed.setTimeframe('M15');
  assert.ok(srv.sent.some(m => m.forget_all === 'candles')); assert.ok(srv.sent.some(m => m.granularity === 900 && m.subscribe === 1));
  assert.ok(feed.candles('frxXAUUSD', 'M15').length > 0); assert.equal(feed.candles('frxXAUUSD', 'M5').length, 0);
  // connection drop -> automatic reconnect + resubscribe
  const before = srv.opens; srv.sockets.at(-1).close(); await wait(5);
  assert.equal(feed.status().state, 'reconnecting'); await wait(80);
  assert.equal(feed.status().state, 'live'); assert.ok(srv.opens > before);
  feed.stop();
});

test('Deriv feed + scanner: a live ICT setup arrives over the wire and becomes a signal with reasons', async () => {
  const srv = makeServer();
  srv.active = [{ symbol: 'frxXAUUSD', display_name: 'Gold/USD', market: 'commodities', exchange_is_open: 1 }];
  srv.candlesFor = () => toDeriv(liveFixture());
  const feed = new DerivFeed({ WS: srv.WS, heartbeat: 0, gap: 0 });
  const metas = DEFAULT_INSTRUMENTS.filter(i => i.name === 'XAUUSD'); let t = T0; const clock = () => t;
  const events = [];
  const sc = new Scanner({ feed, book: new Book(null), calendar: new Calendar({ fetchImpl: noNet, clock }), clock,
    defaults: { strategy: 'ICT', timeframe: 'M5', min_conf: 50 }, onEvent: (e, s) => events.push([e.event, s.id]) });
  sc.setSymbols(await feed.start(metas, 'M5'));
  sc.cycle();
  const sigs = [...sc.book.signals.values()];
  assert.equal(sigs.length, 1, 'exactly one ICT signal');
  const s = sigs[0];
  assert.equal(s.strategy, 'ICT'); assert.equal(s.direction, 'BUY'); assert.ok(s.zone.length === 2);
  assert.ok(s.reasons.some(r => /Liquidity grab/.test(r)) && s.reasons.some(r => /Fair value gap/.test(r)));
  assert.deepEqual(events.map(e => e[0]), ['new']);
  sc.cycle(); assert.equal(sc.book.signals.size, 1, 'same candle never creates a duplicate');
  feed.stop();
});
