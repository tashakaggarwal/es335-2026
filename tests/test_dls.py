"""Unit tests for count-weighted empirical DLS resource curve fitting and evaluation."""

import numpy as np
import pandas as pd

from ipl_winprob.dls import evaluate_dls_resources, fit_dls_curve


def _synthetic_first_innings() -> pd.DataFrame:
    rng = np.random.default_rng(42)
    rows = []
    for w in range(10):
        z0 = 220.0 * ((10 - w) / 10.0) ** 1.3
        b = 0.011 + 0.002 * w
        for balls_left in range(6, 120, 6):
            n_obs = 40 if w < 8 else (25 if balls_left <= 30 else 1)
            for _ in range(n_obs):
                true_rem = z0 * (1.0 - np.exp(-b * balls_left))
                # Inject a noisy single-sample tail outlier at w=8, balls_left=90
                noise = 35.0 if (w == 8 and balls_left > 60) else rng.normal(0, 4.0)
                rows.append(
                    {
                        "season": 2020,
                        "wickets_lost": w,
                        "balls_left": balls_left,
                        "runs_remaining": max(0.0, true_rem + noise),
                    }
                )
    return pd.DataFrame(rows)


def test_dls_boundaries_and_monotonicity():
    fi = _synthetic_first_innings()
    params = fit_dls_curve(fi, fit_before_season=2024)

    # Boundary conditions
    res = evaluate_dls_resources(np.array([120, 60, 0, 60]), np.array([0, 0, 0, 10]), params)
    assert np.isclose(res[0], 100.0, atol=1e-2)
    assert 0.0 < res[1] < 100.0
    assert res[2] == 0.0
    assert res[3] == 0.0

    # Strictly monotone decreasing Z0(w) as wickets increase
    z0s = [params["Z0"][str(w)] for w in range(10)]
    assert all(z0s[i] > z0s[i + 1] for i in range(9))

    # Count-weighting prevents unphysical b(w) spikes at sparse late-wicket bins
    for w in range(10):
        assert 0.002 <= params["b"][str(w)] <= 0.09


def test_dls_respects_season_cutoff():
    fi = _synthetic_first_innings()
    # Add wildly corrupted 2025 test season rows — fit_before_season=2024 must ignore them
    corrupt = fi.copy()
    corrupt["season"] = 2025
    corrupt["runs_remaining"] = 9999.0
    p_clean = fit_dls_curve(fi, fit_before_season=2024)
    p_with_test = fit_dls_curve(pd.concat([fi, corrupt], ignore_index=True), fit_before_season=2024)
    assert p_clean == p_with_test
