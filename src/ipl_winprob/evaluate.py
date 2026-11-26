"""Probabilistic evaluation metrics, match-cluster bootstrap, calibration, and feature importance."""

from typing import Dict, List, Tuple

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.linear_model import LogisticRegression

EPS = 1e-6


def clip_probs(p: np.ndarray) -> np.ndarray:
    return np.clip(np.asarray(p, dtype=float), EPS, 1.0 - EPS)


def row_log_loss(y: np.ndarray, p: np.ndarray) -> np.ndarray:
    p_c = clip_probs(p)
    y_a = np.asarray(y, dtype=float)
    return -(y_a * np.log(p_c) + (1.0 - y_a) * np.log(1.0 - p_c))


def weighted_log_loss(y: np.ndarray, p: np.ndarray, sample_weight: np.ndarray = None) -> float:
    losses = row_log_loss(y, p)
    if sample_weight is None:
        return float(np.mean(losses))
    w = np.asarray(sample_weight, dtype=float)
    return float(np.sum(losses * w) / np.sum(w))


def summarize_metrics(y: np.ndarray, p: np.ndarray) -> Dict[str, float]:
    p_c = clip_probs(p)
    y_a = np.asarray(y, dtype=float)
    return {
        "log_loss": float(row_log_loss(y_a, p_c).mean()),
        "brier": float(np.mean((p_c - y_a) ** 2)),
        "accuracy": float(np.mean((p_c >= 0.5) == y_a)),
    }


def _per_match_sums(loss: np.ndarray, match_ids: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    g = pd.DataFrame({"m": match_ids, "l": loss}).groupby("m")["l"].agg(["sum", "count"])
    return g["sum"].to_numpy(dtype=float), g["count"].to_numpy(dtype=float)


def match_cluster_bootstrap(
    preds: Dict[str, np.ndarray],
    y: np.ndarray,
    match_ids: np.ndarray,
    reference: str,
    n_boot: int = 2000,
    seed: int = 0,
) -> pd.DataFrame:
    """Resample whole matches to form valid 95% CIs and paired differences against reference."""
    rng = np.random.default_rng(seed)
    arrs = {k: _per_match_sums(row_log_loss(y, p), match_ids) for k, p in preds.items()}
    n_matches = len(arrs[reference][0])
    idx = rng.integers(0, n_matches, size=(n_boot, n_matches))
    ref_ll = arrs[reference][0][idx].sum(axis=1) / arrs[reference][1][idx].sum(axis=1)

    rows = {}
    for k, (s, n) in arrs.items():
        ll = s[idx].sum(axis=1) / n[idx].sum(axis=1)
        diff = ll - ref_ll
        is_ref = k == reference
        rows[k] = {
            "95% CI": f"[{np.percentile(ll, 2.5):.4f}, {np.percentile(ll, 97.5):.4f}]",
            "diff vs B": np.nan if is_ref else float(diff.mean()),
            "diff 95% CI": "" if is_ref else f"[{np.percentile(diff, 2.5):.4f}, {np.percentile(diff, 97.5):.4f}]",
            "P(better than B)": np.nan if is_ref else float((diff < 0).mean()),
        }
    return pd.DataFrame(rows).T


def build_metric_table(
    preds: Dict[str, np.ndarray],
    y: np.ndarray,
    match_ids: np.ndarray,
    reference: str,
    n_boot: int = 2000,
    seed: int = 0,
) -> pd.DataFrame:
    base = pd.DataFrame({k: summarize_metrics(y, p) for k, p in preds.items()}).T.round(4)
    boot = match_cluster_bootstrap(preds, y, match_ids, reference=reference, n_boot=n_boot, seed=seed)
    return base.join(boot)


def calibration_slope_intercept(y: np.ndarray, p: np.ndarray) -> Tuple[float, float]:
    """Regress y on logit(p): ideal slope = 1.0, ideal intercept = 0.0."""
    p_c = clip_probs(p)
    lg = np.log(p_c / (1.0 - p_c)).reshape(-1, 1)
    cal = LogisticRegression(C=1e6, max_iter=5000).fit(lg, y)
    return float(cal.coef_[0][0]), float(cal.intercept_[0])


def compute_permutation_importance(
    model,
    x_test: pd.DataFrame,
    y_test: np.ndarray,
    features: List[str],
    n_repeats: int = 5,
    seed: int = 0,
) -> pd.Series:
    rng = np.random.default_rng(seed)
    base = row_log_loss(y_test, model.predict_proba(x_test[features])[:, 1]).mean()
    imp = {}
    for f in features:
        deltas = []
        for _ in range(n_repeats):
            xp = x_test[features].copy()
            xp[f] = rng.permutation(xp[f].to_numpy())
            deltas.append(row_log_loss(y_test, model.predict_proba(xp)[:, 1]).mean() - base)
        imp[f] = float(np.mean(deltas))
    return pd.Series(imp).sort_values(ascending=False)


def compute_drop_column_importance(
    make_model_fn,
    train_df: pd.DataFrame,
    y_train: np.ndarray,
    test_df: pd.DataFrame,
    y_test: np.ndarray,
    features: List[str],
    sample_weight: np.ndarray = None,
    fit_weight_key: str = "clf__sample_weight",
) -> pd.Series:
    """Collinearity-safe importance: refit model dropping one feature at a time and measure test log-loss increase."""
    fit_kw = {fit_weight_key: sample_weight} if sample_weight is not None else {}
    full_model = make_model_fn(features).fit(train_df[features], y_train, **fit_kw)
    base_ll = row_log_loss(y_test, full_model.predict_proba(test_df[features])[:, 1]).mean()

    imp = {}
    for f in features:
        sub = [c for c in features if c != f]
        m = clone(make_model_fn(sub)).fit(train_df[sub], y_train, **fit_kw)
        sub_ll = row_log_loss(y_test, m.predict_proba(test_df[sub])[:, 1]).mean()
        imp[f] = float(sub_ll - base_ll)
    return pd.Series(imp).sort_values(ascending=False)
