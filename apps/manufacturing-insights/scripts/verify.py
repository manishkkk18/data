"""4. Check the built data against MoSPI's own published figures -> data/meta.json (shown on the page).

Published values are typed in from the releases below (quote, don't compute). When a release is a
Quick Estimate, the API may already hold the revised number a month later: that is reported as
"revised", not a failure. Anything else that disagrees stops the script.

On a refresh: add the newest month's release here (and the next ASI year's headline figures).
"""
import json
import math
import re
from datetime import date

from common import DATA, ROOT, write

iip = json.loads((DATA / "iip.json").read_text("utf-8"))
asi = json.loads((DATA / "asi.json").read_text("utf-8"))
hl = json.loads((DATA / "headline.json").read_text("utf-8"))


def month(series: str, ym: str, what: str = "index"):
    m = iip["monthly"]
    return m["series"][series][what][m["dates"].index(ym)]


AUG_PR = "https://www.mospi.gov.in/uploads/latestReleases/latest_release_1790590696008_1b346687-0a5f-445a-83a2-28283c586094_IIP_Press_Release_August_2026.pdf"
SEP_AIR = "https://newsonair.gov.in/indias-industrial-output-grows-by-6-7-in-september-2026/"
ASI_PR = "https://www.mospi.gov.in/uploads/latestReleases/latest_release_1790768522303_b1ee6ba9-c9d3-481a-b30e-45a24c7f3729_PIB_Note_ASI_2024-25_English.pdf"
ASI_VISION = "https://visionias.in/current-affairs/news-today/2025-08-28/economy/annual-survey-of-industries-asi-results-for-2023-24-released"

g = asi["india"]["series"]
yrs = asi["years"]
i23, i22 = yrs.index("2023-24"), yrs.index("2022-23")
checks = [
    # (what, published, ours, tolerance, source, note)
    ("IIP September 2026, General index (quick estimate)", 124.3, month("general", "2026-09"), 0.05, SEP_AIR, "Released 28 Oct 2026"),
    ("IIP September 2026, General growth %", 6.7, month("general", "2026-09", "yoy"), 0.05, SEP_AIR, ""),
    ("IIP September 2026, Manufacturing growth %", 7.6, month("manufacturing", "2026-09", "yoy"), 0.05, SEP_AIR, ""),
    ("IIP August 2026, Manufacturing index (quick estimate)", 126.6, month("manufacturing", "2026-08"), 0.05, AUG_PR, "Quick estimate; revised a month later"),
    ("IIP August 2026, Manufacturing growth % (quick estimate)", 9.0, month("manufacturing", "2026-08", "yoy"), 0.05, AUG_PR, "Quick estimate; revised a month later"),
    ("ASI 2023-24, number of factories", 260061, g["factories"][yrs.index("2023-24")], 0, ASI_PR, "From ASI 2024-25 press note's comparison with 2023-24 (\"2.60 lakhs\") and the ASI 2024-25 factsheet (2,60,061)"),
    ("ASI 2023-24, persons engaged (crore)", 1.96, round(g["persons"][i23] / 1e7, 2), 0.005, ASI_PR, "\"1.96 crore in ASI 2023-24\""),
    ("ASI 2023-24, GVA growth over 2022-23 at current prices %", 11.89, round((g["gva_nominal"][i23] / g["gva_nominal"][i22] - 1) * 100, 2), 0.005, ASI_VISION, "Summary of MoSPI's ASI 2023-24 release, 28 Aug 2025"),
]

out = []
bad = []
for what, pub, ours, tol, src, note in checks:
    if ours is None:
        status = "missing"
    elif abs(pub - ours) <= tol:
        status = "match"
    elif "Quick estimate" in note:
        status = "revised"
    else:
        status = "MISMATCH"
    out.append({"what": what, "published": pub, "ours": ours, "status": status, "source": src, "note": note})
    print(f"[{status:8}] {what}: published {pub}, ours {ours}")
    if status in ("MISMATCH", "missing"):
        bad.append(what)

meta = {
    "built": date.today().isoformat(),
    "iip_latest_month": iip["latest_month"],
    "asi_latest_year": asi["latest"],
    "asi_newer_note": "ASI 2024-25 headline results were released on 30 Sep 2026, but its state x industry tables are not yet in MoSPI's eSankhyiki data; this page uses 2023-24, the latest year available there.",
    "asi_2024_25_headline": {"source": ASI_PR, "factories_lakh": 2.67, "gva_growth_pct": 9.59, "employment_growth_pct": 7.19},
    "checks": out,
}
write("meta.json", meta)

# ---------- internal consistency: headline windows, same-window numbers, nothing hard-coded
problems = []


def need(cond, what):
    print(f"[{'ok' if cond else 'FAIL':8}] {what}")
    if not cond:
        problems.append(what)


def close(a, b, tol=0.051):
    return a is not None and b is not None and abs(a - b) <= tol


def fy0(fy):
    return int(fy[:4])


O, OL, F, SW, D = hl["output"], hl["output_linked"], hl["factory"], hl["same_window"], hl["deflation_latest"]
fys = iip["annual"]["fys"]
mfg = dict(zip(fys, iip["annual"]["manufacturing_2011"]))
yrs = asi["years"]
ser = asi["india"]["series"]
ib, il = yrs.index(asi["base"]), len(yrs) - 1

# 1. each headline's window is what its label says, and its numbers come from that window
need(O["from_fy"] == iip["sector_years"][0] and O["to_fy"] == fys[-1] and O["years"] == fy0(O["to_fy"]) - fy0(O["from_fy"]),
     f"output headline window is {O['from_fy']} to {O['to_fy']} ({O['years']} years), the 2011-12 series' full span")
need(O["from"] == mfg[O["from_fy"]] and O["to"] == mfg[O["to_fy"]] and close(O["change_pct"], (O["to"] / O["from"] - 1) * 100),
     f"output headline {O['change_pct']}% = IIP {O['from']} -> {O['to']}")
need(F["from_fy"] == asi["base"] and F["to_fy"] == asi["latest"] and F["years"] == fy0(F["to_fy"]) - fy0(F["from_fy"]),
     f"factory headline window is {F['from_fy']} to {F['to_fy']} ({F['years']} years)")
for k in ("gva_real", "persons", "gva_per_person"):
    a, b = ser[k][ib], ser[k][il]
    need(F[f"{k}_from"] == a and F[f"{k}_to"] == b and close(F[f"{k}_change_pct"], (b / a - 1) * 100),
         f"factory {k}: {F[f'{k}_change_pct']}% = ASI {a} -> {b}")
need(close(F["gva_per_person_cagr"], ((F["gva_per_person_to"] / F["gva_per_person_from"]) ** (1 / F["years"]) - 1) * 100, 0.06),
     f"output per worker {F['gva_per_person_cagr']}% a year matches its own endpoints")
# value added per worker must follow from value added and jobs (like for like)
implied = ((1 + F["gva_real_change_pct"] / 100) / (1 + F["persons_change_pct"] / 100) - 1) * 100
need(close(implied, F["gva_per_person_change_pct"], 0.3),
     f"value added {F['gva_real_change_pct']}% and jobs {F['persons_change_pct']}% imply {implied:.1f}% per worker; headline says {F['gva_per_person_change_pct']}%")

# 2. same-window IIP vs ASI
need(SW["from_fy"] == F["from_fy"] and SW["to_fy"] == F["to_fy"], "IIP vs ASI comparison uses ASI's window")
need(SW["iip_from"] == mfg[SW["from_fy"]] and SW["iip_to"] == mfg[SW["to_fy"]] and close(SW["iip_change_pct"], (SW["iip_to"] / SW["iip_from"] - 1) * 100),
     f"same-window IIP {SW['iip_from']} -> {SW['iip_to']} = {SW['iip_change_pct']}%")
need(SW["asi_gva_real_change_pct"] == F["gva_real_change_pct"], "same-window ASI figure is the headline's")
need(close(OL["to"], OL["new_index"] * OL["factor"]) and OL["factor"] == iip["monthly"]["link_factors"]["Manufacturing"]
     and close(OL["change_pct"], (OL["to"] / OL["from"] - 1) * 100),
     f"linked alternative {OL['new_index']} x {OL['factor']} = {OL['to']}, {OL['change_pct']}%")
need(OL["change_pct"] >= O["change_pct"], "headline uses the lower (conservative) of the two output figures")
wpi = asi["deflator"]["index"]
need(D["wpi_prev"] == wpi[D["prev_fy"]] and D["wpi_latest"] == wpi[D["latest_fy"]], "deflation note quotes the WPI used")
real = ((1 + D["nominal_growth_pct"] / 100) * D["wpi_prev"] / D["wpi_latest"] - 1) * 100
need(close(real, D["real_growth_pct"], 0.02), f"real growth {D['real_growth_pct']}% = nominal {D['nominal_growth_pct']}% deflated")

# 3. nothing hard-coded: index.html has no statistics except the generated share text
page = (ROOT / "index.html").read_text("utf-8")
share = re.findall(r'data-headline="share"[^>]*content="([^"]*)"', page)
need(len(share) == 2 and all(t == hl["share_text"].replace("&", "&amp;").replace('"', "&quot;") for t in share),
     "og/twitter descriptions are the generated share text")
rest = re.sub(r'<meta [^>]*data-headline="share"[^>]*>', "", page)
stats = re.findall(r"[+\u2212-]?\d[\d,.]*\s?(?:%|per ?cent|lakh|crore)", rest, flags=re.I)
need(not stats, f"no hard-coded statistics in index.html (found: {stats[:5]})")
# the share text's numbers are the headline's
for n in (O["change_pct"], F["gva_real_change_pct"], F["persons_change_pct"]):
    need(f"{n:.0f}%" in hl["share_text"], f"share text quotes {n:.0f}%")
need(O["from_fy"] in hl["share_text"] and O["to_fy"] in hl["share_text"] and F["to_fy"] in hl["share_text"],
     "share text names both windows")
# Ladakh and small bases
need(all(v is None for v in asi["states"]["Ladakh"]["growth"].values()), "Ladakh has no separate growth figure")
need(asi["states"]["Jammu and Kashmir"]["growth_label"] is not None, "J&K growth is labelled as including Ladakh")

# ---------- investment pipeline and momentum screen
import csv as _csv

from invest import THRESHOLDS as T, CHECK, DASH, CROSS

inv = json.loads((DATA / "invest.json").read_text("utf-8"))
scr = json.loads((DATA / "screen.json").read_text("utf-8"))
mp = list(_csv.DictReader((ROOT / "scripts" / "mapping" / "industry_map.csv").open(encoding="utf-8")))
groups = {r["source_category"] for r in mp if r["source"] == "group"}

# mapping: every row points at a known group (or is explicitly unused), every HS4 in 84-85 has a row
bad_rows = [r for r in mp if r["source"] != "group" and any(g not in groups | {"-", "GENERAL", "REFERENCE"} for g in r["group"].split())]
need(not bad_rows, f"every mapping row names a known group or is marked unused ({len(mp)} rows)")
need(all(r["confidence"] in ("exact", "approximate", "loose") for r in mp if r["group"] not in ("-", "GENERAL", "REFERENCE") and r["source"] != "group"),
     "every mapped row has a confidence flag")
hs_rows = {r["source_category"] for r in mp if r["source"] == "hs4"}
cache_hs = set()
for f in (ROOT / "scripts" / ".cache" / "trade").glob("hs4_*.json"):
    cache_hs |= {x["hs4"] for x in json.loads(f.read_text("utf-8")) if x["hs4"][:2] in ("84", "85")}
need(cache_hs <= hs_rows, f"all {len(cache_hs)} HS4 codes seen in chapters 84-85 are in the mapping")

# published figures: TradeStat's own chapter-84 total and NITI's PLI totals
ch84 = sum(x["value"] or 0 for x in json.loads((ROOT / "scripts" / ".cache" / "trade" / "hs4_inr_crore_2024-25.json").read_text("utf-8")) if x["hs4"][:2] == "84")
need(abs(ch84 - 543949.32) < 1, f"TradeStat chapter 84 imports 2024-25: HS4 rows sum to {ch84:,.2f} crore vs the published chapter total 543,949.32")
pli_rows = list(_csv.DictReader((ROOT / "scripts" / "raw" / "pli_schemes.csv").open(encoding="utf-8")))
for metric in ("investment", "employment"):
    parts = sum(float(r["value"]) for r in pli_rows if r["metric"] == metric and r["kind"] == "actual" and r["scheme"] != "ALL 14 SCHEMES")
    total = next(float(r["value"]) for r in pli_rows if r["metric"] == metric and r["scheme"] == "ALL 14 SCHEMES")
    need(abs(parts - total) < 1, f"PLI {metric}: 14 schemes sum to {parts:,.1f}, NITI total {total:,.0f}")

# the hand-downloaded sources: published figures match what we read
if inv["credit"].get("status") == "ok":
    import openpyxl
    f = next(f for f in (ROOT / "scripts" / "raw" / "rbi_credit").glob("*.xlsx") if inv["credit"]["files"][-1]["file"] == f.name)
    rows = list(openpyxl.load_workbook(f, read_only=True, data_only=True)["Statement 2"].iter_rows(values_only=True))
    tot = next(r for r in rows if str(r[0] or "").strip().startswith("Industries"))
    published = float(tot[7])   # RBI's own year-on-year % for the latest September
    need(abs(published - inv["credit"]["total_yoy"]) < 0.06, f"RBI all-industry credit growth: published {published:.2f}%, ours {inv['credit']['total_yoy']}%")
if inv["obicus"].get("status") == "ok":
    last = inv["obicus"]["series"][-1]
    need(last["quarter"] == "Q1:2026-27" and last["cu_sa"] == 76.3 or last["quarter"] != "Q1:2026-27",
         f"OBICUS {last['quarter']} seasonally adjusted {last['cu_sa']}% (RBI release for Q1:2026-27: 76.3%)")
if inv["fdi"].get("status") == "ok":
    import read_raw
    FD = read_raw.fdi()
    sums = [round(sum((x["usd"][i] or 0) for x in FD["sectors"] if not x["name"].startswith("RBI")), 1) for i in range(5)]
    need(all(abs(a - b) < 0.5 for a, b in zip(sums, FD["subtotal"])), f"DPIIT FDI: {len(FD['sectors'])} sector rows add up to the table's subtotal {FD['subtotal']}")

# no data is never zero, and every signal follows its documented threshold
def rescore(v, lo, hi):
    return CHECK if v >= hi else CROSS if v <= lo else DASH

zero_nd, wrong = [], []
for r in scr["rows"]:
    for k, sg in r["signals"].items():
        if sg["score"] is None and any(sg.get(x) == 0 for x in ("value", "diff")):
            zero_nd.append(f"{r['nic']}:{k}")
    im = r["signals"]["imports"]
    if im["score"] is not None and im["score"] != rescore(im["diff"], -T["imports_pts"], T["imports_pts"]):
        wrong.append(f"{r['nic']} imports")
    a = r["signals"]["asi"]
    if a["score"] is not None:
        n = (a["fcpw_cagr"] > a["india_fcpw_cagr"]) + (a["factories_cagr"] > 0)
        if a["score"] != [CROSS, DASH, CHECK][n]:
            wrong.append(f"{r['nic']} asi")
    cr = r["signals"]["credit"]
    if cr["score"] is not None and cr["score"] != rescore(cr["diff"], -T["credit_pts"], T["credit_pts"]):
        wrong.append(f"{r['nic']} credit")
    fd = r["signals"]["fdi"]
    if fd["score"] is not None and fd["score"] != rescore(fd["value"], -T["fdi_pct"], T["fdi_pct"]):
        wrong.append(f"{r['nic']} fdi")
    pl = r["signals"]["pli"]
    if pl["score"] is not None:
        exp = CHECK if pl["value"] >= T["pli_hi"] else CROSS if pl["value"] < T["pli_lo"] else DASH
        if pl["score"] != exp:
            wrong.append(f"{r['nic']} pli")
    checks = [sg["score"] for sg in r["signals"].values()].count(CHECK)
    rel = r["relative"]
    exp_label = ("Rising + backed" if checks >= T["checks_for_backed"] else "Rising, unconfirmed") if rel > T["momentum_pts"] \
        else "Fading" if rel < -T["momentum_pts"] else "Steady"
    if r["label"] != exp_label or r["checks"] != checks:
        wrong.append(f"{r['nic']} label")
    ref = scr["reference"]
    if not math.isclose(rel, (r["recent"] - ref["recent_all"]) - (r["longrun"] - ref["longrun_all"]), abs_tol=0.02):
        wrong.append(f"{r['nic']} relative momentum")
need(not zero_nd, f"no 'no data' signal carries a zero ({zero_nd[:4]})")
need(not wrong, f"every signal and label follows its rule ({wrong[:6]})")
need(all(it.get("value") is None for st in inv["pipeline"] for it in st["items"] if it["status"] != "ok"),
     "pipeline stages without data show no number")
need(set(scr["watchlist"]) <= {r["nic"] for r in scr["rows"] if r["label"] == "Rising + backed"}, "watchlist only holds 'Rising + backed' industries")

# framing: a momentum screen, never a forecast
texts = [(ROOT / "index.html").read_text("utf-8")] + [f.read_text("utf-8") for f in (ROOT / "js").glob("*.js")] + \
        [(DATA / n).read_text("utf-8") for n in ("screen.json", "invest.json", "headline.json")]
flat = " ".join(t.lower() for t in texts).replace("not a forecast", "")
banned = [w for w in ("predict", "will boom", "forecast") if w in flat]
need(not banned, f"no forecasting language on the page, apart from 'not a forecast' (found: {banned})")

if problems:
    raise SystemExit(f"consistency checks failed: {problems}")
if bad:
    raise SystemExit(f"checks failed: {bad}")
