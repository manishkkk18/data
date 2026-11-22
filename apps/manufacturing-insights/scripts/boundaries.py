"""2. State boundaries for the map: reuse the site's existing states layer, don't add a new one.

Source: apps/monsoon/data/districts.topo.json, layer `states` (geoBoundaries gbOpen IND, ODbL 1.0,
current 36 states and UTs: Telangana, Ladakh and the merged Dadra and Nagar Haveli and Daman and
Diu are separate shapes). Read only; written here as a smaller states-only TopoJSON.
Needs Node (npx mapshaper).
"""
import shutil
import subprocess

from common import DATA, ROOT

SRC = ROOT.parent / "monsoon" / "data" / "districts.topo.json"
OUT = DATA / "states.topo.json"


def main() -> None:
    npx = shutil.which("npx") or shutil.which("npx.cmd")
    if not npx:
        raise SystemExit("needs Node's npx (for mapshaper)")
    subprocess.run([npx, "--yes", "mapshaper@0.6.113", "-i", str(SRC), "-target", "states",
                    "-simplify", "30%", "keep-shapes", "-o", "format=topojson", "quantization=1e4",
                    str(OUT)], check=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
