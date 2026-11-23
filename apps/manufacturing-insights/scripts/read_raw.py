"""Read the hand-downloaded official files in raw/ (their publishers' servers block scripts).

  raw/rbi_credit/*.xlsx   RBI "Sectoral Deployment of Bank Credit", Statement 2 (industry-wise).
                          Each file holds outstanding credit for five dates; we keep the September
                          figures, so four files give six Septembers. A later file wins for any date.
  raw/rbi_obicus/*.xlsx   RBI OBICUS: capacity utilisation, every quarter since 2008-09 (raw + seasonally adjusted).
  raw/dpiit_fdi/fdi_sector_yearwise_*.pdf
                          DPIIT Table 4 "Sector-wise/year-wise FDI equity inflow": US$ million by
                          CALENDAR year (2000-2022 combined, then 2023, 2024, 2025, part of the current year).

Every category name in these files must have a row in mapping/industry_map.csv (RBI by its code,
DPIIT by name ignoring spaces and punctuation); an unknown name stops the build.
"""
from __future__ import annotations

import csv
import re
from collections import defaultdict
from datetime import datetime
from pathlib import Path

from common import SCRIPTS

RAW = SCRIPTS / "raw"
MAP = SCRIPTS / "mapping" / "industry_map.csv"


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower().replace("including", "incl").replace("incl", "including"))


def mapping(source):
    return [r for r in csv.DictReader(MAP.open(encoding="utf-8")) if r["source"] == source]


def num(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace(",", "").strip()
    return float(s) if re.fullmatch(r"-?\d+(\.\d+)?", s) else None


# ------------------------------------------------------------------ RBI credit
def credit():
    import openpyxl
    files = sorted((RAW / "rbi_credit").glob("*.xlsx"))
    if not files:
        return None
    rows_map = mapping("rbi_credit")
    by_code = {r["source_category"].split()[0]: r for r in rows_map if r["source_category"][0].isdigit()}
    ref = next(r for r in rows_map if r["group"] == "REFERENCE")
    values = {}        # date -> code -> Rs crore (the newest release wins for any date)
    files_meta = []
    parsed = []
    for f in files:
        ws = openpyxl.load_workbook(f, read_only=True, data_only=True)["Statement 2"]
        rows = list(ws.iter_rows(values_only=True))
        hdr_i = next(i for i, r in enumerate(rows) if r and str(r[0] or "").strip().lower() == "industry")
        dates = []
        for cell in rows[hdr_i + 1][1:6]:
            dates.append(datetime.strptime(str(cell).strip(), "%d.%b,%Y").date().isoformat())
        seen, got = set(), []
        for r in rows[hdr_i + 2:]:
            label = str(r[0] or "").strip()
            m = re.match(r"^(\d+(?:\.\d+)+)\.?\s+(.*)$", label)
            if m:
                code, name = m.group(1), m.group(2)
                want = by_code.get(code)
                if want is None:
                    continue   # finer sub-lines (e.g. 2.2.1 Sugar) are not used on their own
                if not norm(name).startswith(norm(want["source_category"].split(" ", 1)[1])[:12]):
                    raise SystemExit(f"{f.name}: RBI code {code} is '{name}', mapping expects '{want['source_category']}'")
            elif norm(label).startswith(norm(ref["source_category"])[:10]):
                code = "TOTAL"
            else:
                continue
            seen.add(code)
            got.append((code, r[1:6]))
        missing = set(by_code) - seen
        if missing:
            raise SystemExit(f"{f.name}: RBI codes missing from Statement 2: {sorted(missing)}")
        files_meta.append({"file": f.name, "dates": dates})
        parsed.append((dates, got))
    for dates, got in sorted(parsed, key=lambda x: x[0][-1]):   # oldest release first, newest last
        for code, vals in got:
            for d, v in zip(dates, vals):
                if num(v) is not None:
                    values.setdefault(d, {})[code] = num(v)
    files_meta.sort(key=lambda m: m["dates"][-1])
    septs = sorted(d for d in values if d[5:7] == "09")
    return {"values": values, "septembers": septs, "files": files_meta}


def credit_by_group(cr, groups):
    """Rs crore by group for each September; CHEM is chemicals minus pharma; ENG is engineering minus electronics."""
    rows_map = mapping("rbi_credit")
    out = {}
    for d in cr["septembers"]:
        v = cr["values"][d]
        g = defaultdict(float)
        for r in rows_map:
            code = r["source_category"].split()[0]
            if r["group"] in groups and code in v:
                g[r["group"]] += v[code]
        if "2.9" in v and "2.9.2" in v:
            g["CHEM"] = v["2.9"] - v["2.9.2"]
        g["TOTAL"] = v["TOTAL"]
        out[d] = dict(g)
    return out


# ------------------------------------------------------------------ OBICUS
def obicus():
    import openpyxl
    files = sorted((RAW / "rbi_obicus").glob("*.xlsx"))
    if not files:
        return None
    f = files[-1]   # each file carries the whole series; the newest is enough
    ws = openpyxl.load_workbook(f, read_only=True, data_only=True)["Capacity Utilisation"]
    out = []
    for r in ws.iter_rows(values_only=True):
        q = str(r[1] or "").strip()
        if re.fullmatch(r"Q[1-4]:\d{4}-\d{2}", q) and num(r[3]) is not None:
            out.append({"quarter": q, "respondents": num(r[2]), "cu": num(r[3]), "cu_sa": num(r[4])})
    if len(out) < 40:
        raise SystemExit(f"{f.name}: only {len(out)} OBICUS quarters found")
    return {"file": f.name, "series": out}


# ------------------------------------------------------------------ DPIIT FDI
def fdi():
    import pdfplumber
    files = sorted((RAW / "dpiit_fdi").glob("fdi_sector_yearwise_*.pdf"))
    if not files:
        return None
    f = files[-1]
    rows_map = {norm(r["source_category"]): r for r in mapping("dpiit_fdi")}
    head, sectors, subtotal = None, [], None
    with pdfplumber.open(f) as pdf:
        for t in (t for p in pdf.pages for t in p.extract_tables()):
            for r in t:
                cells = [(c or "").replace("\n", "") for c in r]
                if head is None and len(cells) > 6 and "2023" in cells:
                    head = cells
                    continue
                if cells[0].strip().isdigit():
                    name = cells[1]
                    if norm(name) not in rows_map:
                        raise SystemExit(f"{f.name}: DPIIT sector '{name}' has no row in industry_map.csv")
                    sectors.append({"name": name, "map": rows_map[norm(name)], "usd": [num(c) or 0.0 if c.strip() in ("-", "") else num(c) for c in cells[2:7]]})
                elif cells[0].lower().startswith("subtotal") or cells[1].lower().startswith("subtotal"):
                    subtotal = [num(c) for c in cells if num(c) is not None][:5]
    if head is None or not sectors:
        raise SystemExit(f"{f.name}: table not found")
    periods = [h.replace(" ", "") for h in head[2:7]]   # e.g. 2000To2022, 2023, 2024, 2025, 2026(TillMAR2026)
    return {"file": f.name, "periods": periods, "sectors": sectors, "subtotal": subtotal}
