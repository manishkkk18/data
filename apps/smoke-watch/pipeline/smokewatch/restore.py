"""Download the last published data from the live site into data/, before a run.

If a source fails in this run, its previous file stays in place (and run.py keeps its old
timestamp, marked stale) instead of disappearing from the site.
Usage (from pipeline/):  PYTHONPATH=. python -m smokewatch.restore https://<user>.github.io/<repo>
"""
from __future__ import annotations

import sys

import requests

from .config import CITIES, DATA

FILES = ["meta.json", "fires_summary_recent.json", "wind_recent.json", "cities.json"]


def main() -> None:
    site = sys.argv[1].rstrip("/")
    names = FILES + [f"aq/{c}.json" for c in CITIES] + [f"upwind/{c}.json" for c in CITIES]
    got = 0
    for name in names:
        try:
            r = requests.get(f"{site}/data/{name}", timeout=60)
            if r.status_code != 200:
                continue
            path = DATA / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(r.content)
            got += 1
        except requests.RequestException:
            pass
    print(f"restored {got} of {len(names)} published files")


if __name__ == "__main__":
    main()
