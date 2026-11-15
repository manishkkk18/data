#!/usr/bin/env bash
# Backfill 2015-01 .. 2026-10. Resumable: re-run this script after any interruption.
# Order: each October first (gives 1-year / 5-year / since-2015 comparisons early),
# then every remaining month.
set -u
cd "$(dirname "$0")"
PY="${PY:-C:/Users/ayush/.venvs/india-night-lights/Scripts/python}"
END="${END:-2026-10}"
for y in $(seq 2015 2024); do
  "$PY" -X utf8 -m nightlights.run --start "$y-10" --end "$y-10"
done
"$PY" -X utf8 -m nightlights.run --start 2015-01 --end "$END"
