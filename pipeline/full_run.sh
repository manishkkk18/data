#!/usr/bin/env bash
# Everything the site needs, in order. Resumable: re-run after any interruption and it
# skips work already done.
#   1. every month 2015-01 .. END (monthly map data)
#   2. months processed before quality flags were kept: re-fetch to add NASA estimates
#   3. NASA annual product 2015..last full year (yearly trend line, data/yearly.json)
#   4. ISRO Bhuvan cross-check
#   5. Diwali effect, all years
set -u
cd "$(dirname "$0")"
PY="${PY:-C:/Users/ayush/.venvs/india-night-lights/Scripts/python}"
END="${END:-2026-10}"
LAST_YEAR="${LAST_YEAR:-2025}"

echo "== 1. monthly backfill to $END"
"$PY" -X utf8 -m nightlights.run --start 2015-01 --end "$END"

echo "== 2. add NASA estimates to months cached before quality flags"
for csv in ../data/stats/VNP46A3/????-??.csv; do
  m=$(basename "$csv" .csv)
  if [ ! -f "../data/raw/india_monthly/VNP46A3_${m}_quality.tif" ]; then
    "$PY" -X utf8 -m nightlights.run --start "$m" --end "$m" --force
  fi
done

echo "== 3. annual product"
"$PY" -X utf8 -m nightlights.annual --start 2015 --end "$LAST_YEAR"

echo "== 4. Bhuvan cross-check"
"$PY" -X utf8 -m nightlights.crosscheck --refresh

echo "== 5. Diwali, all years"
"$PY" -X utf8 -m nightlights.diwali --years 2015-2026

echo "== done"
