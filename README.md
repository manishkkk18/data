# Delhi Smoke Watch

Whose smoke is Delhi breathing today? Farm-fire detections from NASA satellites,
winds, and Delhi's air quality. **Indicative, based on wind and fire detections.
Not a source-apportionment study.**

## Run the pipeline (Phase 1)

```bash
cp .env.example .env          # add FIRMS_MAP_KEY and OPENAQ_API_KEY
pip install -r pipeline/requirements.txt
cd pipeline
PYTHONPATH=. python -m smokewatch.run --days 7
PYTHONPATH=. python -m smokewatch.sanity_map   # -> pipeline/out/sanity_map.png
PYTHONPATH=. python -m pytest -q tests
```

Without `FIRMS_MAP_KEY` the pipeline falls back to FIRMS's public South Asia 7-day
files (dev only). Without `OPENAQ_API_KEY` air quality is skipped.

## Outputs (`data/`)
| file | what |
|---|---|
| `fires_recent.json` | each detection: lon, lat, time (UTC), FRP, confidence, satellite, day/night, district, state |
| `fires_summary_recent.json` | counts and FRP by state, top districts, daily counts per satellite |
| `aq_delhi_recent.json` | Delhi hourly and daily PM2.5/PM10 (gaps left as `null`) |
| `boundaries/districts.geojson` | study-area districts with state |
| `meta.json` | freshness timestamps |

## Key decisions
- **Detections, not fires.** One fire can be seen by several satellites; counts are pixel detections, not fires or area burned.
- **Year-over-year uses NOAA-20 only.** Suomi NPP stopped delivering data in Nov 2026 and NOAA-21 starts in 2023/24, so mixing sensors would inflate recent years. The live map uses all sensors.
- **Boundaries.** Districts: geoBoundaries gbOpen IND ADM2 (2021, LGD-based, ODbL). States: geoBoundaries ADM1 (DataMeet, 2011, CC BY 2.5 IN). Neither is an official Survey of India product. Fires within 2 km of a district edge are snapped to it; anything further out (Pakistan, Nepal) is "Outside India".
- **Air quality gaps are never filled.** A Delhi hour needs ≥3 stations, a day needs ≥18 hours.
- **Secrets** live only in `.env` (git-ignored) locally and in GitHub Actions secrets; the FIRMS key is masked in logs.
