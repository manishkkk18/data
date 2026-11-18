from datetime import date

import pandas as pd
import pytest

from smokewatch import firms


def test_total_firms_outage_raises(monkeypatch):
    monkeypatch.setattr(firms, "secret", lambda name: "KEY")

    def boom(url):
        raise RuntimeError("503 from FIRMS")

    monkeypatch.setattr(firms, "_get_csv", boom)
    with pytest.raises(firms.FirmsUnavailable):
        firms.fetch_recent(days=3, today=date(2026, 11, 17))


def test_partial_firms_failure_is_tolerated(monkeypatch):
    monkeypatch.setattr(firms, "secret", lambda name: "KEY")
    row = pd.DataFrame([{"latitude": 30.0, "longitude": 75.0, "acq_date": "2026-11-16", "acq_time": 800, "satellite": "N20",
                         "frp": 5.0, "daynight": "D", "confidence": "n"}])

    def flaky(url):
        if "NOAA21" in url:
            raise RuntimeError("timeout")
        return row

    monkeypatch.setattr(firms, "_get_csv", flaky)
    df, method = firms.fetch_recent(days=3, today=date(2026, 11, 17))
    assert method == "api" and len(df) >= 1
