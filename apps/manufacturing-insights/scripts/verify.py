"""4. Check the built data against MoSPI's own published figures -> data/meta.json (shown on the page).

Published values are typed in from the releases below (quote, don't compute). When a release is a
Quick Estimate, the API may already hold the revised number a month later: that is reported as
"revised", not a failure. Anything else that disagrees stops the script.

On a refresh: add the newest month's release here (and the next ASI year's headline figures).
"""
import json
from datetime import date

from common import DATA, write

iip = json.loads((DATA / "iip.json").read_text("utf-8"))
asi = json.loads((DATA / "asi.json").read_text("utf-8"))


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
if bad:
    raise SystemExit(f"checks failed: {bad}")
