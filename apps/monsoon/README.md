# The Monsoon, District by District

**Did the 2026 monsoon show up for your district?** A season retrospective: weekly
cumulative rainfall against normal for every district, when the rains arrived, and what
it meant for kharif sowing.

Live: https://manishkkk18.github.io/data/india/monsoon/

A static site (HTML + CSS + D3, no build step) in the India-from-data monorepo.
`scripts/build-site.sh` copies it (without `scripts/`) to `_site/india/monsoon/`, so it is
published with every deploy of the site; its data is committed here and changes only when
you rerun the pipeline below.

```
apps/monsoon/
  index.html  favicon.svg  og.png
  css/monsoon.css            all styling (tokens at the top)
  js/                        main.js, map.js, district.js, onset.js, sowing.js, common.js
  vendor/                    d3 7.9.0, topojson-client 3.1.0 (pinned copies)
  data/                      static JSON the page reads (written by scripts/)
  scripts/                   the data pipeline (Python)
```

## Refreshing the data

Needs Python 3.11+ and Node (for `npx mapshaper`). From `apps/monsoon/scripts/`:

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # macOS/Linux: .venv/bin/pip
.venv/Scripts/python build_boundaries.py   # 1. geoBoundaries districts + states
.venv/Scripts/python fetch_grid.py         # 2. IMD gridded rain 1971-2025 + 2026 real-time (~1.4 GB, slow server; resumable)
.venv/Scripts/python imd_names.py          # 3. IMD district names -> map districts (+ search aliases)
.venv/Scripts/python build_topo.py         # 4. simplified TopoJSON for the browser
.venv/Scripts/python aggregate.py          # 5. district / state / India series and weekly departures
.venv/Scripts/python onset.py              # 6. monsoon advance lines and city arrival dates
.venv/Scripts/python sowing.py             # 7. kharif sowing from PIB releases
.venv/Scripts/python verify.py             # 8. compare with IMD's published figures -> data/meta.json
```

Downloads are cached in `scripts/.cache/` (gitignored), so re-runs only fetch what's
missing. Then commit `apps/monsoon/data/` and push to `main`: the Build and deploy site workflow
publishes it.

**For a new season** (e.g. 2027): set `THIS_YEAR` and `HISTORY` in `aggregate.py`,
`START`/`END`/`COVERED_ALL` in `onset.py`, the release ids in `sowing.py`, add the new
IMD "Salient Features" PDF and Wayback snapshots to `scripts/.cache/imd/`, and update the
hero/OG text in `index.html`.

### Before you trust a refresh

`verify.py` prints the checks shown on the page:

* all-India season and monthly % of normal against IMD's Salient Features report;
* district departures against IMD's own (station-based) district table, from Wayback
  Machine snapshots of `DISTRICT_RAINFALL_DISTRIBUTION_COUNTRY_INDIA_cd.pdf`.

If these drift apart, look before publishing.

### Which numbers the page shows

* **The season result** (map default view, the headline on every district card, the sowing
  chart's state rainfall, the home-page card) is **IMD's own rain-gauge figure**, from its
  district table (`data/imd_districts.json`, written by `verify.py`). The last copy archived
  during the season runs to 24 Sep; it covers 701 of the 735 map districts.
* **The weekly view** (map animation, the weekly line on each card) and **2021–2025** come from
  IMD's 0.25° gridded rainfall. Past years use IMD's final, quality-checked grids; 2026 can only
  use the real-time grid, which is built from far fewer gauges.

Why: the 2026 real-time grid agrees with IMD for India as a whole (756 mm of rain vs IMD's 759 mm)
but not district by district. Against IMD's 24 Sep table only two-thirds of districts land in
the same category, and 113 are 25+ points off (Satara: −38% from the grid, +20% from IMD's
gauges), mostly where rain changes sharply over short distances (Western Ghats, northeastern
hills, Ladakh). Those districts get a dashed outline in the weekly view and a warning on their
card. When IMD publishes its final 2026 grid, rerun the pipeline with it to tighten the weekly view.

## Sources

| What | Source | Notes |
|---|---|---|
| District rainfall, normals, history | IMD Pune 0.25° gridded daily rainfall (Pai et al. 2014): [final 1901–2025](https://imdpune.gov.in/cmpg/Griddata/Rainfall_25_NetCDF.html), real-time 2026 | IMD's weekly district PDFs are overwritten weekly and not archived, so they can't give a 2026 week-by-week series. Normal = 1971–2020. |
| Official season totals | [IMD Salient Features of the 2026 SW Monsoon](https://mausam.imd.gov.in/Forecast/marquee_data/Salient_Features_SW_MONSOON%20_2026_30_sep.pdf) | headline 87% of LPA |
| District season results, state totals | IMD district rainfall PDF (`DISTRICT_RAINFALL_DISTRIBUTION_COUNTRY_INDIA_cd.pdf`) via the Wayback Machine, 29 Jul – 24 Sep snapshots | the season figure the page leads with; also used to check the grid |
| Monsoon advance | IMD daily [press releases](https://internal.imd.gov.in/pages/press_release_mausam.php) ("Northern Limit of Monsoon passes through …") | places geocoded once with OpenStreetMap Nominatim, cached in `scripts/geocode_cache.json` |
| Normal onset dates | [IMD CRS Research Report 3/2020](https://internal.imd.gov.in/press_release/20200515_pr_804.pdf), Table 2 (1961–2019 normals, 135 cities parsed) | IMD's normal isochrones exist only as a map figure, so they are shown as city dates |
| Kharif sowing | Agriculture Ministry weekly area reports via PIB ([4 Sep 2026](https://www.pib.gov.in/PressReleasePage.aspx?PRID=2307791)) | the state-wise table (agriwelfare.gov.in / UPAG) was unreachable; only states each release names are used, others are missing, not zero |
| Boundaries | [geoBoundaries](https://www.geoboundaries.org/) gbOpen IND ADM2 (2021, LGD), ODbL 1.0 | simplified with mapshaper 0.7.101 |

## District names

IMD lists 740 districts; the 2021 map has 735. `scripts/name_overrides.csv` is the
hand-checked table for spellings, renamings (Allahabad → Prayagraj, Osmanabad → Dharashiv)
and districts created after 2021, which have no shape of their own and point to the
district they were carved from (`parent_id`). The full result is `data/name_mapping.csv`;
`imd_names.py` stops with an error if an id in the overrides doesn't exist on the map.

## Design notes

Light "monsoon paper" theme: warm paper, ink-blue type, teal for rain, ochre/brown for
deficit. Fraunces (headlines) and Source Sans 3 (interface). The map uses IMD's six
categories on a diverging brown–teal scale centred on a pale "normal"; it was checked with
a colour-vision simulator (every pair of colours stays distinguishable, worst ΔE 15.7), and
"no rain" and "no data" also carry hatching. D3 + SVG rather than a tile map: 735 polygons
recoloured per week is light work, there's no basemap to load, and pinch-zoom works on phones.
