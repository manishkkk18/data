"""Sanity checks for one month: a choropleth PNG plus bright/dim spot checks.

  python -m nightlights.qa 2025-10
"""

import sys

import geopandas as gpd
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap, LogNorm  # noqa: E402

from .config import DISTRICTS_WEB, QA, STATS  # noqa: E402

# Expected bright and expected dim districts (ids from data/districts.geojson).
BRIGHT = ["delhi--new-delhi", "delhi--central", "maharashtra--mumbai", "karnataka--bangalore"]
DIM = [
    "arunachal-pradesh--tawang",
    "arunachal-pradesh--dibang-valley",
    "arunachal-pradesh--upper-subansiri",
    "nagaland--kiphire",
    "mizoram--saiha",
    "manipur--tamenglong",
]

NIGHT = LinearSegmentedColormap.from_list("night", ["#0B0F1A", "#3a2a10", "#FFB547", "#FFF6E0"])


def report(month: str, product: str = "VNP46A3") -> dict:
    df = pd.read_csv(STATS / product / f"{month}.csv")
    geo = gpd.read_file(DISTRICTS_WEB).merge(df, on="id", how="left")

    ranked = df.dropna(subset=["mean_rad"]).sort_values("mean_rad", ascending=False).reset_index(drop=True)
    ranked["rank"] = ranked.index + 1
    pct = ranked.set_index("id")["rank"] / len(ranked) * 100  # 0 = brightest

    print(f"\n=== {month}: {len(ranked)}/{len(df)} districts with data ===")
    names = geo.set_index("id")[["name", "state"]]
    show = lambda r: f"{names.loc[r.id, 'name']}, {names.loc[r.id, 'state']}: {r.mean_rad:.2f}"  # noqa: E731
    print("Brightest 10:")
    for r in ranked.head(10).itertuples():
        print("  ", show(r))
    print("Dimmest 10:")
    for r in ranked.tail(10).itertuples():
        print("  ", show(r))

    checks = {}
    print("Spot checks (percentile 0 = brightest):")
    for ids, want in ((BRIGHT, "bright"), (DIM, "dim")):
        for i in ids:
            if i not in names.index:
                print(f"   ? {i} not in boundaries")
                continue
            p = pct.get(i, np.nan)
            ok = (p <= 5) if want == "bright" else (p >= 70)
            checks[i] = bool(ok)
            v = df.set_index("id").loc[i]
            print(f"   {'PASS' if ok else 'FAIL'} {want:6} {i}: mean {v.mean_rad:.2f}, top {p:.1f}%, observed {v.valid_pct:.0f}%")

    QA.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(9, 10), facecolor="#0B0F1A")
    ax.set_facecolor("#0B0F1A")
    vals = geo["mean_rad"].clip(lower=0.05)
    geo.assign(v=vals).plot(
        column="v", ax=ax, cmap=NIGHT, norm=LogNorm(0.05, vals.max()), edgecolor="#232B40", linewidth=0.15,
        missing_kwds={"color": "#1d2235", "hatch": "///", "edgecolor": "#3a4258", "linewidth": 0.15},
    )
    ax.set_title(f"Mean night radiance by district, {month} (log scale; hatched = gap)", color="#E8ECF5")
    ax.set_axis_off()
    out = QA / f"{product}_{month}.png"
    fig.savefig(out, dpi=150, bbox_inches="tight", facecolor=fig.get_facecolor())
    plt.close(fig)
    print(f"Wrote {out}")
    return checks


if __name__ == "__main__":
    report(sys.argv[1])
