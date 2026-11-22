# Is India Actually Becoming a Factory?

**Is Make in India visible in the data?** Factory output, jobs and productivity, industry by
industry and state by state, from MoSPI's Index of Industrial Production (IIP) and Annual
Survey of Industries (ASI).

Live: https://manishkkk18.github.io/data/india/manufacturing-insights/

A static site (HTML + CSS + D3, no build step) in the India-from-data monorepo, like
`apps/monsoon`. `scripts/build-site.sh` copies it (without `scripts/`) to
`_site/india/manufacturing-insights/` and adds the shared support card, so it is published with
every deploy. Its data is committed here and changes only when you rerun the pipeline below.

```
apps/manufacturing-insights/
  index.html  favicon.svg
  css/factory.css            all styling ("industrial blueprint"; colour tokens at the top)
  js/                        main.js (hero, verdict, method), pulse.js, sectors.js, map.js, scatter.js, common.js
  vendor/                    d3 7.9.0, topojson-client 3.1.0 (the same pinned copies as Monsoon)
  data/                      static JSON the page reads (written by scripts/)
  scripts/                   the data pipeline (Python)
```

The share image (`/india/og/manufacturing-insights.jpg`) and the home-page card thumbnails live
with the home page, in `apps/home/public/og/` and `apps/home/public/img/`.

## Refreshing the data

Needs Python 3.11+ and Node (for `npx mapshaper`, boundaries only). From
`apps/manufacturing-insights/scripts/`:

```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # macOS/Linux: .venv/bin/pip
.venv/Scripts/python fetch.py        # 1. IIP, ASI (MoSPI eSankhyiki API) + WPI workbook (OEA) -> .cache/
.venv/Scripts/python boundaries.py   # 2. states TopoJSON from apps/monsoon's (only if boundaries change)
.venv/Scripts/python build.py        # 3. data/iip.json, data/asi.json
.venv/Scripts/python verify.py       # 4. compare with MoSPI's published figures -> data/meta.json
```

Then look at the page locally (see "Testing" below), commit `apps/manufacturing-insights/data/`,
and push to `main`: the "Build and deploy site" workflow publishes it.

`fetch.py` caches every API page in `scripts/.cache/` (gitignored). It re-fetches page 1 of each
series every run; if the record count changed, it re-downloads that series. To force a clean
download, delete `scripts/.cache/`. The API returns at most 200 rows a page and rate-limits bursts
(HTTP 429); the script waits and retries, so a full download takes a few minutes.

### Every month: IIP

MoSPI releases the IIP quick estimate on the 28th (the month before last), and revises the
previous months at the same time.

1. Run `fetch.py`, `build.py`.
2. In `verify.py`, replace the IIP checks with the newest press release's figures (General index
   and growth, Manufacturing growth): add the PIB/MoSPI link. Older months turning "revised" is
   expected.
3. Run `verify.py`. It stops if anything other than a quick-estimate revision disagrees.
4. The hero's "this year so far", the pulse chart and the home-page card update themselves.
   In April, the new financial year starts: the sector cards move to the next full year
   automatically once MoSPI publishes it in the annual IIP data.

### Every year: ASI and WPI

ASI results for a financial year come out roughly 15 to 18 months after it ends, and reach
eSankhyiki's state x industry data some time after the press note.

1. Check `https://api.mospi.gov.in/api/asi/getAsiFilter?classification_year=2008`: is the new
   year listed? (In Nov 2026 the API stops at 2023-24 even though ASI 2024-25 headline results
   came out on 30 Sep 2026; the page says so in its method notes.)
2. WPI: delete `scripts/.cache/wpi_fin_year_index.xls` so the newest workbook is downloaded. The
   build stops if WPI has no figure for the latest ASI year.
3. Run `fetch.py`, `build.py`, then update `verify.py`: the new ASI year's factories, persons
   engaged and GVA growth from MoSPI's press note, and `asi_newer_note` / `asi_2024_25_headline`
   in `meta`. The verdict card quoting the "following year" uses those figures; reword it if the
   next ASI year is now the latest.
4. Read the verdict cards and section ledes on the page against the new numbers. They are filled
   in from the data, but their wording ("slow gains", "Too early to call") is a judgment and
   should still fit.

### When MoSPI changes something

* **A new IIP base year or linking factors:** update `LINK`, `LINK_SOURCE` and `NEW_FROM` in
  `build.py`. Never join series without an official factor; below the sector level, keep each
  base year separate (as the sector cards do now).
* **New state names or splits in ASI:** `build.py` stops with "ASI states not mapped". Add the
  name to `ASI_TO_MAP`, and if a state was split, decide how growth is handled (see the J&K +
  Ladakh rule) and say so in the page's method notes.
* **Renamed IIP industry groups:** `build.py` stops naming the group; update `IIP_NAME_TO_NIC`.

## Which numbers the page shows

* **Monthly output** (`iip.json` `monthly`): Manufacturing, Mining, Electricity, General. Before
  April 2023, the 2011-12 index divided by MoSPI's official linking factor (PIB, 1 June 2026:
  Manufacturing 1.3700, Mining 1.1890, Electricity 1.8495, General 1.3834); from April 2023, the
  2022-23 series. Growth is MoSPI's own year-on-year rate for the series in force.
* **Sector cards** (`sectors`): NIC 2-digit indices. "Since 2013-14" is the 2011-12 series only;
  "Since 2022-23" is the 2022-23 series only. They are never joined (MoSPI publishes no factor
  below the sector level).
* **States, scatter, jobs** (`asi.json`): ASI "all industries" (code 99999) per state, NIC 2008,
  combined rural + urban. Real values = nominal / (WPI Manufactured products, base 2011-12,
  financial-year average / 100). Growth is the compound annual rate from 2013-14 (the year before
  Make in India) to the latest ASI year.
* **State changes:** Telangana separate from 2012-13; J&K and Ladakh combined for growth; Dadra &
  Nagar Haveli and Daman & Diu summed before the 2020 merger; no growth figure (hatched) where ASI
  has no 2013-14 value: Arunachal Pradesh, Mizoram, Lakshadweep.
* **PLI tags:** each Production Linked Incentive scheme placed in the NIC group where most of it
  falls (`PLI` in `build.py`). Electronics (26) and pharma (21) are highlighted.

## Testing

Serve a copy under the real `/data/india/` path, e.g. run `bash scripts/build-site.sh` from the
repo root and then `python -m http.server 4321` in `_site/`, and open
http://127.0.0.1:4321/data/india/manufacturing-insights/. Check at phone width (375px) too: the
state panel becomes a bottom sheet, and chart tooltips open on tap.

To redo the share image and the home-page card thumbnail after a visual change, with that
server running: `cd apps/home && SITE=http://127.0.0.1:4321/data/india ONLY=manufacturing-insights npm run capture`.

## Colours

Light theme only, like Monsoon. Palettes were checked with a colourblind-simulation validator:
the three IIP sector colours (orange, blue, teal; worst pair under colour-vision deficiency
ΔE 14.5), the one-hue steel-blue map ramp, and the purple/grey/teal growth scale. States with no
data are hatched, not coloured.
