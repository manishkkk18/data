"""Markdown summary of the last pipeline run (for the GitHub Actions run page)."""
from __future__ import annotations

import json
import math

from .config import DATA


def _load(name: str):
    p = DATA / name
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def main() -> None:
    meta = _load("meta.json") or {}
    fires = _load("fires_recent.json")
    summary = _load("fires_summary_recent.json") or {}
    aq = _load("aq_delhi_recent.json")
    out = ["## Delhi Smoke Watch: pipeline run", ""]

    if fires:
        out += [f"**Fires:** {len(fires['rows']):,} detections, source `{fires['method']}`, "
                f"latest {fires['latest_detection_utc']}, satellites {', '.join(fires['satellites'])}", ""]
        out += ["| State | Detections | NOAA-20 only |", "|---|---:|---:|"]
        out += [f"| {r['state']} | {r['detections']:,} | {r['detections_n20']:,} |" for r in summary.get("by_state", [])]
        ly = summary.get("same_day_last_year") or {}
        out += ["", f"**Same day last year (NOAA-20, India):** {ly}", ""]
    else:
        out += ["**Fires:** no output", ""]

    up = _load("upwind_recent.json")
    if up:
        out += ["**Upwind fire share (indicative)**, by IST day:", "", "| Day | Complete | Load/arrival | Top states |", "|---|---|---:|---|"]
        for d in up["days"]:
            top = ", ".join(f"{s} {v:.0%}" for s, v in d["states"][:3]) or "–"
            out.append(f"| {d['date']} | {'yes' if d['complete'] else 'partial'} | {d['load']:,} | {top} |")
        out.append("")
    else:
        out += [f"**Upwind:** not produced ({meta.get('upwind', {}).get('error', 'no wind')})", ""]

    w = meta.get("wind", {})
    out += [f"**Wind:** {'latest ' + str(w.get('latest_utc')) if 'latest_utc' in w else 'error: ' + str(w.get('error'))}", ""]

    if aq:
        hourly = [r for r in aq["hourly"] if r["parameter"] == "pm25"]
        ok = [r for r in hourly if r["value"] is not None]
        daily = [r for r in aq["daily"] if r["parameter"] == "pm25"]
        out += [f"**Air quality (OpenAQ):** {aq['sensors_recent']} Delhi PM sensors reporting recently "
                f"(of {aq['sensors_total']} listed); providers: {', '.join(aq['providers']) or '–'}",
                f"PM2.5 hours with ≥3 stations: {len(ok)} of {len(hourly)}", "",
                "| Day (IST) | PM2.5 µg/m³ | Hours |", "|---|---:|---:|"]
        for r in daily:
            v = r["value"]
            out.append(f"| {r['date']} | {'gap' if v is None or (isinstance(v, float) and math.isnan(v)) else round(v)} | {r['n_hours']} |")
    else:
        out += [f"**Air quality:** not produced ({meta.get('aq', {}).get('error', 'unknown')})"]

    print("\n".join(out))


if __name__ == "__main__":
    main()
