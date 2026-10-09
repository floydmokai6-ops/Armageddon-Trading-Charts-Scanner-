# Armageddon Chart Scanner 2.0 — phone app (no Windows, no PC, no server)

A real installable phone app (PWA). It streams **live prices straight to your phone**, scans Gold, Forex, Crypto,
Indices and Synthetics, and shows **buy / sell / pending signals** with **Entry, SL, TP1, TP2, TP3, a confidence
score and the written reasons why** — on the Armageddon fire theme with your logo. Everything runs on the phone.

## Put it on your phone (5 minutes, once)
A phone app needs a web address to install from (HTTPS). Any free static host works — you only upload this folder:
1. **Netlify Drop** (easiest): open app.netlify.com/drop on any device, drag this whole folder in. You get an https link.
   (Cloudflare Pages and GitHub Pages work the same way.)
2. Open that link on your phone.
   - **Android (Chrome):** menu ⋮ → *Install app*.
   - **iPhone (Safari):** Share → *Add to Home Screen*.
3. Open it from the new Armageddon icon. It starts in **Live prices** mode; if the live feed can't connect you get a banner
   with *Retry* and *Use demo data*.

## Screens
- **Scan** – strategy buttons (All, Shadow Entry, Scalping, ICT, Price Action), timeframe M1–H1, minimum confidence, category filter, every instrument with its live price, bias, RSI and best signal.
- **Chart** – candles, EMA20/50, support/resistance, signal zone, entry/SL/TP1-3 lines, signal candle ringed. Swipe or ‹ › to scan every pair; *Auto-tour* cycles them; save the chart as PNG / share it.
- **Signals** – Live, Pending, News, History, Activity. Each card has the **“Why this signal”** list: why it is a buy or sell, why it is market or pending, why the SL is there, where TP1-3 are.
- **News** – high-impact calendar with countdowns, news-straddle toggle, and “add an event” if the free calendar is blocked on your network.
- **Settings** – data source, alerts (sound / vibrate / notifications / keep screen awake), choose which instruments to scan, install help, reset.

## Data (live mode)
Prices come from Deriv's public market-data WebSocket (forex, gold, crypto, indices and synthetic indices such as Volatility 75/100 and
Boom/Crash 1000). No account, API key or login is needed. App ID 1089 is Deriv's public test ID — for heavy long-term use register your own free app ID
with Deriv and enter it in Settings. Brokers' own synthetics (e.g. Headway's Vol 80) are not on this feed; use the Deriv equivalents.
The instrument list in Settings is built from what the feed actually offers, so you can add any symbol it lists.

## Strategies (thresholds in `js/engine.js` DEFAULTS)
- **Shadow Entry** – wick ≥ 50% of range and ≥ 2× body, range ≥ 0.8 ATR; entry at the 50% retrace into the shadow; SL beyond the shadow; TP 1R/2R/3R.
- **Scalping** – EMA9 > EMA21 > EMA50 stack, pullback to EMA21, momentum candle breaking the previous high (mirrored for sells); tight SL; TP 1R/1.5R/2R. Best M1–M5.
- **ICT** – liquidity sweep → displacement/market-structure shift → entry in the FVG overlapping the 62–79% OTE zone; bonuses for discount/premium, London/New York killzone and higher-timeframe bias; TP 1.5R/2.5R/4R. Best M5–M15.
- **Price Action** – engulfing at support/resistance, break & retest, inside-bar breakout with trend filter; TP 1R/2R/3R. Best M15–H1.
- **News straddle** – 30 min before a HIGH-impact release, an OCO buy-stop/sell-stop (0.8 ATR out, SL 1.2 ATR, TP 1/2/3R). Synthetics ignore news.
- **Confidence (max 99)** adds evidence points (pattern quality, level, trend, momentum, higher timeframe, session); −10 inside a news blackout.
  Pending orders cancel if price breaks the SL or reaches TP1 unfilled, or after they expire. SL moves to entry after TP1.

## Honest limits
- **Scans only while the app is open on screen.** Phones freeze web apps in the background and web apps cannot push alerts when closed. Turn on *Keep screen awake* and leave it open (charging) to catch everything.
- Rule-based signals, **not backtested** and **not financial advice** — test on a demo account first. It shows signals; it does not place trades.
- Prices are single quotes (no spread); real broker fills differ slightly.
- The free news calendar may be blocked by your browser/network (then add events manually). Calendar and prices need internet; the app shell works offline.
- Verified here: the strategy engine matches the earlier tested Python reference exactly (buy and sell), signal lifecycle, news OCO, the Deriv message handling (against a simulated server: fallback, streaming, errors, reconnect), and every screen's logic.
  Not possible to test from here: a real connection to the live Deriv servers and real phone rendering — so open the app on your phone, check the status pill says LIVE, and compare a price with your broker.

## For developers
`npm test` (Node 20+) runs parity, integration and UI tests. `python3 tools/build_preview.py` makes a single-file demo build.
