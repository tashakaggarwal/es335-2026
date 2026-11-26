"""Export verified model coefficients, test trajectories, and serving metadata to site/data/site_data.json."""

import json
from pathlib import Path
from typing import Dict, Optional

import numpy as np
import pandas as pd
from sklearn.calibration import calibration_curve

from .constants import ALL_FEATURES
from .evaluate import row_log_loss
from .models import fit_model_with_weights, make_logreg, recency_weights

BASE10 = [
    "runs_so_far",
    "target",
    "target_vs_venue_par",
    "wickets_lost",
    "balls_left",
    "current_run_rate",
    "required_run_rate",
    "run_rate_diff",
    "runs_needed_frac",
    "resources",
    "dls_resources",
    "par_score_diff",
    "runs_needed_per_wicket",
]


def export_site_data(
    train_df: pd.DataFrame,
    val_df: pd.DataFrame,
    test_df: pd.DataFrame,
    features_all_df: pd.DataFrame,
    selection: dict,
    test_results: dict,
    test_table: pd.DataFrame,
    test_preds: pd.DataFrame,
    perm_importance: pd.Series,
    drop_importance: Optional[pd.Series],
    dls_params: dict,
    player_profiles: dict,
    val_table: Optional[pd.DataFrame] = None,
    ball_benchmark: Optional[dict] = None,
    author: str = "Tashak Aggarwal",
    repo_url: str = "https://github.com/tashakaggarwal/es335-2026",
    out_path: Path = Path("site/data/site_data.json"),
) -> dict:
    """Build and write site_data.json, verifying <1e-6 parity between sklearn and hand-computed logits."""
    col = lambda prefix: next(c for c in test_preds.columns if c.startswith(prefix))  # noqa: E731
    p_model_col, p_rule_col, p_byover_col = col("FINAL"), col("B "), col("A2")
    y_te = test_preds["chasing_team_won"].to_numpy()

    t_df = test_df.copy()
    t_df["p"] = test_preds[p_model_col].to_numpy()
    t_df["pB"] = test_preds[p_rule_col].to_numpy()
    venue_col = "venue_clean" if "venue_clean" in t_df.columns else "venue"

    matches = []
    for mid, g in t_df.sort_values(["match_id", "over"]).groupby("match_id", sort=False):
        f = g.iloc[0]
        v_par = float(f["venue_par_past"]) if "venue_par_past" in g.columns else float(f["target"] - f["target_vs_venue_par"])
        matches.append(
            {
                "id": str(mid),
                "season": int(f["season"]),
                "date": str(f["date"])[:10],
                "chaser": str(f["batting_team"]),
                "bowler": str(f["bowling_team"]),
                "venue": str(f[venue_col]),
                "target": int(f["target"]),
                "venue_par": round(v_par, 2),
                "won": int(f["chasing_team_won"]),
                "overs": [
                    [
                        int(r.over),
                        int(r.runs_so_far),
                        int(r.wickets_lost),
                        round(float(r.p), 4),
                        round(float(r.pB), 4),
                    ]
                    for r in g.itertuples()
                ],
            }
        )
    matches.sort(key=lambda m: (m["date"], m["id"]))

    tbl = []
    for name, r in test_table.iterrows():
        tbl.append(
            {
                "name": str(name).strip(),
                "log_loss": float(r["log_loss"]),
                "brier": float(r["brier"]),
                "accuracy": float(r["accuracy"]),
                "ci": str(r["95% CI"]),
                "diff": None if pd.isna(r["diff vs B"]) else float(r["diff vs B"]),
                "diff_ci": str(r["diff 95% CI"]) if isinstance(r["diff 95% CI"], str) else "",
            }
        )

    frac, mean_p = calibration_curve(y_te, np.clip(t_df["p"], 1e-6, 1 - 1e-6), n_bins=8, strategy="quantile")
    cal_model = [[round(float(a), 4), round(float(b), 4)] for a, b in zip(mean_p, frac)]
    cal_rule = [
        [round(float(p), 4), round(float(g["chasing_team_won"].mean()), 4), int(len(g))]
        for p, g in t_df.groupby("pB")
    ]

    def _by_over_loss(p_arr: np.ndarray) -> pd.Series:
        return pd.Series(row_log_loss(y_te, p_arr)).groupby(t_df["over"].to_numpy()).mean()

    bo = pd.DataFrame(
        {
            "model": _by_over_loss(t_df["p"].to_numpy()),
            "rule": _by_over_loss(t_df["pB"].to_numpy()),
            "by_over": _by_over_loss(test_preds[p_byover_col].to_numpy()),
        }
    )
    by_over = [{"over": int(i), **{k: round(float(v), 4) for k, v in r.items()}} for i, r in bo.iterrows()]
    importance = [{"feature": k, "value": round(float(v), 5)} for k, v in perm_importance.sort_values(ascending=False).items()]
    drop_imp = (
        [{"feature": k, "value": round(float(v), 5)} for k, v in drop_importance.sort_values(ascending=False).items()]
        if drop_importance is not None
        else None
    )

    val_tbl = None
    if val_table is not None:
        val_tbl = {str(k).strip(): float(r["log_loss"]) for k, r in val_table.iterrows()}

    # Refit final browser logistic regression + 39-feature live logistic regression on train+val
    full = pd.concat([train_df, val_df], ignore_index=True)
    yf = full["chasing_team_won"].to_numpy()
    decay = float(selection.get("recency_decay", 0.08))
    w_full = recency_weights(full["season"].to_numpy(), decay=decay)

    if selection["model"] == "logreg":
        feats = selection["features"]
        c_val = float(selection["params"]["C"])
        same_as_final = True
    else:
        feats = [f for f in BASE10 if f in selection["features"]]
        c_val = 0.31622776601683794
        same_as_final = False

    lr = make_logreg(feats, C=c_val)
    fit_model_with_weights(lr, full[feats], yf, w_full)
    sc = lr.named_steps["pre"].named_transformers_["num"].named_steps["scale"]
    clf = lr.named_steps["clf"]

    # Verify exact < 1e-6 parity between manual logit math and scikit-learn
    z_mat = (test_df[feats].fillna(full[feats].median()).to_numpy() - sc.mean_) / sc.scale_
    p_manual = 1.0 / (1.0 + np.exp(-(z_mat @ clf.coef_[0] + clf.intercept_[0])))
    p_sk = lr.predict_proba(test_df[feats])[:, 1]
    max_diff = float(np.abs(p_manual - p_sk).max())
    assert max_diff < 1e-6, f"Manual logit parity check failed: max_diff={max_diff}"

    # Full 39-feature live predictor model
    lr_all = make_logreg(ALL_FEATURES, C=c_val)
    fit_model_with_weights(lr_all, full[ALL_FEATURES], yf, w_full)
    sc_all = lr_all.named_steps["pre"].named_transformers_["num"].named_steps["scale"]
    clf_all = lr_all.named_steps["clf"]

    z_all = (test_df[ALL_FEATURES].fillna(full[ALL_FEATURES].median()).to_numpy() - sc_all.mean_) / sc_all.scale_
    p_all_manual = 1.0 / (1.0 + np.exp(-(z_all @ clf_all.coef_[0] + clf_all.intercept_[0])))
    p_all_sk = lr_all.predict_proba(test_df[ALL_FEATURES])[:, 1]
    assert float(np.abs(p_all_manual - p_all_sk).max()) < 1e-6, "39-feature manual parity check failed"

    rule_f = full["run_rate_diff"].to_numpy() <= 0
    p_win_f, p_lose_f = round(float(yf[rule_f].mean()), 4), round(float(yf[~rule_f].mean()), 4)

    # Serving snapshot context maps (latest 2008-2026 venue/team stats for live deployment)
    mt = (
        features_all_df.groupby("match_id")
        .first()
        .reset_index()
        .sort_values(["date", "match_id"])
        .reset_index(drop=True)
    )
    p0_all = float(mt["chasing_team_won"].mean())
    recent_par_val = round(float(mt["target"].tail(30).mean()), 1)
    venues_map = {
        v: round(float((g["chasing_team_won"].sum() + 10.0 * p0_all) / (len(g) + 10.0)), 4)
        for v, g in mt.groupby("venue_clean")
    }
    venues_par_map = {
        v: round(float((g["target"].sum() + 8.0 * recent_par_val) / (len(g) + 8.0)), 1)
        for v, g in mt.groupby("venue_clean")
    }
    hg = pd.concat(
        [
            mt[mt["chasing_team_home"] == 1].assign(team=lambda x: x["batting_team"], hw=lambda x: x["chasing_team_won"]),
            mt[(mt["bowling_team_home"] == 1) & (mt["chasing_team_home"] != 1)].assign(
                team=lambda x: x["bowling_team"], hw=lambda x: 1 - x["chasing_team_won"]
            ),
        ]
    )
    ph_all = float(hg["hw"].mean())
    team_home_edge = {
        t: round(float((g["hw"].sum() + 10.0 * ph_all) / (len(g) + 10.0) - ph_all), 4)
        for t, g in hg.groupby("team")
    }
    team_home_venues = {t: g["venue_clean"].value_counts().index.tolist() for t, g in hg.groupby("team")}

    team_recent_wins: Dict[str, int] = {}
    for t in sorted(set(mt["batting_team"]) | set(mt["bowling_team"])):
        sub = mt[(mt["batting_team"] == t) | (mt["bowling_team"] == t)].tail(5)
        wins = np.where(sub["batting_team"] == t, sub["chasing_team_won"], 1 - sub["chasing_team_won"])
        team_recent_wins[t] = int(wins.sum())

    team_bowl_econ = {
        t: round(float(g["bowl_rem_econ"].mean()), 3)
        for t, g in features_all_df[features_all_df["season"] >= 2024].groupby("bowling_team")
    }
    team_bowl_wkt = {
        t: round(float(g["bowl_rem_wkt_rate"].mean()), 5)
        for t, g in features_all_df[features_all_df["season"] >= 2024].groupby("bowling_team")
    }

    whatif = {
        "features": feats,
        "mean": [float(x) for x in sc.mean_],
        "scale": [float(x) for x in sc.scale_],
        "coef": [float(x) for x in clf.coef_[0]],
        "intercept": float(clf.intercept_[0]),
        "settable": [f for f in feats if f in BASE10],
        "held_at_average": [f for f in feats if f not in BASE10],
        "same_as_final_model": same_as_final,
        "target_range": [int(full["target"].quantile(0.01)), int(max(full["target"].max(), test_df["target"].max()))],
        "dls_params": dls_params,
        "rule_probs": [p_lose_f, p_win_f],
        "live_model": {
            "features": ALL_FEATURES,
            "mean": [float(x) for x in sc_all.mean_],
            "scale": [float(x) for x in sc_all.scale_],
            "coef": [float(x) for x in clf_all.coef_[0]],
            "intercept": float(clf_all.intercept_[0]),
        },
        "venues": venues_map,
        "venues_par": venues_par_map,
        "team_home_edge": team_home_edge,
        "team_home_venues": team_home_venues,
        "team_recent_wins": team_recent_wins,
        "team_bowl_econ": team_bowl_econ,
        "team_bowl_wkt": team_bowl_wkt,
        "default_season_avg_target": round(float(mt[mt["season"] == mt["season"].max()]["target"].mean()), 1),
        "default_recent_par": recent_par_val,
    }
    for k in [
        "batters",
        "batters_bpd",
        "batters_avg",
        "bowlers_econ",
        "bowlers_wkt",
        "bowlers_balls",
        "league_prior_econ",
        "league_prior_wkt",
        "team_squads",
        "rosters",
        "bowl_rosters",
    ]:
        if k in player_profiles:
            whatif[k] = player_profiles[k]

    fm = full.groupby("match_id")["target"].first()
    tm = test_df.groupby("match_id")["target"].first()

    site = {
        "meta": {
            "author": author,
            "repo": repo_url,
            "model": selection["model"],
            "feature_set": selection["feature_set"],
            "n_features": len(selection["features"]),
            "fitted_seasons": test_results["fitted_on_seasons"],
            "test_seasons": test_results["test_seasons"],
            "test_matches": test_results["test_matches"],
            "test_rows": test_results["test_rows"],
            "train_matches": int(full["match_id"].nunique()),
            "mean_target_fit": float(fm.mean()),
            "mean_target_test": float(tm.mean()),
            "calibration_slope": test_results["calibration_slope"],
            "calibration_intercept": test_results["calibration_intercept"],
            "parity_max_diff": max_diff,
        },
        "results": tbl,
        "validation_log_loss": val_tbl,
        "ball_benchmark": ball_benchmark,
        "calibration": {"model": cal_model, "rule": cal_rule},
        "by_over": by_over,
        "importance": importance,
        "drop_importance": drop_imp,
        "whatif": whatif,
        "matches": matches,
    }
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(site, separators=(",", ":")), encoding="utf-8")
    return site
