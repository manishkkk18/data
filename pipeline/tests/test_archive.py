from smokewatch.openaq import archive_station_day

HEAD = "location_id,sensors_id,location,datetime,lat,lon,parameter,units,value\n"


def day_file(hours: int, value: float = 100.0, extra: str = "") -> str:
    """Half-hourly readings stamped at the END of each period, like OpenAQ's archive."""
    rows = []
    for k in range(1, hours * 2 + 1):
        mins = k * 30
        d = "2023-11-02" if mins == 24 * 60 else "2023-11-01"
        hh, mm = divmod(mins % (24 * 60), 60)
        rows.append(f"8118,1,X,{d}T{hh:02d}:{mm:02d}:00+05:30,28.6,77.2,pm25,µg/m³,{value}")
    return HEAD + "\n".join(rows) + "\n" + extra


def test_full_day_including_midnight_stamp():
    v, hours = archive_station_day(day_file(24), "2023-11-01")
    assert v == 100.0 and hours == 24  # the 00:00 next-day stamp belongs to 23:30-24:00 today


def test_too_few_hours_is_none():
    v, hours = archive_station_day(day_file(17), "2023-11-01")
    assert v is None and hours == 17


def test_other_parameters_and_bad_values_ignored():
    extra = "8118,2,X,2023-11-01T05:00:00+05:30,28.6,77.2,pm10,µg/m³,900\n8118,1,X,2023-11-01T05:30:00+05:30,28.6,77.2,pm25,µg/m³,-5\n"
    v, _ = archive_station_day(day_file(24, extra=extra), "2023-11-01")
    assert v == 100.0
