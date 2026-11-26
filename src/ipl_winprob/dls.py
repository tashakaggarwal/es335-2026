"""Empirical Duckworth-Lewis-Stern (DLS) exponential resource curve fitting and evaluation."""

from typing import Dict

import numpy as np
import pandas as pd
from scipy.optimize import curve_fit


def _dls_exp(u: np.ndarray, z0: float, b: float) -> np.ndarray:
    return z0 * (1.0 - np.exp(-b * u))


def fit_dls_curve(
    first_innings: pd.DataFrame,
    fit_before_season: int = 2024,
) -> Dict[str, object]:
    """Fit Z(u, w) = Z0(w) * (1 - exp(-b(w) * u)) strictly on training 1st innings.

    Uses sample-count weighting (sigma = 1 / sqrt(n)) across (balls_left, wickets_lost) bins
    so rare 1-sample tail states at 8-9 wickets lost cannot distort decay rates b(w).
    """
    fi_tr = first_innings[first_innings["season"] < fit_before_season]
    dls_z0: Dict[int, float] = {}
    dls_b: Dict[int, float] = {}

    for w in range(10):
        sub = fi_tr[fi_tr["wickets_lost"] == w]
        default_z0 = max(12.0, 175.0 * ((10 - w) / 10.0) ** 1.35)
        default_b = 0.011 + 0.003 * w
        if len(sub) >= 30:
            grp = (
                sub.groupby("balls_left")["runs_remaining"]
                .agg(mean="mean", count="size")
                .reset_index()
            )
            u_vals = grp["balls_left"].to_numpy(dtype=float)
            y_vals = grp["mean"].to_numpy(dtype=float)
            counts = grp["count"].to_numpy(dtype=float)
            # Weight each bin proportionally to its observation count
            sigma = 1.0 / np.sqrt(np.maximum(counts, 1.0))
            p0 = [default_z0, default_b]
            # Upper bound on b prevents unphysical jumps at sparse late-wicket bins
            b_hi = 0.06 if w <= 7 else 0.09
            try:
                popt, _ = curve_fit(
                    _dls_exp,
                    u_vals,
                    y_vals,
                    p0=p0,
                    sigma=sigma,
                    absolute_sigma=False,
                    bounds=([5.0, 0.002], [400.0, b_hi]),
                    maxfev=8000,
                )
                dls_z0[w], dls_b[w] = float(popt[0]), float(popt[1])
            except Exception:
                dls_z0[w], dls_b[w] = default_z0, default_b
        else:
            dls_z0[w], dls_b[w] = default_z0, default_b

    # Enforce monotone decreasing asymptotic runs Z0(w) as wickets fall
    for w in range(1, 10):
        dls_z0[w] = min(dls_z0[w], dls_z0[w - 1] * 0.92)

    norm_120 = float(dls_z0[0] * (1.0 - np.exp(-dls_b[0] * 120.0)))
    return {
        "Z0": {str(k): round(float(v), 4) for k, v in dls_z0.items()},
        "b": {str(k): round(float(v), 6) for k, v in dls_b.items()},
        "norm_120": round(norm_120, 4),
    }


def evaluate_dls_resources(
    balls_left: np.ndarray,
    wickets_lost: np.ndarray,
    dls_params: Dict[str, object],
) -> np.ndarray:
    """Compute remaining DLS resource percentage in [0, 100] from balls_left and wickets_lost."""
    balls = np.asarray(balls_left, dtype=float)
    wkts = np.asarray(wickets_lost, dtype=int)
    z0_map = dls_params["Z0"]
    b_map = dls_params["b"]
    norm_120 = float(dls_params["norm_120"])

    out = np.zeros_like(balls, dtype=float)
    valid = (balls > 0) & (wkts < 10)
    if np.any(valid):
        w_clip = np.clip(wkts[valid], 0, 9)
        z0_vec = np.array([float(z0_map[str(w)]) for w in w_clip])
        b_vec = np.array([float(b_map[str(w)]) for w in w_clip])
        raw = z0_vec * (1.0 - np.exp(-b_vec * balls[valid]))
        out[valid] = np.clip((raw / norm_120) * 100.0, 0.0, 100.0)
    return out
