# India Night Lights: data pipeline

Turns NASA Black Marble night-light rasters into small static files the web app reads:

| File | What | Size |
|---|---|---|
| `data/districts.geojson` | 735 district outlines, simplified (~1 km), with `id`, `name`, `state` | ~1.9 MB (~0.4 MB gzipped) |
| `data/india_outline.geojson` | National outline, drawn over the basemap's own borders | ~0.1 MB |
| `data/monthly.json` | Per-district monthly stats, column-oriented, `null` = gap | grows ~25 KB/month |
| `data/stats/VNP46A3/YYYY-MM.csv` | One checkpoint per finished month (what makes runs resumable) | ~60 KB each |

## One-time setup (Windows)

The session folder path is too long for pip on Windows, so the virtual environment lives at a short path:

```bash
python -m venv --without-pip C:/Users/<you>/.venvs/india-night-lights
python -m pip --python C:/Users/<you>/.venvs/india-night-lights/Scripts/python.exe install -r pipeline/requirements.txt
```

On macOS/Linux a normal `python -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt` works.

Then create `.env` at the repo root (copy `.env.example`) and paste your token from
https://urs.earthdata.nasa.gov/profile → *Generate Token*:

```
EARTHDATA_TOKEN=eyJ...
```

The token is only read from `.env` and passed to NASA in a request header; it is never printed or logged.

## Run

All commands from the `pipeline/` folder, using the venv's Python (`PY=C:/Users/<you>/.venvs/india-night-lights/Scripts/python`).

```bash
# 1. Boundaries (downloads geoBoundaries once, ~95 MB, cached in data/raw/boundaries)
$PY -X utf8 -m nightlights.boundaries

# 2. One month, with a sanity-check map in data/qa/
$PY -X utf8 -m nightlights.run --start 2025-10 --end 2025-10 --qa

# 3. Backfill (resumable: re-run after a crash or Ctrl-C). Does each October first,
#    so year-on-year comparisons work early, then every month. 4 downloads in parallel.
bash backfill.sh

# 4. Yearly averages from NASA's annual product (VNP46A4) for the long-term trend line.
#    ~1.1 GB per year; run after the monthly backfill. Writes data/yearly.json.
$PY -X utf8 -m nightlights.annual --start 2015 --end 2025

# Tests
$PY -X utf8 -m pytest -q
```

`-X utf8` is needed on Windows because district names contain characters like "ā".

Options: `--force` recomputes months that already have a CSV; `--keep-raw` keeps NASA's HDF5 files.

## How it works

1. **Download** the 11 Black Marble tiles covering India for the month (VNP46A3, Collection 2) with
   `blackmarblepy`, which stitches and clips them to India.
2. **Cache** just the one layer we use (`NearNadir_Composite_Snow_Free`) as a compressed India GeoTIFF
   in `data/raw/india_monthly/` (radiance ×10 as uint16, lossless because NASA stores it in 0.1 steps).
   The raw download is ~1 GB per month, so it is deleted after the month succeeds unless `--keep-raw`
   is set. Re-running a month re-uses the cache, so no download is needed.
3. **Zonal stats** per district with `exactextract` (`nightlights/zonal.py`), weighting edge pixels by
   how much of them falls inside the district.
4. **Checkpoint** each month to its own CSV. Failed months go to `data/stats/VNP46A3/failures.json`
   and are retried next run; the rest carry on.
5. **Combine** all CSVs into `data/monthly.json`.

## Stats and the decisions behind them

| Field | Meaning |
|---|---|
| `mean_rad` | Average radiance (nW/cm²/sr) over observed pixels |
| `sum_rad` | Sum of radiance over observed pixels ("sum of lights"), favours big districts |
| `lit_pct` | % of observed pixels ≥ 1 nW/cm²/sr (above the sensor's noise floor of ~0.3–0.5) |
| `valid_pct` | % of the district actually observed that month |

- **No silent interpolation.** NASA's monthly product fills some cloudy pixels "based on historical
  data" (quality flag 2). We drop those along with fill values (flag 255), so they count as unobserved.
- **Gaps are gaps.** If under 50% of a district was observed, its values are `null` and `valid_pct`
  says why. Expect this in monsoon months (June–September) over the northeast and the Western Ghats.
- **Snow-free composite.** We use NASA's snow-free layer so winter snow in the Himalayas doesn't read
  as light. Those districts may have more gaps in winter.
- **Boundaries** are geoBoundaries gbOpen IND (from the Local Government Directory via Pathways Data,
  2021 vintage, ODbL). Its national outline follows India's official map. 735 districts: districts
  created after 2021 are counted within their parent district.
  IDs are `state--district` slugs, e.g. `karnataka--bangalore`.

## Known caveats

- Suomi NPP (the satellite behind VNP46) is ageing; NASA may move monthly products to NOAA-20/21. Watch
  for a level shift when that happens.
- Night lights track electrification and urban activity, but also gas flares, fishing fleets, and
  festivals. Treat them as a proxy, not a measure of GDP.
