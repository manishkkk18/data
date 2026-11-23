"""1b. Capital-goods imports from TradeStat (Department of Commerce, data by DGCI&S) -> .cache/trade/.

The "Import :: Commodity Wise" report, all commodities at the HS 4-digit level, one request per
financial year and unit (Rs crore, US$ million). Each year's table also carries the previous year;
we keep only the requested year's column. The page is a plain HTML form with a session token
(no bot check); requests are spaced out and cached, so a refresh only asks for missing years.

Output: .cache/trade/hs4_<unit>_<fy>.json  (list of {hs4, description, value})
"""
from __future__ import annotations

import http.cookiejar
import json
import re
import time
import urllib.parse
import urllib.request

from common import CACHE

URL = "https://tradestat.commerce.gov.in/eidb/commodity_wise_import"
UA = "Mozilla/5.0 (compatible; india-from-data-manufacturing/1.0; data pipeline)"
FIRST_FY = 2018            # 2018-19, the first year TradeStat's annual report offers
UNITS = {"inr_crore": "1", "usd_million": "2"}
OUT = CACHE / "trade"
OUT.mkdir(parents=True, exist_ok=True)


def opener():
    op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    op.addheaders = [("User-Agent", UA)]
    return op


def cells(row: str) -> list[str]:
    return [re.sub(r"<[^>]+>|\s+", " ", c).strip() for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row, re.S)]


def num(s: str):
    s = s.replace(",", "").strip()
    return float(s) if s and s not in ("-", "--") else None


def years_offered(page: str) -> list[int]:
    m = re.search(r'<select[^>]*name="Eidb_YearCwi".*?</select>', page, re.S)
    return sorted(int(v) for v in re.findall(r'value="(\d{4})"', m.group(0)))


def fetch_year(op, page: str, year: int, unit: str) -> list[dict]:
    tok = re.search(r'name="_token"[^>]*value="([^"]+)"', page).group(1)
    data = urllib.parse.urlencode({
        "_token": tok, "Eidb_YearCwi": str(year), "commodityType": "all", "Eidb_ComLevelCwi": "4",
        "Eidb_hscodeCwi": "", "Eidb_ReportCwi": UNITS[unit], "hscode_value": "", "description_value": "",
    }).encode()
    html = op.open(urllib.request.Request(URL, data=data, headers={"Referer": URL}), timeout=180).read().decode("utf-8", "ignore")
    rows = [cells(r) for r in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S)]
    head = next((r for r in rows if r and r[0].startswith("S.No")), None)
    if not head:
        raise RuntimeError(f"TradeStat {year} {unit}: no table in the response")
    fy = f"{year} - {year + 1}"
    col = head.index(fy)  # the requested year's value column
    out = []
    for r in rows:
        if len(r) == len(head) and re.fullmatch(r"\d{4}", r[1] or ""):
            out.append({"hs4": r[1], "description": r[2], "value": num(r[col])})
        elif r and r[0].startswith("India's Total Import"):
            out.append({"hs4": "TOTAL", "description": "India's total imports", "value": num(r[col - 2])})
    if len(out) < 500:
        raise RuntimeError(f"TradeStat {year} {unit}: only {len(out)} rows")
    return out


def main() -> None:
    op = opener()
    page = op.open(URL, timeout=60).read().decode("utf-8", "ignore")
    years = [y for y in years_offered(page) if y >= FIRST_FY]
    latest = max(years)
    for unit in UNITS:
        for y in years:
            f = OUT / f"hs4_{unit}_{y}-{str(y + 1)[2:]}.json"
            if f.exists() and y != latest:   # the latest year can still be partial: always refresh it
                continue
            rows = fetch_year(op, page, y, unit)
            f.write_text(json.dumps(rows), "utf-8")
            print(f"{f.name}: {len(rows)} HS4 rows")
            time.sleep(3)
            page = op.open(URL, timeout=60).read().decode("utf-8", "ignore")  # fresh token
    (OUT / "_meta.json").write_text(json.dumps({"years": years, "latest_may_be_partial": latest}), "utf-8")


if __name__ == "__main__":
    main()
