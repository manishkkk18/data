import numpy as np

from smokewatch.wind import compass, to_uv


def test_uv_from_meteorological_direction():
    # Wind FROM the north blows toward the south: v negative.
    u, v = to_uv(10, 0)
    assert np.isclose(u, 0, atol=1e-9) and np.isclose(v, -10)
    # Wind FROM the west blows east: u positive.
    u, v = to_uv(5, 270)
    assert np.isclose(u, 5) and np.isclose(v, 0, atol=1e-9)


def test_compass_labels():
    assert compass(0) == "north"
    assert compass(315) == "north-west"
    assert compass(350) == "north"
    assert compass(None) is None
