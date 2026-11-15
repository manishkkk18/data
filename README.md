# India Night Lights

How bright each Indian district is at night, month by month, from NASA Black Marble satellite data.
Night-time brightness is a rough proxy for economic activity, electrification and urban growth.

- `pipeline/`: Python. Downloads NASA data and writes small static files to `data/`. See [pipeline/README.md](pipeline/README.md).
- `web/`: Vite + React + TypeScript + MapLibre. Reads only the static files; no backend.

## Run the web app

Needs Node.js 22+.

```bash
cd web
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in web/dist
```

`npm run dev` and `npm run build` first copy `data/districts.geojson`, `data/india_outline.geojson` and
`data/monthly.json` into `web/public/data/`.

## Deploy (GitHub Pages)

The site lives at https://manishkkk18.github.io/india-night-lights/ and is served from the `gh-pages`
branch. To publish by hand:

```bash
cd web
npm run deploy
```

## Monthly refresh (GitHub Action)

`.github/workflows/refresh.yml` runs on the 18th of each month (and on demand from the Actions tab).
It processes the most recent three months that don't have data yet, refreshes the Bhuvan cross-check,
commits the small output files and redeploys the site. Raw NASA files never touch the repo.

One-time setup:

1. Add the NASA token as a repository secret named `EARTHDATA_TOKEN`
   (GitHub → repo → Settings → Secrets and variables → Actions → New repository secret).
2. Run it once by hand: Actions → "Monthly data refresh" → Run workflow.

District boundaries are pinned to geoBoundaries release `9469f09`, so automated runs can never
change district IDs.

## Credits

Night lights: NASA Black Marble (VNP46A3). Districts: geoBoundaries (LGD via Pathways Data, ODbL).
Basemap: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors.
