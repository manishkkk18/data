"""Shared paths and helpers for the Manufacturing pipeline (Python standard library only)."""
from __future__ import annotations

import json
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent                  # apps/manufacturing-insights/
DATA = ROOT / "data"                   # what the page reads
CACHE = SCRIPTS / ".cache"             # raw API pages (gitignored, re-fetchable)
DATA.mkdir(exist_ok=True)
CACHE.mkdir(exist_ok=True)

API = "https://api.mospi.gov.in/api"   # MoSPI eSankhyiki API (no key needed)
UA = {"User-Agent": "india-from-data-manufacturing/1.0 (data pipeline)"}
PAGE = 200                             # the API's maximum page size


def get_json(url: str, retries: int = 6) -> dict:
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            last = e
            time.sleep(30 * (i + 1) if e.code == 429 else 3 * (i + 1))  # 429: the API rate-limits bursts
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (i + 1))
    raise RuntimeError(f"{url}: {last}")


def download(url: str, dest: Path) -> Path:
    """A whole file, cached at dest (delete it to fetch again)."""
    if not dest.exists():
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=300) as r:
            dest.write_bytes(r.read())
    return dest


def fetch_all(endpoint: str, params: dict, name: str, workers: int = 2) -> list[dict]:
    """Every row of a paged endpoint, each page cached as .cache/<name>/<n>.json.

    The first page is always re-fetched (it says how many pages there are now), so a refresh
    picks up new months; delete .cache/<name>/ to re-download everything.
    """
    folder = CACHE / name
    folder.mkdir(parents=True, exist_ok=True)

    def url(page: int) -> str:
        return f"{API}/{endpoint}?" + urllib.parse.urlencode({**params, "limit": PAGE, "page": page})

    first = get_json(url(1))
    if "data" not in first:
        raise RuntimeError(f"{endpoint} {params}: {first}")
    pages = int(first["meta_data"]["totalPages"])
    total = int(first["meta_data"]["totalRecords"])
    (folder / "1.json").write_text(json.dumps(first["data"]), "utf-8")
    meta = folder / "_meta.json"
    old = json.loads(meta.read_text("utf-8")) if meta.exists() else None
    if old != {"total": total, "pages": pages}:  # the data changed: page contents shift, refetch all
        for f in folder.glob("[0-9]*.json"):
            if f.name != "1.json":
                f.unlink()
    meta.write_text(json.dumps({"total": total, "pages": pages}), "utf-8")

    def one(p: int) -> list[dict]:
        f = folder / f"{p}.json"
        if f.exists():
            return json.loads(f.read_text("utf-8"))
        rows = get_json(url(p)).get("data")
        if rows is None:
            raise RuntimeError(f"{name} page {p}: no data")
        f.write_text(json.dumps(rows), "utf-8")
        return rows

    with ThreadPoolExecutor(workers) as ex:
        rest = list(ex.map(one, range(2, pages + 1)))
    rows = first["data"] + [r for page in rest for r in page]
    if len(rows) != total:
        raise RuntimeError(f"{name}: got {len(rows)} rows, API says {total}")
    print(f"{name}: {len(rows):,} rows in {pages} pages")
    return rows


def write(name: str, obj) -> None:
    p = DATA / name
    p.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), "utf-8")
    print(f"wrote data/{name} ({p.stat().st_size / 1024:.1f} KB)")


MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December"]


def fy_of(year: int, month: int) -> str:
    """Indian fiscal year (April-March) of a calendar month, e.g. (2024, 2) -> '2023-24'."""
    start = year if month >= 4 else year - 1
    return f"{start}-{str(start + 1)[2:]}"
