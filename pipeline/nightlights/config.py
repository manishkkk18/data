"""Shared paths and settings for the pipeline.

Every tunable number lives here so it's easy to find and explain.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "data"  # what the web app reads (small, committed)
RAW = DATA / "raw"  # big downloads, cached, never committed
STATS = DATA / "stats"  # one CSV per month = resumable checkpoints
QA = DATA / "qa"  # sanity-check images

BOUNDARIES_RAW = RAW / "boundaries"
DISTRICTS_FULL = BOUNDARIES_RAW / "districts_full.gpkg"  # full detail, for zonal stats
DISTRICTS_WEB = DATA / "districts.geojson"  # simplified, for the map
OUTLINE_WEB = DATA / "india_outline.geojson"  # national outline drawn over the basemap

# NASA Black Marble Collection 2 ("5200") is the current one; Collection 1 is retired.
COLLECTION = "5200"
VARIABLE = "NearNadir_Composite_Snow_Free"

# Monthly/annual quality flags: 0 good, 1 poor (<=3 clear nights), 2 gap-filled from
# historical data, 255 fill. We drop 2 as well as 255 so we never show NASA's
# interpolated values as if they were observed; low coverage shows up as a gap.
DROP_QUALITY_FLAGS = [2, 255]

# A pixel counts as "lit" at >= 1 nW/cm²/sr, comfortably above the sensor noise floor
# (~0.3-0.5) so dark rural pixels don't flicker in and out of the lit count.
LIT_THRESHOLD = 1.0

# Below this share of observed (non-gap) area, a district-month is reported as a gap.
MIN_VALID_PCT = 50.0


def get_token() -> str:
    """Read the Earthdata token from .env. Never print or log the return value."""
    load_dotenv(REPO / ".env")
    token = os.getenv("EARTHDATA_TOKEN", "").strip()
    if not token:
        raise SystemExit(
            "EARTHDATA_TOKEN is missing. Add a line EARTHDATA_TOKEN=... to the .env file "
            "at the repo root (see pipeline/README.md)."
        )
    return token
