# Delhi Smoke Watch

Whose smoke is Delhi breathing today? Farm-fire detections from NASA satellites, winds,
the air's path into Delhi and Delhi's air quality, live during the burning season and
compared across years. **Indicative, based on wind and fire detections. Not a
source-apportionment study.**

Live site: https://manishkkk18.github.io/delhi-smoke-watch/

## How it runs

| Workflow | When | What |
|---|---|---|
| **Refresh** (`refresh.yml`) | every 3 h, 15 Sep – 15 Dec (IST); daily at 08:47 IST otherwise | live data → deploy to GitHub Pages; current season rebuilt daily |
| Backfill seasons (`seasons.yml`) | by hand | builds 2020 onward; `pm25_only` redoes air quality only |
| Run pipeline (`pipeline.yml`) | by hand | test run with a summary and downloadable data; `diagnose_aq` lists OpenAQ locations |

Secrets (Settings → Secrets and variables → Actions): `FIRMS_MAP_KEY`, `OPENAQ_API_KEY`.

The live files (`data/*.json`) are never committed: Refresh builds them and deploys them
straight to the `gh-pages` branch (one commit, so the repo doesn't grow). Committed data:
boundaries, `data/seasons/` (updated daily in season) and `data/status.json` (daily
heartbeat, which also keeps GitHub from pausing the schedule). If a source fails, the last
published file is kept and marked stale; if NASA FIRMS fails completely, nothing is deployed.

## Local development

```bash
cd pipeline
pip install -r requirements.txt
PYTHONPATH=. python -m smokewatch.run --days 7    # without keys: public FIRMS 7-day file, no air quality
PYTHONPATH=. python -m pytest -q tests
cd ../web
npm install
npm run dev                                       # http://localhost:5173
npm run deploy                                    # build and publish by hand
```

With a `.env` (copy `.env.example`) the pipeline uses the real APIs locally too.

## Key decisions
- **Detections, not fires.** One fire can be seen by several satellites; counts are pixel detections, not fires or area burned.
- **Year-on-year uses NOAA-20 only.** Suomi NPP stopped in Nov 2026 and NOAA-21 starts in 2023/24, so mixing sensors would inflate recent years. The live map uses all sensors.
- **Burning has moved later in the day** (ISRO/Current Science 2025; NASA Earth Observatory), so detections likely undercount more than before.
- **Delhi PM2.5**: reference monitors via OpenAQ; days OpenAQ's API lacks are rebuilt from its public archive; mid-Oct 2022 – 2024 has no government-monitor data in OpenAQ, so those days use the US Embassy monitor alone, labelled (r = 0.98 with the city average, ~8% lower). Gaps are never filled.
- **Boundaries.** Districts: geoBoundaries gbOpen IND ADM2 (2021, LGD-based, ODbL); India's outline follows the official national outline; the basemap's OSM borders are hidden.
- **Design** copied from India Night Lights (styles, components), with a fire scale used only for fire data and AQI band colours always next to their names.
