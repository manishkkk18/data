"""The investment pipeline and the momentum screen (called by build.py) -> data/invest.json, data/screen.json.

A momentum screen backed by investment signals, not a forecast. Every number comes from the
cached official sources and the reviewed mapping (mapping/industry_map.csv); a source that is
missing for an industry is "no data", never zero.

Momentum (per NIC 2-digit industry, IIP)
  long-run  = CAGR on the 2011-12 series, 2013-14 -> latest full year (already in iip.json)
  recent    = CAGR within the 2022-23 series only, 2022-23 -> latest full year
  The two baskets differ (the new one grows faster for manufacturing as a whole), so an
  industry's momentum is judged RELATIVE TO MANUFACTURING on each basket:
      relative momentum = (recent - recent_all) - (long-run - long-run_all)   [percentage points]
  consistency = share of the last 12 months whose year-on-year growth (new series) beat the
  industry's own long-run CAGR.

Signals (each scored check / dash / cross, or None for no data), thresholds in THRESHOLDS:
  a credit    RBI bank credit growth, latest 12 months, minus all-industry credit growth
  b imports   capital-goods imports mapped to the group (US$), growth over the last 2 FYs,
              minus growth of all capital-goods imports in chapters 84-85 (mapped + general)
  c fdi       DPIIT FDI equity, latest 3 FYs vs the previous 3 FYs
  d asi       2018-19 -> latest ASI year: real fixed capital per person grew faster than India's
              AND the number of factories grew (both = check, one = dash, neither = cross)
  e pli       actual PLI investment as % of committed, where an official committed figure exists
Label: Rising (relative momentum > +1 pt) and >= 3 checks -> "Rising + backed";
       Rising with fewer checks -> "Rising, unconfirmed"; within +/-1 pt -> "Steady";
       below -1 pt -> "Fading". No-data signals never count as checks or crosses.
"""
from __future__ import annotations

import csv
import json
import math
from collections import defaultdict
from pathlib import Path

from common import CACHE, MONTHS, SCRIPTS

RAW = SCRIPTS / "raw"
MAP = SCRIPTS / "mapping" / "industry_map.csv"

THRESHOLDS = {
    "momentum_pts": 1.0,        # relative momentum beyond +/-1 pt a year = Rising / Fading
    "checks_for_backed": 3,     # checks needed for "Rising + backed"
    "credit_pts": 2.0,          # a: within +/-2 pts of all-industry credit growth = dash
    "imports_pts": 5.0,         # b: within +/-5 pts of all capital-goods import growth = dash
    "fdi_pct": 20.0,            # c: latest 3 FYs within +/-20% of the previous 3 = dash
    "pli_hi": 75.0,             # e: >= 75% of committed = check
    "pli_lo": 40.0,             #    < 40% = cross
    "asi_from": "2018-19",      # d: window start
    "small_base_persons": 100_000,   # risk flag: fewer people employed than this (ASI latest year)
    "basket_gap_pts": 10.0,     # risk flag: old and new baskets disagree by more than this since 2022-23
    "low_value_added_pct": 15.0,     # risk flag: GVA below this % of output (assembly-heavy)
    "consistency_low_pct": 50.0,     # risk flag: beat its own long-run in fewer than half the last 12 months
}
CHECK, DASH, CROSS = "check", "dash", "cross"


def r1(x, nd=1):
    return None if x is None else round(x, nd)


def cagr(a, b, years):
    if a is None or b is None or a <= 0 or b <= 0 or years <= 0:
        return None
    return (math.pow(b / a, 1 / years) - 1) * 100


def load(name):
    return json.loads((CACHE / f"{name}.json").read_text("utf-8"))


def read_map():
    rows = list(csv.DictReader(MAP.open(encoding="utf-8")))
    groups = {r["source_category"]: {"name": r["note"].split(";")[0], "nic": r["note"].split("NIC ")[1].split()} for r in rows if r["source"] == "group"}
    return rows, groups


def score(value, lo, hi):
    """value >= hi: check; value <= lo: cross; between: dash; None: no data."""
    if value is None:
        return None
    return CHECK if value >= hi else CROSS if value <= lo else DASH


# ------------------------------------------------------------------ sources
def trade(rows_map):
    """Capital-goods imports by FY (US$ million and Rs crore): mapped groups, general, not capital."""
    meta = json.loads((CACHE / "trade" / "_meta.json").read_text("utf-8"))
    fys = [f"{y}-{str(y + 1)[2:]}" for y in meta["years"]]
    hs_rule = {r["source_category"]: r for r in rows_map if r["source"] == "hs4"}
    out = {"fys": fys, "usd": {}, "inr": {}}
    for unit, key in (("usd_million", "usd"), ("inr_crore", "inr")):
        acc = defaultdict(lambda: [0.0] * len(fys))
        for i, fy in enumerate(fys):
            for x in json.loads((CACHE / "trade" / f"hs4_{unit}_{fy}.json").read_text("utf-8")):
                code, v = x["hs4"], x["value"] or 0.0
                if code == "TOTAL":
                    acc["ALL_IMPORTS"][i] += v
                    continue
                if code[:2] not in ("84", "85"):
                    continue
                acc[f"CH{code[:2]}"][i] += v
                rule = hs_rule.get(code)
                if rule is None:
                    raise SystemExit(f"HS {code} has no row in industry_map.csv: rerun mapping/make_map.py and review")
                g = rule["group"]
                if g == "-":
                    acc["NOT_CAPITAL"][i] += v
                else:
                    acc["CAPITAL_ALL"][i] += v
                    acc[g][i] += v
                    if code == "8486":
                        acc["HS8486"][i] += v
        out[key] = {k: [round(v, 1) for v in vals] for k, vals in acc.items()}
    return out


def pli():
    rows = list(csv.DictReader((RAW / "pli_schemes.csv").open(encoding="utf-8")))
    by = defaultdict(dict)
    meta = {}
    for r in rows:
        by[r["scheme"]][(r["metric"], r["kind"])] = float(r["value"])
        meta.setdefault(r["scheme"], {"as_of": r["as_of"], "source": r["source"], "source_date": r["source_date"], "link": r["link"]})
        if r["kind"] == "committed":
            meta[r["scheme"]]["committed_note"] = f'{r["source"]} ({r["source_date"]}), {r["where"]}'
            meta[r["scheme"]]["committed_link"] = r["link"]
        if r["metric"] == "investment" and r["kind"] == "actual":
            meta[r["scheme"]]["page"] = r["where"]
    return by, meta


def manual_status():
    """Which manual downloads are present (parsers are added once the real files are in hand)."""
    st = {}
    for k, label in (("rbi_credit", "RBI Sectoral Deployment of Bank Credit"), ("rbi_obicus", "RBI OBICUS"), ("dpiit_fdi", "DPIIT FDI factsheets")):
        files = [p.name for p in (RAW / k).glob("*") if p.is_file() and not p.name.startswith(".")]
        st[k] = {"label": label, "files": files, "status": "ok" if files else "no_data"}
    return st


def mapping_summary(rows_map, groups):
    """Per group: which source categories feed it, with confidence (HS codes collapsed to a count)."""
    out = []
    for g, d in groups.items():
        row = {"group": g, "name": d["name"], "nic": " ".join(d["nic"]), "rbi_credit": [], "dpiit_fdi": [], "pli": [], "hs4": []}
        hs = defaultdict(list)
        for r in rows_map:
            if r["source"] == "group" or g not in r["group"].split():
                continue
            if r["source"] == "hs4":
                hs[r["confidence"]].append(r["source_category"])
            else:
                row[r["source"]].append({"cat": r["source_category"], "conf": r["confidence"]})
        row["hs4"] = [{"cat": ", ".join(v), "conf": c + (" (machine tools, shared)" if g in ("ENG", "TRANS") else "")} for c, v in hs.items()]
        out.append(row)
    return out


# ------------------------------------------------------------------ build
def build_invest(iip: dict, asi: dict, wpi: dict, headline: dict) -> tuple[dict, dict]:
    rows_map, groups = read_map()
    nic_group = {n: g for g, d in groups.items() for n in d["nic"]}
    tr = trade(rows_map)
    pli_by, pli_meta = pli()
    manual = manual_status()
    import read_raw
    CR = read_raw.credit() if manual["rbi_credit"]["status"] == "ok" else None
    OB = read_raw.obicus() if manual["rbi_obicus"]["status"] == "ok" else None
    FD = read_raw.fdi() if manual["dpiit_fdi"]["status"] == "ok" else None
    conf_rank = ["exact", "approximate", "loose"]

    def worst_conf(source, g):
        cs = [r["confidence"] for r in rows_map if r["source"] == source and g in r["group"].split() and r["confidence"]]
        return max(cs, key=conf_rank.index) if cs else None

    # ---- bank credit by group (RBI), Septembers
    credit_out = None
    if CR:
        cg = read_raw.credit_by_group(CR, set(groups))
        septs = CR["septembers"]
        last, prev = septs[-1], septs[-2]
        three = next((d for d in septs if int(d[:4]) == int(last[:4]) - 3), None)
        tot_yoy = (cg[last]["TOTAL"] / cg[prev]["TOTAL"] - 1) * 100
        credit_out = {"septembers": septs, "last": last, "prev": prev, "total_yoy": r1(tot_yoy),
                      "total": [r1(cg[d]["TOTAL"]) for d in septs], "groups": {},
                      "files": CR["files"], "source": "https://www.rbi.org.in/Scripts/BS_PressReleaseDisplay.aspx?prid=63891"}
        for g in groups:
            if g not in cg[last] or not cg[prev].get(g):
                continue
            yoy = (cg[last][g] / cg[prev][g] - 1) * 100
            cagr3 = cagr(cg[three][g], cg[last][g], 3) if three and cg[three].get(g) else None
            credit_out["groups"][g] = {"series": [r1(cg[d].get(g)) for d in septs], "yoy": r1(yoy), "cagr3": r1(cagr3),
                                       "diff": r1(yoy - tot_yoy), "confidence": worst_conf("rbi_credit", g)}
        credit_out["manufacturing"] = [r1(sum(cg[d].get(g, 0) for g in groups)) for d in septs]

    # ---- FDI by group (DPIIT), calendar years
    fdi_out = None
    if FD:
        per = FD["periods"]
        grp = defaultdict(lambda: [0.0] * len(per))
        for sct in FD["sectors"]:
            for g in sct["map"]["group"].split():
                if g in groups:
                    for i, v in enumerate(sct["usd"]):
                        grp[g][i] += v or 0.0
        mfg = [sum(grp[g][i] for g in grp) for i in range(len(per))]
        old_i, recent_i = 0, [1, 2, 3]   # 2000-2022 vs the three latest full calendar years
        recent_tot = sum(mfg[i] for i in recent_i)
        fdi_out = {"periods": per, "manufacturing": [r1(v) for v in mfg], "all_sectors": FD["subtotal"],
                   "groups": {}, "file": FD["file"],
                   "source": "https://www.dpiit.gov.in/documents/publications/fourth-quarterly-fdi-newsletter-fy-2025-26-january-to-march-2026-2kDO1ETMtQWa?pageTitle=FDI-NEWSLETTER-VOL.-XXXIV-No.-4-APRIL,-2026"}
        for g, v in grp.items():
            sh_old = v[old_i] / mfg[old_i] * 100 if mfg[old_i] else None
            sh_new = sum(v[i] for i in recent_i) / recent_tot * 100 if recent_tot else None
            tilt = (sh_new / sh_old - 1) * 100 if sh_old and sh_new is not None else None
            fdi_out["groups"][g] = {"usd": [r1(x) for x in v], "share_old": r1(sh_old), "share_recent": r1(sh_new),
                                    "tilt": r1(tilt), "confidence": worst_conf("dpiit_fdi", g)}
    fys = tr["fys"]

    # ---- IIP: recent momentum inside the 2022-23 series
    mon = load("iip_monthly")
    new_m = defaultdict(dict)       # sub_category -> (y, m) -> (index, growth)
    capg = {}
    for r in mon:
        if r["base_year"] != "2022-23":
            continue
        ym = (int(r["year"]), MONTHS.index(r["month"]) + 1)
        g = float(r["growth_rate"]) if r["growth_rate"] not in ("", None) else None
        if r["category"] == "Manufacturing" and r["sub_category"]:
            new_m[r["sub_category"]][ym] = (float(r["index"]), g)
        elif r["category"] == "Capital Goods":
            capg[ym] = (float(r["index"]), g)
    last12 = sorted({ym for d in new_m.values() for ym in d})[-12:]
    new_fy = sorted(iip["annual"]["manufacturing_2022"])
    years_new = int(new_fy[-1][:4]) - 2022
    recent_all = cagr(100, iip["annual"]["manufacturing_2022"][new_fy[-1]], years_new)
    longrun_all = iip["headline"]["mfg_cagr"]
    name_of = {s["nic"]: s for s in iip["sectors"]}
    from build import IIP_NAME_TO_NIC  # the reviewed IIP name -> NIC table
    sub_of = {nic: name for name, nic in IIP_NAME_TO_NIC.items()}

    # ---- ASI by NIC (All India): factories, persons, fixed capital, GVA, output
    asi_raw = {k: load(f"asi_{k}") for k in ("factories", "persons", "fixed_capital", "gva", "output", "gfcf")}
    nic_val = defaultdict(lambda: defaultdict(dict))   # nic -> key -> year -> value
    for k, rows in asi_raw.items():
        for r in rows:
            if r["state"] == "All India":
                nic_val[r["nic_code"]][k][r["year"]] = float(r["value"])
    latest = asi["latest"]
    a0 = THRESHOLDS["asi_from"]
    span_d = int(latest[:4]) - int(a0[:4])

    def fcpw(nic, y):  # real fixed capital per person (Rs lakh at 2011-12 prices)
        v = nic_val[nic]
        fc, p = v["fixed_capital"].get(y), v["persons"].get(y)
        return fc / (wpi[y] / 100) / p if fc and p and y in wpi else None

    india_fcpw = cagr(fcpw("99999", a0), fcpw("99999", latest), span_d)

    # ---- group-level signals
    usd = tr["usd"]
    n = len(fys)
    i_to, i_from = n - 1, n - 3  # growth over the last 2 FYs
    cap_growth = (usd["CAPITAL_ALL"][i_to] / usd["CAPITAL_ALL"][i_from] - 1) * 100
    hs_conf = defaultdict(set)
    for r in rows_map:
        if r["source"] == "hs4" and r["group"] not in ("-", "GENERAL"):
            for g in r["group"].split():
                hs_conf[g].add((r["group"], r["confidence"]))

    def imports_signal(g):
        own = [k for k, c in hs_conf[g] if k == g]
        key = g if own else next((k for k, c in hs_conf[g] if " " in k), None)
        if not key or key not in usd:
            return {"score": None, "why": "No capital-goods import codes specific to this industry"}
        a, b = usd[key][i_from], usd[key][i_to]
        if not a:
            return {"score": None, "why": "No imports in the base year"}
        growth = (b / a - 1) * 100
        conf = sorted({c for k, c in hs_conf[g] if k == key}, key=["exact", "approximate", "loose"].index)[-1]
        rel = growth - cap_growth
        return {"score": score(rel, -THRESHOLDS["imports_pts"], THRESHOLDS["imports_pts"]),
                "value": r1(growth), "reference": r1(cap_growth), "diff": r1(rel), "confidence": conf,
                "combined": key if " " in key else None, "from_fy": fys[i_from], "to_fy": fys[i_to],
                "usd_million": [usd[key][i] for i in range(n)]}

    pli_groups = defaultdict(list)
    for r in rows_map:
        if r["source"] == "pli":
            pli_groups[r["group"]].append((r["source_category"], r["confidence"]))

    def pli_signal(g):
        schemes = pli_groups.get(g, [])
        if not schemes:
            return {"score": None, "why": "No PLI scheme for this industry", "schemes": []}
        both = [(s, pli_by[s][("investment", "actual")], pli_by[s][("investment", "committed")]) for s, _ in schemes
                if ("investment", "committed") in pli_by[s]]
        names = [s for s, _ in schemes]
        if not both:
            return {"score": None, "why": "PLI scheme(s) exist, but no official committed-investment figure is published", "schemes": names}
        act, com = sum(b[1] for b in both), sum(b[2] for b in both)
        pct = act / com * 100
        sc = CHECK if pct >= THRESHOLDS["pli_hi"] else CROSS if pct < THRESHOLDS["pli_lo"] else DASH
        return {"score": sc,
                "value": r1(pct, 0), "actual": act, "committed": com, "schemes": names,
                "used": [b[0] for b in both], "confidence": min((c for s, c in schemes if s in [b[0] for b in both]), key=["exact", "approximate", "loose"].index)}

    def credit_signal(g):
        if not credit_out:
            return no_data("rbi_credit")
        c = credit_out["groups"].get(g)
        if not c:
            return {"score": None, "why": "No RBI credit line for this industry"}
        return {"score": score(c["diff"], -THRESHOLDS["credit_pts"], THRESHOLDS["credit_pts"]), "value": c["yoy"],
                "reference": credit_out["total_yoy"], "diff": c["diff"], "confidence": c["confidence"],
                "from": credit_out["prev"], "to": credit_out["last"]}

    def fdi_signal(g):
        if not fdi_out:
            return no_data("dpiit_fdi")
        f = fdi_out["groups"].get(g)
        if not f or f["tilt"] is None:
            return {"score": None, "why": "No DPIIT FDI sector maps to this industry"}
        return {"score": score(f["tilt"], -THRESHOLDS["fdi_pct"], THRESHOLDS["fdi_pct"]), "value": f["tilt"],
                "share_old": f["share_old"], "share_recent": f["share_recent"], "confidence": f["confidence"],
                "old": fdi_out["periods"][0], "recent": f"{fdi_out['periods'][1]}-{fdi_out['periods'][3]}"}

    def no_data(src):
        return {"score": None, "why": f"Awaiting the {manual[src]['label']} files" if manual[src]["status"] != "ok" else "Not yet parsed"}

    # ---- rows
    rows = []
    T = THRESHOLDS
    for nic, sec in name_of.items():
        g = nic_group[nic]
        series = new_m[sub_of[nic]]
        ann_new = sec["new"]["index"][-1]
        recent = cagr(100, ann_new, years_new)
        longrun = sec["cagr"]
        rel = (recent - recent_all) - (longrun - longrun_all)
        beats = [series[ym][1] > longrun for ym in last12 if ym in series and series[ym][1] is not None]
        consistency = 100 * sum(beats) / len(beats) if beats else None
        v = nic_val[nic]
        f_c = cagr(fcpw(nic, a0), fcpw(nic, latest), span_d)
        fac = cagr(v["factories"].get(a0), v["factories"].get(latest), span_d)
        d_ok = [f_c is not None and india_fcpw is not None and f_c > india_fcpw, fac is not None and fac > 0]
        asi_sig = {"score": None if f_c is None or fac is None else [CROSS, DASH, CHECK][sum(d_ok)],
                   "fcpw_cagr": r1(f_c), "india_fcpw_cagr": r1(india_fcpw), "factories_cagr": r1(fac),
                   "from": a0, "to": latest, "confidence": "exact"}
        signals = {"credit": credit_signal(g), "imports": imports_signal(g), "fdi": fdi_signal(g),
                   "asi": asi_sig, "pli": pli_signal(g)}
        scores = [s["score"] for s in signals.values()]
        checks, crosses = scores.count(CHECK), scores.count(CROSS)
        available = sum(s is not None for s in scores)
        if rel > T["momentum_pts"]:
            label = "Rising + backed" if checks >= T["checks_for_backed"] else "Rising, unconfirmed"
        elif rel < -T["momentum_pts"]:
            label = "Fading"
        else:
            label = "Steady"
        quadrant = ("Steady leaders" if longrun >= longrun_all and recent >= recent_all else
                    "New risers" if recent >= recent_all else
                    "Fading" if longrun >= longrun_all else "Laggards")
        persons = v["persons"].get(latest)
        gva, out = v["gva"].get(latest), v["output"].get(latest)
        va_share = gva / out * 100 if gva and out else None
        old_since = sec["index"][-1] / sec["index"][iip["annual"]["fys"].index("2022-23")] * 100 - 100
        risks = []
        if persons is not None and persons < T["small_base_persons"]:
            risks.append(f"Small base: {int(persons):,} people work in its registered factories, so a few plants can swing the index.")
        if abs(old_since - sec["new"]["change_pct"]) > T["basket_gap_pts"]:
            risks.append(f"Basket change: since 2022-23 the new index shows {sec['new']['change_pct']:+.0f}% but the old one {old_since:+.0f}%; part of the momentum may be what each basket counts.")
        if consistency is not None and consistency < T["consistency_low_pct"]:
            risks.append(f"Uneven: it beat its long-run pace in only {consistency:.0f}% of the last 12 months; a few strong months may be doing the work.")
        if va_share is not None and va_share < T["low_value_added_pct"]:
            risks.append(f"Assembly-heavy: value added is only {va_share:.0f}% of output (ASI {latest}), so rising output may mean imported parts more than local manufacturing.")
        if not risks:
            risks.append(f"Short window: recent momentum covers only {years_new} years of the new index; one weak year would change the picture.")
        rows.append({
            "nic": nic, "name": sec["name"], "group": g, "group_name": groups[g]["name"], "pli_tag": sec.get("pli"),
            "longrun": r1(longrun, 2), "recent": r1(recent, 2), "relative": r1(rel, 2), "consistency": r1(consistency, 0),
            "old_since_2022": r1(old_since), "new_since_2022": sec["new"]["change_pct"],
            "persons": persons, "va_share": r1(va_share), "signals": signals,
            "checks": checks, "crosses": crosses, "available": available, "label": label, "quadrant": quadrant, "risks": risks,
        })
    order = {"Rising + backed": 0, "Rising, unconfirmed": 1, "Steady": 2, "Fading": 3}
    rows.sort(key=lambda r: (order[r["label"]], -r["relative"]))
    watch = [r["nic"] for r in rows if r["label"] == "Rising + backed"][:3]

    screen = {
        "thresholds": T, "reference": {"longrun_all": r1(longrun_all, 2), "recent_all": r1(recent_all, 2),
                                        "longrun_window": [iip["headline"]["from_fy"], iip["headline"]["to_fy"]],
                                        "recent_window": ["2022-23", new_fy[-1]], "last12": [f"{y}-{m:02d}" for y, m in last12]},
        "rows": rows, "watchlist": watch,
        "counts": {k: sum(r["label"] == k for r in rows) for k in order},
        "signals_available": {k: (manual[s]["status"] == "ok") if s else True
                              for k, s in (("credit", "rbi_credit"), ("imports", None), ("fdi", "dpiit_fdi"), ("asi", None), ("pli", None))},
        "manual": manual,
    }

    # ---- pipeline
    cap_months = sorted(capg)
    mfg_m = iip["monthly"]
    asi_years = asi["years"]
    gfcf_real = [r1(nic_val["99999"]["gfcf"].get(y, 0) / (wpi[y] / 100) / 100, 0) if y in wpi and nic_val["99999"]["gfcf"].get(y) else None for y in asi_years]
    pli_total = {m: pli_by["ALL 14 SCHEMES"][(m, "actual")] for m in ("investment", "production", "employment")}
    stages = [
        {"stage": "Announced", "items": [
            {"label": "PLI investment so far", "value": pli_total["investment"], "unit": "Rs crore", "period": pli_meta["ALL 14 SCHEMES"]["as_of"],
             "source": "NITI Aayog", "link": pli_meta["ALL 14 SCHEMES"]["link"], "trend": None, "status": "ok"},
            ({"label": "FDI equity into manufacturing", "value": round(fdi_out["manufacturing"][3] / 1000, 1), "unit": "US$ billion",
              "period": f"calendar {fdi_out['periods'][3]}", "growth": r1((fdi_out["manufacturing"][3] / fdi_out["manufacturing"][2] - 1) * 100),
              "trend": {"x": fdi_out["periods"][1:4], "y": fdi_out["manufacturing"][1:4]}, "status": "ok", "source": "DPIIT (mapped sectors)"}
             if fdi_out else {"label": "FDI equity into manufacturing", "status": "no_data"})]},
        {"stage": "Financed", "items": [
            ({"label": "Bank credit to manufacturing", "value": credit_out["manufacturing"][-1], "unit": "Rs crore", "period": credit_out["last"],
              "growth": r1((credit_out["manufacturing"][-1] / credit_out["manufacturing"][-2] - 1) * 100),
              "trend": {"x": credit_out["septembers"], "y": credit_out["manufacturing"]}, "status": "ok", "source": "RBI (mapped industries)"}
             if credit_out else {"label": "Bank credit to manufacturing", "status": "no_data"})]},
        {"stage": "Spent", "items": [
            {"label": "Capital-goods imports (HS 84-85)", "value": round(usd["CAPITAL_ALL"][-1] / 1000, 1), "unit": "US$ billion", "period": fys[-1],
             "growth": r1((usd["CAPITAL_ALL"][-1] / usd["CAPITAL_ALL"][-2] - 1) * 100), "trend": {"x": fys, "y": usd["CAPITAL_ALL"]}, "status": "ok", "source": "TradeStat (DGCI&S)"},
            {"label": "Capital goods output index", "value": capg[cap_months[-1]][0], "unit": "2022-23 = 100", "period": f"{cap_months[-1][0]}-{cap_months[-1][1]:02d}",
             "growth": capg[cap_months[-1]][1], "trend": {"x": [f"{y}-{m:02d}" for y, m in cap_months], "y": [capg[k][0] for k in cap_months]}, "status": "ok", "source": "IIP use-based (MoSPI)"}]},
        {"stage": "Installed", "items": [
            {"label": "New fixed capital in factories", "value": gfcf_real[-1], "unit": "Rs crore, 2011-12 prices", "period": latest,
             "growth": r1((gfcf_real[-1] / gfcf_real[-2] - 1) * 100) if gfcf_real[-2] else None, "trend": {"x": asi_years, "y": gfcf_real}, "status": "ok", "source": "ASI gross fixed capital formation (MoSPI)"}]},
        {"stage": "Output", "items": [
            {"label": "Manufacturing output index", "value": mfg_m["series"]["manufacturing"]["index"][-1], "unit": "2022-23 = 100", "period": mfg_m["dates"][-1],
             "growth": mfg_m["series"]["manufacturing"]["yoy"][-1], "trend": {"x": mfg_m["dates"][-36:], "y": mfg_m["series"]["manufacturing"]["index"][-36:]}, "status": "ok", "source": "IIP (MoSPI)"}]},
    ]
    schemes = []
    for r in rows_map:
        if r["source"] != "pli":
            continue
        s = r["source_category"]
        d = pli_by[s]
        schemes.append({"scheme": s, "group": r["group"], "actual": d.get(("investment", "actual")),
                        "committed": d.get(("investment", "committed")), "production": d.get(("production", "actual")),
                        "employment": d.get(("employment", "actual")), **pli_meta[s]})
    schemes.sort(key=lambda x: -(x["actual"] or 0))
    invest = {
        "pipeline": stages,
        "imports": {"fys": fys, "ch84": usd["CH84"], "ch85": usd["CH85"], "capital_all": usd["CAPITAL_ALL"],
                    "not_capital": usd["NOT_CAPITAL"], "general": usd["GENERAL"], "hs8486": usd.get("HS8486"),
                    "mapped_by_group": {g: usd[g] for g in groups if g in usd},
                    "inr_capital_all": tr["inr"]["CAPITAL_ALL"], "all_imports": usd["ALL_IMPORTS"],
                    "source": "https://tradestat.commerce.gov.in/eidb/commodity_wise_import"},
        "pli": {"schemes": schemes, "total": pli_total, "as_of": pli_meta["ALL 14 SCHEMES"]["as_of"],
                "source": pli_meta["ALL 14 SCHEMES"]["source"], "link": pli_meta["ALL 14 SCHEMES"]["link"]},
        "capital_goods_iip": {"dates": [f"{y}-{m:02d}" for y, m in cap_months], "index": [capg[k][0] for k in cap_months], "yoy": [capg[k][1] for k in cap_months]},
        "gfcf_real": {"years": asi_years, "value": gfcf_real},
        "credit": {**manual["rbi_credit"], **(credit_out or {})}, "fdi": {**manual["dpiit_fdi"], **(fdi_out or {})},
        "obicus": {**manual["rbi_obicus"], **({"series": OB["series"], "file": OB["file"],
                   "source": "https://www.rbi.org.in/Scripts/PublicationsView.aspx?id=24087", "reference": 75} if OB else {})},
        "groups": {g: d["name"] for g, d in groups.items()},
        "mapping_summary": mapping_summary(rows_map, groups),
    }
    return invest, screen
