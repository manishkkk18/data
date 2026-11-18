"""Quick PNG to eyeball the Phase 1 output: districts, fires by age and FRP, Delhi."""
from __future__ import annotations

import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from .boundaries import load_districts
from .config import BBOX, DATA, DELHI, FOCUS_STATES, OUT


def main() -> None:
    d = load_districts()
    p = json.loads((DATA / "live" / "index.json").read_text(encoding="utf-8"))
    rows = [r for d in p["days"] for r in json.loads((DATA / "live" / d["file"]).read_text(encoding="utf-8"))["rows"]]
    f = pd.DataFrame(rows, columns=p["columns"])
    f["t"] = pd.Timestamp(p["t0"]) + pd.to_timedelta(f["t_min"], unit="m")
    age_h = (f["t"].max() - f["t"]).dt.total_seconds() / 3600

    fig, ax = plt.subplots(figsize=(10, 10), facecolor="#0B0F1A")
    ax.set_facecolor("#0B0F1A")
    d.boundary.plot(ax=ax, color="#2A3350", linewidth=0.4)
    d.dissolve("state").boundary.plot(ax=ax, color="#5A6585", linewidth=1.0)
    sc = ax.scatter(f["lon"], f["lat"], s=4 + f["frp"].clip(upper=60) * 0.6, c=age_h, cmap="autumn",
                    vmin=0, vmax=24 * p["window_days"], alpha=0.75, linewidths=0)
    ax.plot(*DELHI, marker="*", color="#6EA8FF", markersize=16)
    ax.annotate("Delhi", DELHI, xytext=(6, 6), textcoords="offset points", color="#6EA8FF")
    for state, g in d.dissolve("state").iterrows():
        if state in FOCUS_STATES:
            c = g.geometry.representative_point()
            ax.annotate(state, (c.x, c.y), color="#9AA3B8", ha="center", fontsize=9)
    w, s, e, n = BBOX
    ax.set_xlim(w, e); ax.set_ylim(s, n); ax.set_aspect(1 / 0.88)
    ax.tick_params(colors="#5A6585")
    cb = fig.colorbar(sc, ax=ax, shrink=0.5, pad=0.02)
    cb.set_label("hours before latest detection", color="#9AA3B8"); cb.ax.tick_params(colors="#9AA3B8")
    ax.set_title(f"FIRMS detections, last {p['window_days']} days ({len(f):,}) | latest {f['t'].max():%d %b %H:%M} UTC | source: {p['method']}",
                 color="#E6E9F2", fontsize=10)
    OUT.mkdir(parents=True, exist_ok=True)
    fig.savefig(OUT / "sanity_map.png", dpi=110, bbox_inches="tight", facecolor=fig.get_facecolor())
    print(OUT / "sanity_map.png")


if __name__ == "__main__":
    main()
