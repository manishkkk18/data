"""One-off check: which OpenAQ locations in Delhi have archive PM2.5 for a sample day?

Prints every location in the Delhi bbox (monitors and others) with its provider, isMonitor
flag, active dates, and whether the public archive has PM2.5 for each sample day.
Usage (needs OPENAQ_API_KEY):  PYTHONPATH=. python -m smokewatch.diagnose_aq 2023-11-08 2024-11-09
"""
from __future__ import annotations

import gzip
import sys

import requests

from . import openaq
from .config import secret


def main() -> None:
    days = sys.argv[1:] or ["2022-11-05", "2023-11-08", "2024-11-09"]
    key = secret("OPENAQ_API_KEY")
    data = openaq._get("/locations", key, bbox=",".join(map(str, openaq.DELHI_BBOX)), limit=1000)
    locs = data.get("results", [])
    print(f"{len(locs)} locations in the Delhi bbox\n")
    print("| id | name | provider | isMonitor | first | last | PM2.5 sensor | " + " | ".join(days) + " |")
    print("|---|---|---|---|---|---|---|" + "---|" * len(days))
    s = requests.Session()
    for loc in sorted(locs, key=lambda x: x["id"]):
        has_pm = any((x.get("parameter") or {}).get("name") == "pm25" for x in loc.get("sensors", []))
        if not has_pm:
            continue
        cells = []
        for day in days:
            y, m, d = day.split("-")
            url = openaq.ARCHIVE.format(loc=loc["id"], y=y, m=int(m), ymd=f"{y}{m}{d}")
            r = s.get(url, timeout=60)
            if r.status_code != 200:
                cells.append("–")
                continue
            v, hours = openaq.archive_station_day(gzip.decompress(r.content).decode("utf-8"), day)
            cells.append(f"{v} ({hours} h)" if v is not None else f"short ({hours} h)")
        print(f"| {loc['id']} | {loc.get('name')} | {(loc.get('provider') or {}).get('name')} | {loc.get('isMonitor')} | "
              f"{((loc.get('datetimeFirst') or {}).get('utc') or '')[:10]} | {((loc.get('datetimeLast') or {}).get('utc') or '')[:10]} | yes | "
              + " | ".join(cells) + " |")


if __name__ == "__main__":
    main()
