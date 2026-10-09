// Pure HTML builders for the phone UI (no DOM access - easy to test).
import { STRATEGY_INFO } from './scanner.js';

export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const SN = { SHADOW_ENTRY: 'Shadow Entry', SCALPING: 'Scalping', ICT: 'ICT', PRICE_ACTION: 'Price Action', NEWS_STRADDLE: 'News' };
export const isLive = g => g.state === 'ACTIVE' || g.state === 'PENDING';
export const label = g => (g.order_type === 'MARKET' ? g.direction + ' NOW' : g.order_type.replace('_', ' '));
export const stateText = g => (g.state === 'ACTIVE' ? (g.hits ? `TP${g.hits} ✓ running` : 'ACTIVE') : g.state.replace('_', ' '));
export const SIG_TABS = {
  Live: g => g.state === 'ACTIVE', Pending: g => g.state === 'PENDING',
  News: g => g.strategy === 'NEWS_STRADDLE' && isLive(g), History: g => !isLive(g),
};
const ago = (t, now) => { const m = Math.max(0, Math.round((now - t) / 60)); return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`; };
const timeStr = t => new Date(t * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export function sigCard(g, now = Date.now() / 1000) {
  const f = v => (+v).toFixed(g.digits), buy = g.direction === 'BUY';
  return `<article class="sg ${buy ? 'b' : 's'}" data-act="pick" data-sym="${esc(g.symbol)}">
<div class="r"><b class="sym">${esc(g.symbol)}</b><span class="bd ${buy ? 'up' : 'dn'}">${label(g)}</span><span class="st">${stateText(g)}</span></div>
<div class="ttl">${esc(g.title)}</div>
<div class="r sm"><span class="tag">${SN[g.strategy] || esc(g.strategy)}</span><span>${g.timeframe} · ${timeStr(g.created)} · ${ago(g.created, now)}</span></div>
<div class="gr"><i>Entry</i><b>${f(g.entry)}</b><i>SL</i><b class="dn">${f(g.sl)}</b><i>TP1</i><b class="up">${f(g.tp1)}</b><i>TP2</i><b class="up">${f(g.tp2)}</b><i>TP3</i><b class="up">${f(g.tp3)}</b><i>R:R</i><b>1 : ${g.risk_reward.join(' / ')}</b></div>
<div class="cf"><div style="width:${g.confidence}%"></div><span>Confidence ${g.confidence}%</span></div>
<div class="why"><b>Why this ${g.order_type === 'MARKET' ? 'market' : 'pending'} ${g.direction.toLowerCase()}</b><ul>${g.reasons.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div></article>`;
}

export const stratChips = cur => Object.entries(STRATEGY_INFO).map(([k, v]) =>
  `<button class="chip ${k === cur ? 'on' : ''}" data-act="strat" data-v="${k}">${v.label}</button>`).join('');

export function selectOptions(opts, cur) { return opts.map(o => `<option ${String(o) === String(cur) ? 'selected' : ''}>${o}</option>`).join(''); }

export function catChips(symbols, cur) {
  const cats = ['All', ...new Set(symbols.map(s => s.category))];
  return cats.map(c => `<button class="chip sm ${c === cur ? 'on' : ''}" data-act="cat" data-v="${esc(c)}">${esc(c)}</button>`).join('');
}

export function instrumentList(st, cat, sel) {
  const live = st.signals.filter(isLive);
  const rows = st.symbols.filter(x => cat === 'All' || x.category === cat).map(x => {
    const g = live.filter(q => q.symbol === x.symbol).sort((a, b) => b.confidence - a.confidence)[0];
    return `<div class="sy ${x.symbol === sel ? 'on' : ''}" data-act="pick" data-sym="${esc(x.symbol)}">
<div class="l"><b>${esc(x.symbol)}</b><small>${esc(x.category)} · ${x.bias === 'UP' ? '▲' : '▼'} RSI ${x.rsi.toFixed(0)}</small></div>
<div class="rt"><b>${x.bid.toFixed(x.digits)}</b><small>ATR ${x.atr.toFixed(x.digits)}</small></div>
${g ? `<span class="bd ${g.direction === 'BUY' ? 'up' : 'dn'}">${label(g)} · ${g.confidence}%</span>` : '<span class="bd nu">scanning…</span>'}</div>`;
  });
  return rows.length ? rows.join('') : '<p class="mu pad">Waiting for the first prices… (a few seconds)</p>';
}

export function signalList(st, tab, now) {
  if (tab === 'Activity') {
    return st.events.length ? st.events.map(e => `<div class="ev"><span>${esc(e.text)}</span><small>${timeStr(e.t)} · ${SN[e.strategy] || ''}</small></div>`).join('')
      : '<p class="mu pad">No activity yet.</p>';
  }
  const rows = st.signals.filter(SIG_TABS[tab]).sort((a, b) => (tab === 'History' ? b.created - a.created : b.confidence - a.confidence));
  return rows.length ? rows.map(g => sigCard(g, now)).join('') : '<p class="mu pad">No signals here yet - the engine checks every closed candle.</p>';
}
export const signalTabs = (st, cur) => [...Object.keys(SIG_TABS), 'Activity'].map(t =>
  `<button class="chip sm ${t === cur ? 'on' : ''}" data-act="sigtab" data-v="${t}">${t}${SIG_TABS[t] ? ' (' + st.signals.filter(SIG_TABS[t]).length + ')' : ''}</button>`).join('');

export function newsList(events, now) {
  if (!events.length) return '<p class="mu pad">No high-impact events in the calendar right now. Add one below if you know one is coming.</p>';
  return events.map(e => {
    const d = e.ts - now, m = Math.floor(Math.abs(d) / 60);
    const when = d > 0 ? (m >= 60 ? `in ${Math.floor(m / 60)}h ${m % 60}m` : `in ${m}m`) : 'released';
    return `<div class="nw"><span><b class="hi">HIGH</b> ${esc(e.title)}${e.manual ? ' <small>(yours)</small>' : ''}</span><span class="mu">${esc(e.ccy)}</span><span>${when}</span>${e.manual ? `<button class="x" data-act="delNews" data-id="${e.id}">✕</button>` : ''}</div>`;
  }).join('');
}

export const pillText = s => s.state === 'live' ? (s.demo ? 'DEMO' : `LIVE ${s.ready}/${s.total}`) : s.state === 'connecting' ? 'CONNECTING…' : s.state === 'reconnecting' ? 'RECONNECTING…' : s.state === 'error' ? 'OFFLINE' : '…';

export function instrumentPicker(groups, enabled) {
  return Object.entries(groups).map(([cat, items]) => `<details class="grp"><summary>${esc(cat)} <small>(${items.filter(i => enabled.has(i.code)).length}/${items.length})</small></summary>
${items.map(i => `<label class="chk"><input type="checkbox" data-code="${esc(i.code)}" ${enabled.has(i.code) ? 'checked' : ''}> ${esc(i.label || i.name)} <small>${esc(i.code)}${i.open === false ? ' · closed' : ''}</small></label>`).join('')}</details>`).join('');
}
