# ▮ SHIFT 2.0

**Regional intelligence terminal.** Mobile-first single-page web app, Bloomberg-terminal aesthetic, focused on the Gulf / GCC / MENA region. No AI slop — retrieval and citations only.

Live: **https://shift-2-0.vercel.app** (gated)

---

## What it does

- **News deck** from ~40 curated regional + global outlets, classified into `SECURITY / POLITICS / ECONOMY / AI` by keyword regex (no LLM)
- **Live markets ticker** — oil/energy (RTL infinite scroll), crypto + FX + indices (LTR infinite scroll) — RAF-driven, never visibly resets
- **Tactical map** — Leaflet + CartoDB dark, with eight toggleable overlays
- **GDELT 2.0 tension feed** — non-English headlines auto-translated via MyMemory
- **YouTube LIVE grid** — Bloomberg TV / Al Jazeera / France 24 / DW / TRT / NBC / Nat Geo, click-to-unmute
- **MARINE tab** — MarineTraffic AIS embed, Gulf-centered
- **UAE GOV tab** — auto-filtered to AE-government sources (WAM, MoD, MoI, MoFA, NCEMA, Forsan…)
- **THREAT WATCH** — UAE-scoped intercept tracker (drones / ballistic / cruise) with 24h Δ
- **Search bar** — retrieval-only across cached feeds + live GDELT, no LLM synthesis
- **Article modal** — every headline opens in a center-screen card before going external
- **Keyboard-driven** — hover the SHIFT brand for the full cheatsheet

---

## Map layers (toggleable in `☰ LYR`)

```
◯ HOMEBASE AIRPORTS           34 curated regional civil
◆ HOMEBASE MIL BASES          29 known military sites · NATO APP-6D icons
▲ OPENAIP AIRPORTS            ~286 live · military red, civil cyan
⬡ NAVAIDS · VOR/TACAN         ~152 live · ICAO hexagon glyph
◇ AIRSPACE · FIR/ADIZ/CTR     ~1150 polygons, z-ordered big→small
~ SUB CABLES                  FALCON · SEA-ME-WE-5 · I-ME-WE · GBI · AAE-1 · TEAMS
⛅ SIGMETs                     NOAA aviation weather hazards
◉ EARTHQUAKES 24h             USGS significant events
```

Plus: lat/lon graticule, chokepoint markers + range rings (Hormuz / Bab el-Mandeb / Suez / Bosphorus / Gibraltar), engagement bbox, HUD overlays (TAC count, UTC clock, MGRS cursor readout), AIR/SEA/FR24 toggle bottom-right, plane tracks with altitude-banded fading trails, dead-reckoning between AirLabs fetches.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  static SPA      index.html · styles.css · app.js · *.svg   │
└─────────────────────────────────────────────────────────────┘
         │
         ▼  fetch
┌─────────────────────────────────────────────────────────────┐
│  Vercel Edge Functions  (api/*.js, runtime: 'edge')         │
│    /api/news       RSS proxy (browser-UA, edge cache)       │
│    /api/markets    Yahoo Finance → Stooq fallback           │
│    /api/fx         Frankfurter → ExchangeHost + GCC pegs    │
│    /api/oil        OilPriceAPI                              │
│    /api/aircraft   adsb.one → adsb.lol → adsb.fi → live     │
│                    AirLabs primary when AIRLABS_API_KEY set │
│    /api/airspace   OpenAIP airspaces (pos+dist, paginated)  │
│    /api/airports   OpenAIP airports                         │
│    /api/navaids    OpenAIP navaids (VOR/TACAN/VORTAC)       │
│    /api/oil        OilPriceAPI                              │
│    middleware.js   SHA-256 cookie gate on every request     │
└─────────────────────────────────────────────────────────────┘
```

**Why edge functions:**
- API keys never reach the browser
- Shared edge cache → fewer upstream calls (single user can stay inside AirLabs 1000/mo and OilPriceAPI 300/mo)
- Vercel can reach domains a browser can't (e.g. Yahoo Finance v8 chart without bot detection)

---

## Required env vars (set via `vercel env add`)

| Name | Tier | Source |
|---|---|---|
| `SHIFT_PASSWORD_HASH` | required | SHA-256 of the gate passphrase |
| `AIRLABS_API_KEY` | optional (recommended) | https://airlabs.co/signup · 1000/mo free |
| `OILPRICE_API_KEY` | optional | https://oilpriceapi.com · 300/mo free |
| `OPENAIP_API_KEY` | optional | https://www.openaip.net · free dev access |
| `OPENSKY_USER` / `OPENSKY_PASS` | optional | https://opensky-network.org · 4000/day with auth |

Without optional keys: graceful degradation — markets fall back to Yahoo direct, aircraft to community ADS-B feeders, airspace/airports/navaids layers are simply omitted.

---

## Data sources

**News (RSS via /api/news):**
Al Jazeera EN · Times of Israel · Jerusalem Post · The National UAE · The National MENA · Ynetnews · Haaretz EN · i24NEWS · Israel Hayom · Globes · Israel National News · Arab News · Khaleej Times · BBC Middle East · Reuters MENA · Al Arabiya (AR, translated) · NYT World/Business · WSJ World/Markets · CNN Top/World · Bloomberg · Reuters US · AP · S&P 500/Fed · WHO · UN News · DOD News · State Dept · The Diplomat · Stratfor · Reddit r/worldnews / r/MiddleEastNews / r/geopolitics / r/syriancivilwar · TechCrunch AI · The Verge AI · MIT Tech Review · WAM · UAE MoD · UAE MoI · UAE MoFA · UAEGov · NCEMA · Abu Dhabi Police · Dubai Police · UAE Barq · Forsan UAE

**Markets:** Yahoo Finance · Stooq CSV · Frankfurter (with GCC pegs) · CoinGecko · OilPriceAPI
**Aviation:** adsb.lol / adsb.one / adsb.fi / airplanes.live / AirLabs · Flightradar24 (iframe) · OpenAIP
**Maritime:** MarineTraffic (iframe) · OpenSeaMap (tiles)
**Geophysical:** USGS earthquakes · NOAA aviation weather SIGMETs
**Comms infrastructure:** TeleGeography submarine cables (curated subset)
**Tension feed:** GDELT 2.0 (auto-translated)
**Translation:** MyMemory (free anon tier, cached in localStorage)

---

## Local development

```bash
git clone https://github.com/ringgroup/shift-2.0.git
cd shift-2.0
python3 -m http.server 8080         # or any static server
# open http://localhost:8080
```

Edge-function endpoints (`/api/*`) won't work locally without `vercel dev`. For full local stack:

```bash
npm i -g vercel
vercel dev
```

Then drop env vars into `.env.local` (gitignored).

---

## Deploy your own fork

```bash
vercel link                                          # link to your Vercel project
echo -n "$(your-passphrase)" | shasum -a 256        # generate gate hash
vercel env add SHIFT_PASSWORD_HASH production       # paste the hash
vercel deploy --prod
```

Optional keys (`AIRLABS_API_KEY` etc.) added the same way.

---

## Stack

- **HTML/CSS/JS** — vanilla, no framework, no build step
- **Leaflet 1.9.4** — map (loaded via unpkg CDN)
- **milsymbol 2.2.0** — NATO APP-6D icons (CDN)
- **mgrs** — MGRS grid conversion (CDN)
- **Vercel Edge Runtime** — for all `/api/*` functions and `middleware.js`
- **Vercel Hobby plan** — free tier, ~5 cron-job quota, 1MB middleware size limit

No npm dependencies in the static layer. Edge functions use only the Web Fetch API + standard runtime globals.

---

## File map

```
/index.html                  shell, header, tabs, sections, modal, help overlay
/styles.css                  Bloomberg-terminal palette + responsive layout
/app.js                      ~2.5k lines · all data fetching + rendering + RAF loop
/middleware.js               Vercel Edge Middleware · SHA-256 cookie gate
/api/news.js                 RSS proxy (browser-UA)
/api/markets.js              Yahoo Finance + Stooq
/api/fx.js                   Frankfurter + GCC pegs
/api/oil.js                  OilPriceAPI
/api/aircraft.js             ADS-B fallback chain
/api/airspace.js             OpenAIP airspaces · pos+dist + pagination
/api/airports.js             OpenAIP airports
/api/navaids.js              OpenAIP navaids
/favicon.svg                 mil-spec brackets + S glyph + status dot
/og.svg                      1200x630 link-preview card
/vercel.json                 cache headers, cleanUrls
/package.json                "type": "module" — Edge runtime expects ESM
```

---

## Design conventions

- **Black + amber primary**, green up / red down, cyan secondary, violet AI, magenta chokepoints
- **JetBrains Mono / IBM Plex Mono / Menlo** monospace throughout
- **No emojis** in source files unless explicitly requested
- **No LLM-generated text** displayed to the user
- **Mobile-first** — tested 360px viewport up to 2K desktop

---

## Status

- Production: live, behind SHA-256 cookie gate
- Last major work: SITAWARE map layers from OpenAIP, ticker RAF carousel, threat-watch UAE-scoping
- Subagent-assisted research drove most cartography decisions

---

## License

Private project. Code is MIT-spirit for non-commercial reuse. Third-party data is subject to each source's own license (OpenAIP `CC BY-NC-SA 4.0`, ECB FX `public domain`, GDELT `Creative Commons`, OilPriceAPI / AirLabs / Yahoo Finance per their respective terms).
