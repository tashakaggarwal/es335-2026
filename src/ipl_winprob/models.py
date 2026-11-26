"""Baselines, candidate models (LR, HGB, HGBm, LightGBM, XGBoost, MLP), consistent recency-weighted
grouped CV, OOF recalibration, and parsimonious feature-ladder selection."""

import warnings
from itertools import product
from typing import Callable, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.exceptions import ConvergenceWarning
from sklearn.impute import SimpleImputer
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from .constants import FEATURE_GROUPS, MONOTONIC_CONSTRAINTS
from .evaluate import EPS, clip_probs, summarize_metrics, weighted_log_loss

warnings.filterwarnings("ignore", category=ConvergenceWarning)

try:
    from lightgbm import LGBMClassifier
except ImportError:
    LGBMClassifier = None

try:
    from xgboost import XGBClassifier
except ImportError:
    XGBClassifier = None


def recency_weights(seasons: np.ndarray, decay: float = 0.08) -> np.ndarray:
    s = np.asarray(seasons, dtype=float)
    return np.exp(-decay * (s.max() - s))


def make_preprocessor(cols: List[str]) -> ColumnTransformer:
    return ColumnTransformer(
        [
            (
                "num",
                Pipeline([("impute", SimpleImputer(strategy="median")), ("scale", StandardScaler())]),
                cols,
            )
        ]
    )


def make_logreg(cols: List[str], C: float = 1.0) -> Pipeline:
    return Pipeline(
        [
            ("pre", make_preprocessor(cols)),
            ("clf", LogisticRegression(C=C, max_iter=5000)),
        ]
    )


def make_hgb(
    cols: Optional[List[str]] = None,
    monotonic: bool = False,
    random_state: int = 0,
    **kw,
) -> HistGradientBoostingClassifier:
    mono = [MONOTONIC_CONSTRAINTS.get(f, 0) for f in cols] if (monotonic and cols is not None) else None
    return HistGradientBoostingClassifier(
        early_stopping=False,
        monotonic_cst=mono,
        random_state=random_state,
        **kw,
    )


def make_lgbm(
    cols: Optional[List[str]] = None,
    monotonic: bool = False,
    random_state: int = 0,
    **kw,
):
    if LGBMClassifier is None:
        raise ImportError("lightgbm is not installed")
    mono = [MONOTONIC_CONSTRAINTS.get(f, 0) for f in cols] if (monotonic and cols is not None) else None
    params = dict(
        objective="binary",
        random_state=random_state,
        verbosity=-1,
        n_jobs=1,
        monotone_constraints=mono,
    )
    params.update(kw)
    return LGBMClassifier(**params)


def make_xgb(
    cols: Optional[List[str]] = None,
    monotonic: bool = False,
    random_state: int = 0,
    **kw,
):
    if XGBClassifier is None:
        raise ImportError("xgboost is not installed")
    mono = tuple(MONOTONIC_CONSTRAINTS.get(f, 0) for f in cols) if (monotonic and cols is not None) else None
    params = dict(
        objective="binary:logistic",
        eval_metric="logloss",
        tree_method="hist",
        random_state=random_state,
        n_jobs=1,
    )
    if mono is not None:
        params["monotone_constraints"] = mono
    params.update(kw)
    return XGBClassifier(**params)


def make_mlp(
    cols: List[str],
    hidden_layer_sizes: Tuple[int, ...] = (16,),
    alpha: float = 0.1,
    random_state: int = 0,
) -> Pipeline:
    return Pipeline(
        [
            ("pre", make_preprocessor(cols)),
            (
                "clf",
                MLPClassifier(
                    hidden_layer_sizes=hidden_layer_sizes,
                    alpha=alpha,
                    max_iter=800,
                    early_stopping=False,
                    random_state=random_state,
                ),
            ),
        ]
    )


def fit_model_with_weights(model, x: pd.DataFrame, y: np.ndarray, sample_weight: np.ndarray = None):
    """Uniformly pass sample_weight to Pipeline ('clf__sample_weight') or direct estimator ('sample_weight')."""
    if sample_weight is None:
        return model.fit(x, y)
    if isinstance(model, Pipeline):
        return model.fit(x, y, clf__sample_weight=sample_weight)
    return model.fit(x, y, sample_weight=sample_weight)


def weighted_grouped_cv(
    builder: Callable[[dict], object],
    param_grid: Dict[str, list],
    x: pd.DataFrame,
    y: np.ndarray,
    groups: np.ndarray,
    sample_weight: Optional[np.ndarray] = None,
    n_splits: int = 5,
    n_jobs: int = -1,
) -> Tuple[dict, float, object]:
    """Grouped K-Fold CV that consistently applies sample_weight to BOTH fitting and fold log-loss scoring."""
    cv = GroupKFold(n_splits=n_splits)
    folds = list(cv.split(x, y, groups))
    keys = list(param_grid.keys())
    param_list = [dict(zip(keys, vals)) for vals in product(*(param_grid[k] for k in keys))]

    def _eval_one(p_idx: int, tr_idx: np.ndarray, va_idx: np.ndarray) -> Tuple[int, float]:
        m = builder(param_list[p_idx])
        w_tr_f = sample_weight[tr_idx] if sample_weight is not None else None
        w_va_f = sample_weight[va_idx] if sample_weight is not None else None
        fit_model_with_weights(m, x.iloc[tr_idx], y[tr_idx], w_tr_f)
        p_va = m.predict_proba(x.iloc[va_idx])[:, 1]
        return p_idx, weighted_log_loss(y[va_idx], p_va, w_va_f)

    tasks = [(i, tr_idx, va_idx) for i in range(len(param_list)) for tr_idx, va_idx in folds]
    results = Parallel(n_jobs=n_jobs, prefer="threads")(delayed(_eval_one)(i, tr, va) for i, tr, va in tasks)

    scores_by_idx: Dict[int, List[float]] = {i: [] for i in range(len(param_list))}
    for p_idx, score in results:
        scores_by_idx[p_idx].append(score)

    best_idx = min(scores_by_idx, key=lambda i: float(np.mean(scores_by_idx[i])))
    best_params = param_list[best_idx]
    best_score = float(np.mean(scores_by_idx[best_idx]))

    best_model = builder(best_params)
    fit_model_with_weights(best_model, x, y, sample_weight)
    return best_params, best_score, best_model


def weighted_oof_recalibrate(
    builder: Callable[[], object],
    x_tr: pd.DataFrame,
    y_tr: np.ndarray,
    groups_tr: np.ndarray,
    w_tr: np.ndarray,
    fitted_model,
    x_val: pd.DataFrame,
    n_splits: int = 5,
) -> Dict[str, np.ndarray]:
    """Consistent recency-weighted OOF Platt & Isotonic recalibration check."""
    cv = GroupKFold(n_splits=n_splits)
    oof = np.zeros(len(y_tr), dtype=float)
    for tr_idx, va_idx in cv.split(x_tr, y_tr, groups_tr):
        m = builder()
        fit_model_with_weights(m, x_tr.iloc[tr_idx], y_tr[tr_idx], w_tr[tr_idx])
        oof[va_idx] = m.predict_proba(x_tr.iloc[va_idx])[:, 1]

    p_val = fitted_model.predict_proba(x_val)[:, 1]
    logit = lambda p: np.log(clip_probs(p) / (1.0 - clip_probs(p))).reshape(-1, 1)  # noqa: E731
    platt = LogisticRegression(C=1e6, max_iter=5000).fit(logit(oof), y_tr, sample_weight=w_tr)
    iso = IsotonicRegression(y_min=EPS, y_max=1.0 - EPS, out_of_bounds="clip").fit(oof, y_tr, sample_weight=w_tr)
    return {
        "raw": p_val,
        "platt": platt.predict_proba(logit(p_val))[:, 1],
        "isotonic": iso.predict(p_val),
    }


def compute_baselines(
    train_df: pd.DataFrame,
    eval_df: pd.DataFrame,
    label_col: str = "chasing_team_won",
    const_name: str = "A  constant (train win rate)",
) -> Tuple[Dict[str, np.ndarray], Tuple[float, float]]:
    y_tr = train_df[label_col].to_numpy()
    p_const = float(y_tr.mean())
    over_key = np.ceil(train_df["over"]).astype(int)
    eval_over_key = np.ceil(eval_df["over"]).astype(int)
    rate_by_over = pd.Series(y_tr).groupby(over_key.to_numpy()).mean()

    rule_tr = train_df["run_rate_diff"].to_numpy() <= 0
    p_win = float(y_tr[rule_tr].mean())
    p_lose = float(y_tr[~rule_tr].mean())

    preds = {
        const_name: np.full(len(eval_df), p_const),
        "A2 win rate by over": eval_over_key.map(rate_by_over).fillna(p_const).to_numpy(),
        "B  rule: current >= required": np.where(eval_df["run_rate_diff"].to_numpy() <= 0, p_win, p_lose),
    }
    return preds, (p_lose, p_win)


def run_feature_ladder(
    train_df: pd.DataFrame,
    val_df: pd.DataFrame,
    w_tr: np.ndarray,
    best_c: float,
    best_hgb_params: dict,
    best_lgbm_params: Optional[dict] = None,
    label_col: str = "chasing_team_won",
    random_state: int = 0,
) -> Tuple[pd.DataFrame, Dict[Tuple[str, str], np.ndarray]]:
    """Evaluate 7 cumulative feature stages across LR, HGB, and LightGBM (if installed)."""
    y_tr = train_df[label_col].to_numpy()
    y_va = val_df[label_col].to_numpy()

    steps = [
        ("A core", ["core"]),
        ("B +derived", ["core", "derived"]),
        ("C +phase+momentum", ["core", "derived", "phase", "momentum"]),
        ("D +batters+bowling+impact", ["core", "derived", "phase", "momentum", "batters", "bowling", "impact"]),
        ("E +history", ["core", "derived", "phase", "momentum", "batters", "bowling", "impact", "history"]),
        ("F +home", ["core", "derived", "phase", "momentum", "batters", "bowling", "impact", "history", "home"]),
        (
            "G +form (all)",
            ["core", "derived", "phase", "momentum", "batters", "bowling", "impact", "history", "home", "form"],
        ),
    ]

    rows = []
    ladder_preds: Dict[Tuple[str, str], np.ndarray] = {}
    for stage_name, g_list in steps:
        fs = [f for g in g_list for f in FEATURE_GROUPS[g]]
        candidates = {
            "logreg": make_logreg(fs, C=best_c),
            "hgb": make_hgb(fs, monotonic=False, random_state=random_state, **best_hgb_params),
        }
        if LGBMClassifier is not None and best_lgbm_params is not None:
            candidates["lgbm"] = make_lgbm(fs, monotonic=False, random_state=random_state, **best_lgbm_params)

        for mname, model in candidates.items():
            fit_model_with_weights(model, train_df[fs], y_tr, w_tr)
            p = model.predict_proba(val_df[fs])[:, 1]
            ladder_preds[(stage_name, mname)] = p
            rows.append(
                {
                    "feature set": stage_name,
                    "model": mname,
                    "n_features": len(fs),
                    **summarize_metrics(y_va, p),
                }
            )
    return pd.DataFrame(rows), ladder_preds


def select_parsimonious_model(ladder: pd.DataFrame, tol: float = 0.003) -> pd.Series:
    """Pre-registered rule: simplest candidate (fewest features, linear before trees) within `tol` of best."""
    rank = {"logreg": 0, "hgb": 1, "lgbm": 2, "xgb": 3}
    best_ll = float(ladder["log_loss"].min())
    cands = (
        ladder[ladder["log_loss"] <= best_ll + tol]
        .assign(_r=lambda d: d["model"].map(lambda x: rank.get(x, 9)))
        .sort_values(["n_features", "_r", "log_loss"])
    )
    return cands.iloc[0]
