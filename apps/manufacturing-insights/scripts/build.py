"""3. Turn the cached raw series into the compact JSON the page reads (data/iip.json, data/asi.json).

Every number on the page comes from these files; nothing is estimated or filled in. Choices:

IIP (monthly, MoSPI)
  * Two base years: 2011-12 (Apr 2012 - Mar 2026) and 2022-23 (from Apr 2023). The headline
    Manufacturing / Mining / Electricity / General lines join them with MoSPI's OFFICIAL linking
    factors (first press release of the 2022-23 series, PIB, 1 Jun 2026): linked = old index / factor,
    used for months before April 2023; from April 2023 the new series itself. The join is marked.
  * Year-on-year growth is the official growth rate of whichever series is in force that month.
  * MoSPI publishes no linking factor below the sector level, so the NIC 2-digit sector slopes use
    the 2011-12 series alone (FY2013-14 to FY2025-26): one base year, nothing joined.

ASI (annual, MoSPI; NIC 2008; "Combined" sector)
  * State totals use ASI's own "All" industries row (code 99999), not a sum of industries, because
    small cells are suppressed into "Other" (99998).
  * Rupee values are deflated to 2011-12 prices with WPI "Manufactured products" (base 2011-12),
    financial-year average, from the Office of the Economic Adviser. Real series start in 2011-12.
  * Growth window: 2013-14 (the year before Make in India, Sep 2014) to the latest ASI year.
    Boundary changes are handled the same way everywhere:
      - Telangana is reported separately from 2012-13, so AP and TG are both comparable.
      - Ladakh is reported from 2019-20; J&K and Ladakh are combined for growth (one value on both).
      - Dadra & Nagar Haveli and Daman & Diu merged in 2020-21; the two old UTs are summed earlier.
      - States with no 2013-14 figure (Arunachal from 2014-15, Mizoram from 2019-20, Lakshadweep from
        2023-24) get no growth figure, flagged on the map, never estimated.
"""
from __future__ import annotations

import json
import math
import re
from collections import defaultdict

import xlrd

from common import CACHE, DATA, MONTHS, ROOT, write

LINK = {  # MoSPI official linking factors, 2011-12 series -> 2022-23 series (PIB, 1 June 2026)
    "Manufacturing": 1.3700,
    "Mining": 1.1890,
    "Electricity": 1.8495,
    "General": 1.3834,
}
LINK_SOURCE = "https://www.pib.gov.in/PressReleasePage.aspx?PRID=2267531"
NEW_FROM = (2023, 4)
OLD_TO_NEW_CAT = {"Mining": "Mining & Quarrying", "Electricity": "Electricity & Gas Supply",
                  "Manufacturing": "Manufacturing", "General": "General"}

BASE_FY = "2013-14"   # pre-Make in India baseline (launched 25 Sep 2014)
SLOPE_FROM = "2013-14"

# NIC 2-digit groups shown on the page (code -> short label). Covered by both IIP and ASI.
SECTORS = {
    "10": "Food products", "11": "Beverages", "12": "Tobacco", "13": "Textiles", "14": "Apparel",
    "15": "Leather", "16": "Wood", "17": "Paper", "18": "Printing", "19": "Coke & refined petroleum",
    "20": "Chemicals", "21": "Pharmaceuticals", "22": "Rubber & plastics", "23": "Non-metallic minerals",
    "24": "Basic metals", "25": "Fabricated metals", "26": "Computers & electronics",
    "27": "Electrical equipment", "28": "Machinery", "29": "Motor vehicles", "30": "Other transport",
    "31": "Furniture", "32": "Other manufacturing",
}
# Production Linked Incentive schemes (launched 2020-21) by the NIC group they mostly fall in.
# "lead": the two the page highlights; the rest are tagged.
PLI = {
    "26": ("lead", "Mobile phones & components, IT hardware, telecom gear"),
    "21": ("lead", "Pharmaceutical drugs, key starting materials & APIs"),
    "10": ("tag", "Food processing"),
    "13": ("tag", "Man-made fibre & technical textiles"),
    "24": ("tag", "Specialty steel"),
    "27": ("tag", "White goods (LEDs), advanced chemistry cell batteries"),
    "29": ("tag", "Automobiles & auto components"),
}
IIP_NAME_TO_NIC = {  # IIP's 2-digit names (2011-12 series) -> NIC code
    "Manufacture of Food Products": "10", "Manufacture of Beverages": "11",
    "Manufacture of Tobacco Products": "12", "Manufacture of Textiles": "13",
    "Manufacture of Wearing Apparel": "14", "Manufacture of Leather and Related Products": "15",
    "Manufacture of Wood and Products of Wood and Cork, Except Furniture; Manufacture of Articles of Straw and Plaiting Materials": "16",
    "Manufacture of Paper and Paper Products": "17", "Printing and Reproduction of Recorded Media": "18",
    "Manufacture of Coke and Refined Petroleum Products": "19",
    "Manufacture of Chemicals and Chemical Products": "20",
    "Manufacture of basic pharmaceutical products and pharmaceutical preparations": "21",
    "Manufacture of Rubber and Plastics Products": "22",
    "Manufacture of Other Non-metallic Mineral Products": "23", "Manufacture of Basic Metals": "24",
    "Manufacture of Fabricated Metal Products, Except Machinery and Equipment": "25",
    "Manufacture of Computer, Electronic and Optical Products": "26",
    "Manufacture of Electrical Equipment": "27", "Manufacture of Machinery and Equipment n.e.c.": "28",
    "Manufacture of Motor Vehicles, Trailers and Semi-trailers": "29",
    "Manufacture of Other Transport Equipment": "30", "Manufacture of Furniture": "31",
    "Other Manufacturing": "32",
}
# ASI state names -> map (geoBoundaries) names. Every ASI name must be listed (checked below).
ASI_TO_MAP = {
    "Andaman & Nicobar Islands": "Andaman and Nicobar Islands", "Andhra Pradesh": "Andhra Pradesh",
    "Arunachal Pradesh": "Arunachal Pradesh", "Assam": "Assam", "Bihar": "Bihar",
    "Chandigarh": "Chandigarh", "Chattisgarh": "Chhattisgarh",
    "Dadra & Nagar Havelli and Daman & Diu": "Dadra and Nagar Haveli and Daman and Diu",
    "Dadra & Nagar Haveli": "Dadra and Nagar Haveli and Daman and Diu",   # pre-merger, summed
    "Daman & Diu": "Dadra and Nagar Haveli and Daman and Diu",            # pre-merger, summed
    "Delhi": "Delhi", "Goa": "Goa", "Gujarat": "Gujarat", "Haryana": "Haryana",
    "Himachal Pradesh": "Himachal Pradesh", "Jammu & Kashmir": "Jammu and Kashmir",
    "Jharkhand": "Jharkhand", "Karnataka": "Karnataka", "Kerala": "Kerala", "Ladakh": "Ladakh",
    "Lakshadweep": "Lakshadweep", "Madhya Pradesh": "Madhya Pradesh", "Maharashtra": "Maharashtra",
    "Manipur": "Manipur", "Meghalaya": "Meghalaya", "Mizoram": "Mizoram", "Nagaland": "Nagaland",
    "Odisha": "Odisha", "Puducherry": "Puducherry", "Punjab": "Punjab", "Rajasthan": "Rajasthan",
    "Sikkim": "Sikkim", "Tamil Nadu": "Tamil Nadu", "Telangana": "Telangana", "Tripura": "Tripura",
    "Uttarakhand": "Uttarakhand", "Uttar Pradesh": "Uttar Pradesh", "West Bengal": "West Bengal",
}
JK_GROUP = ("Jammu and Kashmir", "Ladakh")   # combined for growth, shown on J&K only
SMALL_SUPPRESSED = 50     # % of latest GVA in ASI's suppressed "Other" group
SMALL_PERSONS = 10_000    # persons engaged in the base year
ASI_KEYS = ["factories", "persons", "workers", "gva", "output", "fixed_capital", "wages"]
MONEY = {"gva", "output", "fixed_capital", "wages"}  # Rs lakh, nominal


def load(name):
    return json.loads((CACHE / f"{name}.json").read_text("utf-8"))


def cagr(a, b, years):
    if a is None or b is None or a <= 0 or b <= 0:
        return None
    return round((math.pow(b / a, 1 / years) - 1) * 100, 2)


def r1(x, nd=1):
    return None if x is None else round(x, nd)


def fy_start(fy: str) -> int:
    return int(fy[:4])


# ---------------------------------------------------------------- IIP
def build_iip() -> dict:
    rows = load("iip_monthly")
    by = {}  # (base, category, sub, y, m) -> (index, growth)
    for r in rows:
        if r["type"] not in ("General", "Sectoral"):
            continue
        key = (r["base_year"], r["category"], r["sub_category"] or "", int(r["year"]), MONTHS.index(r["month"]) + 1)
        by[key] = (float(r["index"]), None if r["growth_rate"] in ("", None) else float(r["growth_rate"]))

    def months(base, cat, sub=""):
        return sorted((y, m) for (b, c, s, y, m) in by if b == base and c == cat and s == sub)

    linked = {}
    for old_cat, new_cat in OLD_TO_NEW_CAT.items():
        series = {}
        for (y, m) in months("2011-12", old_cat):
            if (y, m) < NEW_FROM:
                idx, g = by[("2011-12", old_cat, "", y, m)]
                series[(y, m)] = (idx / LINK[old_cat], g, "old")
        for (y, m) in months("2022-23", new_cat):
            idx, g = by[("2022-23", new_cat, "", y, m)]
            series[(y, m)] = (idx, g, "new")
        linked[old_cat] = series
    allm = sorted(set().union(*[s.keys() for s in linked.values()]))
    # every month present in every series, no gaps
    for k, s in linked.items():
        missing = [ym for ym in allm if ym not in s]
        if missing:
            raise SystemExit(f"IIP {k}: missing months {missing[:5]}")
    for a, b in zip(allm, allm[1:]):
        if (a[0] * 12 + a[1]) + 1 != b[0] * 12 + b[1]:
            raise SystemExit(f"IIP gap between {a} and {b}")

    out_m = {
        "dates": [f"{y}-{m:02d}" for y, m in allm],
        "link_month": f"{NEW_FROM[0]}-{NEW_FROM[1]:02d}",
        "link_factors": LINK,
        "link_source": LINK_SOURCE,
        "series": {
            k.lower(): {"index": [r1(linked[k][ym][0]) for ym in allm],
                        "yoy": [linked[k][ym][1] for ym in allm]}
            for k in ["Manufacturing", "Mining", "Electricity", "General"]
        },
    }

    # Annual (financial year) indices, old series, 2-digit + sector level: official annual figures.
    ann = load("iip_annual")
    old_ann = defaultdict(dict)   # name -> fy -> index
    new_ann = defaultdict(dict)
    for r in ann:
        if r["type"] not in ("General", "Sectoral"):
            continue
        name = r["sub_category"] or r["category"]
        (old_ann if r["base_year"] == "2011-12" else new_ann if r["base_year"] == "2022-23" else {}).setdefault(name, {})[r["year"]] = (float(r["index"]), float(r["growth_rate"]) if r["growth_rate"] not in ("", None) else None)
    fys = sorted(old_ann["Manufacturing"])
    last_fy = fys[-1]
    sectors = []
    for name, code in IIP_NAME_TO_NIC.items():
        if name not in old_ann:
            raise SystemExit(f"IIP annual: no 2-digit series named {name!r}")
        s = old_ann[name]
        idx = [r1(s.get(fy, (None,))[0]) for fy in fys]
        a, b = s[SLOPE_FROM][0], s[last_fy][0]
        sectors.append({
            "nic": code, "name": SECTORS[code], "index": idx,
            "from": a, "to": b, "change_pct": r1((b / a - 1) * 100),
            "cagr": cagr(a, b, fy_start(last_fy) - fy_start(SLOPE_FROM)),
            "pli": PLI.get(code, (None, None))[0], "pli_note": PLI.get(code, (None, None))[1],
        })
    # New basket (2022-23 = 100): each group's latest financial-year index is its change since 2022-23.
    new_fys = sorted(new_ann["Manufacturing"])
    NEW_NAME = {**IIP_NAME_TO_NIC}
    for name, code in NEW_NAME.items():
        s = new_ann.get(name)
        sec = next(x for x in sectors if x["nic"] == code)
        if not s or new_fys[-1] not in s:
            raise SystemExit(f"IIP 2022-23 annual: no {name!r} for {new_fys[-1]}")
        sec["new"] = {"from_fy": "2022-23", "to_fy": new_fys[-1], "to": s[new_fys[-1]][0],
                      "change_pct": r1(s[new_fys[-1]][0] - 100), "index": [100.0] + [s[fy][0] for fy in new_fys]}
    mfg = old_ann["Manufacturing"]
    annual = {
        "fys": fys,
        "manufacturing_2011": [mfg[fy][0] for fy in fys],
        "manufacturing_2011_growth": [mfg[fy][1] for fy in fys],
        "general_2011": [old_ann["General"][fy][0] for fy in fys],
        "manufacturing_2022": {fy: v[0] for fy, v in sorted(new_ann["Manufacturing"].items())},
        "manufacturing_2022_growth": {fy: v[1] for fy, v in sorted(new_ann["Manufacturing"].items())},
    }
    m_from, m_to = mfg[SLOPE_FROM][0], mfg[last_fy][0]
    headline = {
        "from_fy": SLOPE_FROM, "to_fy": last_fy, "mfg_from": m_from, "mfg_to": m_to,
        "mfg_change_pct": r1((m_to / m_from - 1) * 100),
        "mfg_cagr": cagr(m_from, m_to, fy_start(last_fy) - fy_start(SLOPE_FROM)),
    }
    # The decade before, for context: same series can't reach back, so none is given.
    latest = allm[-1]
    # This financial year so far (new series): average of the official monthly growth rates.
    cur = [(y, m) for (y, m) in allm if (y, m) >= ((latest[0] if latest[1] >= 4 else latest[0] - 1), 4)]
    ytd = [linked["Manufacturing"][ym][1] for ym in cur]
    headline["ytd_months"] = [f"{y}-{m:02d}" for y, m in cur]
    headline["ytd_mfg_avg_growth"] = r1(sum(ytd) / len(ytd)) if ytd else None
    headline["new_mfg_change_pct"] = r1(new_ann["Manufacturing"][new_fys[-1]][0] - 100)
    headline["new_to_fy"] = new_fys[-1]
    return {"monthly": out_m, "annual": annual, "sectors": sectors, "headline": headline,
            "latest_month": f"{latest[0]}-{latest[1]:02d}", "sector_years": [SLOPE_FROM, last_fy]}


# ---------------------------------------------------------------- WPI
def build_wpi() -> dict:
    sh = xlrd.open_workbook(str(CACHE / "wpi_fin_year_index.xls")).sheet_by_index(0)
    head = sh.row_values(0)
    for r in range(sh.nrows):
        v = sh.row_values(r)
        if str(v[1]).strip() == "1300000000":
            out = {"2011-12": 100.0}
            for col, h in enumerate(head):
                if str(h).startswith("INDEX"):
                    y = str(h)[5:9]
                    out[f"{y}-{str(int(y) + 1)[2:]}"] = round(float(v[col]), 2)
            return out
    raise SystemExit("WPI: no 'Manufactured products' row (code 1300000000)")


# ---------------------------------------------------------------- ASI
def build_asi(wpi: dict) -> dict:
    raw = {k: load(f"asi_{k}") for k in ASI_KEYS}
    unknown = {r["state"] for r in raw["gva"]} - set(ASI_TO_MAP) - {"All India"}
    if unknown:
        raise SystemExit(f"ASI states not mapped: {unknown}")

    years = sorted({r["year"] for r in raw["gva"]})
    latest = years[-1]
    if latest not in wpi:
        raise SystemExit(f"WPI has no {latest}: refresh the WPI workbook")
    real_years = [y for y in years if y in wpi]

    # tot[map_state][key][year] (All industries, code 99999); ind[...][nic][key][year]
    tot = defaultdict(lambda: defaultdict(dict))
    ind = defaultdict(lambda: defaultdict(lambda: defaultdict(dict)))
    raw_state_years = defaultdict(set)
    for k, rows in raw.items():
        for r in rows:
            st = "All India" if r["state"] == "All India" else ASI_TO_MAP[r["state"]]
            v = float(r["value"])
            if r["nic_code"] == "99999":
                tot[st][k][r["year"]] = tot[st][k].get(r["year"], 0) + v
                raw_state_years[st].add(r["year"])
            else:
                ind[st][r["nic_code"]][k][r["year"]] = ind[st][r["nic_code"]][k].get(r["year"], 0) + v

    def real(v, y):
        return None if v is None or y not in wpi else v / (wpi[y] / 100)

    def derived(t: dict, y: str) -> dict:
        g = t["gva"].get(y)
        p = t["persons"].get(y)
        return {
            "factories": t["factories"].get(y),
            "persons": p,
            "workers": t["workers"].get(y),
            "gva_real": r1(real(g, y) / 100, 1) if g is not None and y in wpi else None,      # Rs crore, 2011-12 prices
            "gva_nominal": r1(g / 100, 1) if g is not None else None,                           # Rs crore
            "gva_per_person": r1(real(g, y) * 1e5 / p / 1e5, 2) if g and p and y in wpi else None,  # Rs lakh per person, 2011-12 prices
            "wages_per_person": r1(t["wages"].get(y) * 1e5 / p / 1e5, 2) if t["wages"].get(y) and p else None,  # Rs lakh, nominal
            "capital_per_person": r1(real(t["fixed_capital"].get(y), y) / p, 2) if t["fixed_capital"].get(y) and p and y in wpi else None,  # Rs lakh, 2011-12 prices
        }

    span = fy_start(latest) - fy_start(BASE_FY)
    GROWTH = ["gva_real", "factories", "persons", "gva_per_person"]

    def growth(t: dict) -> dict:
        a, b = derived(t, BASE_FY), derived(t, latest)
        return {m: cagr(a[m], b[m], span) for m in GROWTH}

    def combine(names):
        c = defaultdict(dict)
        for n in names:
            for k, ys in tot[n].items():
                for y, v in ys.items():
                    c[k][y] = c[k].get(y, 0) + v
        return c

    jk = combine(JK_GROUP)
    states = {}
    for st in sorted(s for s in tot if s != "All India"):
        t = tot[st]
        series = {y: derived(t, y) for y in real_years}
        flags = []
        if st == "Ladakh":
            # Ladakh has no separate 2013-14 figure: its growth is inside J&K's combined number.
            g = {m: None for m in GROWTH}
            flags.append("No separate growth figure: Ladakh is reported only from 2019-20, so its growth is counted in Jammu & Kashmir's (shown as J&K incl. Ladakh).")
        elif st == "Jammu and Kashmir":
            g = growth(jk)
            flags.append("Growth is for Jammu & Kashmir including Ladakh: Ladakh is reported separately only from 2019-20.")
        elif BASE_FY not in raw_state_years[st]:
            g = {m: None for m in GROWTH}
            first = min(raw_state_years[st])
            flags.append(f"No growth figure: ASI reports this state only from {first}.")
        else:
            g = growth(t)
        if st == "Dadra and Nagar Haveli and Daman and Diu":
            flags.append("Before 2020-21, Dadra & Nagar Haveli and Daman & Diu are added together (they merged in 2020).")
        if st in ("Andhra Pradesh", "Telangana"):
            flags.append("Telangana is reported separately from 2012-13, so both states compare like with like.")
        # top industries in the latest year by GVA (all ASI industries, incl. non-manufacturing)
        latest_g = {nic: d["gva"].get(latest) for nic, d in ind[st].items() if d["gva"].get(latest)}
        total_g = t["gva"].get(latest)
        top = []
        for nic, v in sorted(latest_g.items(), key=lambda kv: -kv[1]):
            if nic == "99998" or nic not in SECTORS:
                continue
            d = ind[st][nic]
            top.append({
                "nic": nic, "name": SECTORS[nic],
                "share": r1(v / total_g * 100) if total_g else None,
                "persons": d["persons"].get(latest),
                "gva_real": [r1(real(d["gva"].get(y), y) / 100, 1) if d["gva"].get(y) is not None else None for y in real_years],
            })
            if len(top) == 5:
                break
        other_share = r1(latest_g.get("99998", 0) / total_g * 100) if total_g else None
        # Small base: growth rates from a tiny or mostly-suppressed base swing wildly; the map greys them.
        base_persons = (jk if st == "Jammu and Kashmir" else t)["persons"].get(BASE_FY)
        small = None
        if any(v is not None for v in g.values()):
            if other_share is not None and other_share > SMALL_SUPPRESSED:
                small = f"Small base: {other_share}% of this state's factory output is in ASI's suppressed 'Other' group."
            elif base_persons is not None and base_persons < SMALL_PERSONS:
                small = f"Small base: only {int(base_persons):,} people worked in its registered factories in {BASE_FY}."
        if small:
            flags.append(small + " Its growth rate is in the table but greyed on the map.")
        states[st] = {
            "small_base": small,
            "growth_label": "Jammu & Kashmir incl. Ladakh" if st == "Jammu and Kashmir" else None,
            "latest": series.get(latest),
            "series": {k: [series[y][k] for y in real_years] for k in ["gva_real", "persons", "factories", "gva_per_person"]},
            "growth": g, "flags": flags, "top": top, "suppressed_share": other_share,
        }

    india = tot["All India"]
    india_series = {y: derived(india, y) for y in real_years}
    sectors = []
    for nic, name in SECTORS.items():
        d = ind["All India"].get(nic)
        if not d:
            continue
        a, b = derived(d, BASE_FY), derived(d, latest)
        sectors.append({
            "nic": nic, "name": name, "pli": PLI.get(nic, (None,))[0],
            "persons": b["persons"], "gva_real": b["gva_real"],
            "capital_per_person": b["capital_per_person"], "gva_per_person": b["gva_per_person"],
            "growth": {m: cagr(a[m], b[m], span) for m in GROWTH},
        })
    def top5_share(y):
        vals = sorted(((st, tot[st]["gva"].get(y, 0)) for st in tot if st != "All India"), key=lambda kv: -kv[1])
        return {"states": [v[0] for v in vals[:5]], "share": r1(sum(v[1] for v in vals[:5]) / india["gva"][y] * 100)}
    concentration = {BASE_FY: top5_share(BASE_FY), latest: top5_share(latest)}
    nominal = india["gva"]
    prev = real_years[-2]
    deflation = {  # the latest year's real growth leans on one price index; shown in the method notes
        "prev_fy": prev, "latest_fy": latest, "wpi_prev": wpi[prev], "wpi_latest": wpi[latest],
        "nominal_growth_pct": r1((nominal[latest] / nominal[prev] - 1) * 100, 2),
        "real_growth_pct": r1((real(nominal[latest], latest) / real(nominal[prev], prev) - 1) * 100, 2),
    }
    return {
        "deflation_latest": deflation,
        "concentration": concentration,
        "years": real_years, "latest": latest, "base": BASE_FY, "span_years": span,
        "deflator": {"name": "WPI Manufactured products (base 2011-12 = 100), financial-year average",
                     "source": "https://eaindustry.nic.in/", "index": {y: wpi[y] for y in real_years}},
        "india": {
            "series": {k: [india_series[y][k] for y in real_years] for k in ["gva_real", "gva_nominal", "persons", "workers", "factories", "gva_per_person", "wages_per_person", "capital_per_person"]},
            "growth": growth(india),
        },
        "states": states, "sectors": sectors,
        "units": {"gva_real": "Rs crore at 2011-12 prices", "gva_per_person": "Rs lakh per person at 2011-12 prices",
                  "capital_per_person": "Rs lakh of fixed capital per person at 2011-12 prices",
                  "wages_per_person": "Rs lakh per person, current prices"},
    }


def pct_change(a, b):
    return r1((b / a - 1) * 100)


def build_headline(iip: dict, asi: dict) -> dict:
    """Every headline number on the page, the share text and the home card, computed in one place."""
    h = iip["headline"]
    fys = iip["annual"]["fys"]
    mfg = dict(zip(fys, iip["annual"]["manufacturing_2011"]))
    yrs = asi["years"]
    b, l = yrs.index(asi["base"]), len(yrs) - 1
    s = asi["india"]["series"]
    new_to = iip["annual"]["manufacturing_2022"][h["new_to_fy"]]
    linked_to = r1(new_to * LINK["Manufacturing"])
    output = {  # conservative headline: the 2011-12 series alone, which runs to 2025-26
        "label": "Factory output index (IIP manufacturing)",
        "series": "2011-12", "from_fy": h["from_fy"], "to_fy": h["to_fy"],
        "years": fy_start(h["to_fy"]) - fy_start(h["from_fy"]),
        "from": h["mfg_from"], "to": h["mfg_to"], "change_pct": h["mfg_change_pct"], "cagr": h["mfg_cagr"],
    }
    output_linked = {  # the 2022-23 series' latest year, put on the old base with MoSPI's factor
        "label": "Same window, 2022-23 series linked with MoSPI's factor",
        "from_fy": h["from_fy"], "to_fy": h["new_to_fy"], "from": h["mfg_from"],
        "new_index": new_to, "factor": LINK["Manufacturing"], "to": linked_to,
        "change_pct": pct_change(h["mfg_from"], linked_to),
    }
    factory = {  # like for like: one source (ASI), one window
        "label": "Registered factories (ASI)", "from_fy": asi["base"], "to_fy": asi["latest"],
        "years": asi["span_years"],
        "gva_real_from": s["gva_real"][b], "gva_real_to": s["gva_real"][l],
        "gva_real_change_pct": pct_change(s["gva_real"][b], s["gva_real"][l]),
        "persons_from": s["persons"][b], "persons_to": s["persons"][l],
        "persons_change_pct": pct_change(s["persons"][b], s["persons"][l]),
        "gva_per_person_from": s["gva_per_person"][b], "gva_per_person_to": s["gva_per_person"][l],
        "gva_per_person_change_pct": pct_change(s["gva_per_person"][b], s["gva_per_person"][l]),
        "gva_real_cagr": asi["india"]["growth"]["gva_real"], "persons_cagr": asi["india"]["growth"]["persons"],
        "gva_per_person_cagr": asi["india"]["growth"]["gva_per_person"],
    }
    # Without the latest year, whose real jump leans on a falling WPI (see deflation_latest):
    pv = len(yrs) - 2
    factory["prev_fy"] = yrs[pv]
    factory["gva_per_person_cagr_to_prev"] = r1((math.pow(s["gva_per_person"][pv] / s["gva_per_person"][b], 1 / (pv - b)) - 1) * 100, 2)
    factory["gva_real_cagr_to_prev"] = r1((math.pow(s["gva_real"][pv] / s["gva_real"][b], 1 / (pv - b)) - 1) * 100, 2)
    factory["jobs_share_of_growth_pct"] = round(math.log1p(factory["persons_cagr"] / 100) / math.log1p(factory["gva_real_cagr"] / 100) * 100)
    same_window = {  # IIP over ASI's window, to show the two measures disagree
        "from_fy": asi["base"], "to_fy": asi["latest"],
        "iip_from": mfg[asi["base"]], "iip_to": mfg[asi["latest"]],
        "iip_change_pct": pct_change(mfg[asi["base"]], mfg[asi["latest"]]),
        "asi_gva_real_change_pct": factory["gva_real_change_pct"],
    }
    share = (f"India's factory output index is up {output['change_pct']:.0f}% from {output['from_fy']} to {output['to_fy']}. "
             f"In registered factories, real value added rose {factory['gva_real_change_pct']:.0f}% and jobs {factory['persons_change_pct']:.0f}% "
             f"from {factory['from_fy']} to {factory['to_fy']}, so output per worker grew about {factory['gva_per_person_cagr']:.0f}% a year.")
    return {"output": output, "output_linked": output_linked, "factory": factory, "same_window": same_window,
            "ytd": {"months": h["ytd_months"], "mfg_avg_growth": h["ytd_mfg_avg_growth"]},
            "deflation_latest": asi["deflation_latest"], "share_text": share}


SHARE_TAG = re.compile(r'(<meta [^>]*data-headline="share"[^>]*content=")[^"]*(")')


def write_meta(headline: dict) -> None:
    """Put the generated share text into index.html's share tags (link previews don't run JS)."""
    page = ROOT / "index.html"
    html = page.read_text("utf-8")
    text = headline["share_text"].replace("&", "&amp;").replace('"', "&quot;")
    new, n = SHARE_TAG.subn(lambda m: m.group(1) + text + m.group(2), html)
    if n != 2:
        raise SystemExit(f"index.html: expected 2 share tags (og, twitter) marked data-headline=share, found {n}")
    if new != html:
        page.write_bytes(new.encode("utf-8"))
        print("updated the share text in index.html")


def main() -> None:
    iip = build_iip()
    wpi = build_wpi()
    asi = build_asi(wpi)
    headline = build_headline(iip, asi)
    write("iip.json", iip)
    write("asi.json", asi)
    write("headline.json", headline)
    write_meta(headline)
    from invest import build_invest
    invest, screen = build_invest(iip, asi, wpi, headline)
    write("invest.json", invest)
    write("screen.json", screen)
    (DATA / "industry_map.csv").write_bytes((ROOT / "scripts" / "mapping" / "industry_map.csv").read_bytes())  # downloadable


if __name__ == "__main__":
    main()
