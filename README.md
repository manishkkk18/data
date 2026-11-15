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

## Deploy (Vercel)

Import the repo in Vercel and set **Root Directory** to `web`. The framework preset (Vite) supplies
`npm run build` and the `dist` output folder.

## Credits

Night lights: NASA Black Marble (VNP46A3). Districts: geoBoundaries (LGD via Pathways Data, ODbL).
Basemap: OpenFreeMap, © OpenMapTiles, © OpenStreetMap contributors.
