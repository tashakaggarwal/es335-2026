"""End-to-end reproducible CLI pipeline for IPL Chase Win Probability (over-by-over & ball-by-ball)."""

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from .constants import FEATURE_DEFINITIONS, FEATURE_GROUPS
from .evaluate import (
    build_metric_table,
    calibration_slope_intercept,
    compute_drop_column_importance,
    compute_permutation_importance,
    row_log_loss,
    summarize_metrics,
)
from .export import export_site_data
from .features import build_features, split_by_season
from .models import (
    LGBMClassifier,
    XGBClassifier,
    compute_baselines,
    fit_model_with_weights,
    make_hgb,
    make_lgbm,
    make_logreg,
    make_mlp,
    make_xgb,
    recency_weights,
    run_feature_ladder,
    select_parsimonious_model,
    weighted_grouped_cv,
    weighted_oof_recalibrate,
)
from .parse import build_serving_player_profiles, parse_directory

MAIN_GROUPS = ["core", "derived", "phase", "momentum"]
MAIN_FEATURES = [f for g in MAIN_GROUPS for f in FEATURE_GROUPS[g]]
REF_NAME = "B  rule: current >= required"
LABEL = "chasing_team_won"


def _load_full_name_map(repo_root: Path) -> dict:
    scripts_dir = repo_root / "scripts"
    if str(scripts_dir) not in sys.path:
        sys.path.insert(0, str(scripts_dir))
    try:
        from player_names import PLAYER_FULL_NAMES  # type: ignore

        return dict(PLAYER_FULL_NAMES)
    except Exception:
        return {}


def run_pipeline(
    repo_root: Path,
    include_ball_by_ball: bool = True,
    recency_decay: float = 0.08,
    n_boot: int = 2000,
    tol: float = 0.003,
    random_state: int = 0,
) -> dict:
    raw_dir = repo_root / "data" / "raw"
    parsed_dir = repo_root / "data" / "parsed"
    feat_dir = repo_root / "data" / "features"
    split_dir = repo_root / "data" / "split"
    res_dir = repo_root / "results"
    final_dir = res_dir / "final"
    for d in (parsed_dir, feat_dir, split_dir, res_dir, final_dir):
        d.mkdir(parents=True, exist_ok=True)

    print("[1/6] Parsing Cricsheet JSON archive ...")
    overs_df, first_df, log_df, balls_df = parse_directory(raw_dir, include_balls=include_ball_by_ball)
    overs_df.to_csv(parsed_dir / "overs.csv", index=False)
    first_df.to_csv(parsed_dir / "first_innings_states.csv", index=False)
    log_df.to_csv(parsed_dir / "match_log.csv", index=False)
    print(f"      Kept {overs_df['match_id'].nunique()} matches | {len(overs_df)} over rows")
    if include_ball_by_ball:
        balls_df.to_csv(parsed_dir / "balls.csv", index=False)
        print(f"      Ball-by-ball granularity: {len(balls_df)} legal-delivery rows")

    print("[2/6] Building unified serving player profiles (zero training-serving skew) ...")
    full_name_map = _load_full_name_map(repo_root)
    profiles = build_serving_player_profiles(raw_dir, full_name_map=full_name_map)
    (parsed_dir / "player_profiles.json").write_text(json.dumps(profiles, indent=2), encoding="utf-8")

    print("[3/6] Engineering features, fitting count-weighted DLS curve & running temporal leakage audit ...")
    feat_df, dls_params = build_features(overs_df, first_df, dls_fit_before_season=2024, verify_leakage=True)
    feat_df.to_csv(feat_dir / "features_all.csv", index=False)
    (feat_dir / "feature_groups.json").write_text(json.dumps(FEATURE_GROUPS, indent=2), encoding="utf-8")
    (feat_dir / "dls_params.json").write_text(json.dumps(dls_params, indent=2), encoding="utf-8")
    pd.DataFrame(
        [(f, g, FEATURE_DEFINITIONS[f]) for g, fs in FEATURE_GROUPS.items() for f in fs],
        columns=["feature", "group", "definition"],
    ).to_csv(feat_dir / "feature_dictionary.csv", index=False)

    train_df, val_df, test_df = split_by_season(feat_df)
    train_df.to_csv(split_dir / "train.csv", index=False)
    val_df.to_csv(split_dir / "validation.csv", index=False)
    test_df.to_csv(split_dir / "test.csv", index=False)
    print(
        f"      Splits: Train={train_df['match_id'].nunique()}m/{len(train_df)}r | "
        f"Val={val_df['match_id'].nunique()}m/{len(val_df)}r | "
        f"Test={test_df['match_id'].nunique()}m/{len(test_df)}r"
    )

    print("[4/6] Running weighted grouped CV & validation benchmark (LR, HGB, HGBm, LGBM, XGB, MLP) ...")
    y_tr = train_df[LABEL].to_numpy()
    y_va = val_df[LABEL].to_numpy()
    groups_tr = train_df["match_id"].to_numpy()
    w_tr = recency_weights(train_df["season"].to_numpy(), decay=recency_decay)

    val_preds, _ = compute_baselines(train_df, val_df)

    # LR
    best_lr_p, lr_cv, lr_model = weighted_grouped_cv(
        lambda p: make_logreg(MAIN_FEATURES, C=p["C"]),
        {"C": list(np.logspace(-3, 2, 11))},
        train_df[MAIN_FEATURES],
        y_tr,
        groups_tr,
        sample_weight=w_tr,
    )
    val_preds["LR  logistic regression"] = lr_model.predict_proba(val_df[MAIN_FEATURES])[:, 1]
    print(f"      LR   best={best_lr_p} | weighted CV={lr_cv:.4f} | val={summarize_metrics(y_va, val_preds['LR  logistic regression'])['log_loss']:.4f}")

    # HGB & HGBm
    best_hgb_p, hgb_cv, hgb_model = weighted_grouped_cv(
        lambda p: make_hgb(MAIN_FEATURES, monotonic=False, random_state=random_state, **p),
        {
            "learning_rate": [0.03, 0.08],
            "max_depth": [2, 3],
            "max_iter": [200],
            "min_samples_leaf": [20, 60],
            "l2_regularization": [1.0],
        },
        train_df[MAIN_FEATURES],
        y_tr,
        groups_tr,
        sample_weight=w_tr,
    )
    val_preds["HGB gradient-boosted trees"] = hgb_model.predict_proba(val_df[MAIN_FEATURES])[:, 1]
    hgb_mono = make_hgb(MAIN_FEATURES, monotonic=True, random_state=random_state, **best_hgb_p)
    fit_model_with_weights(hgb_mono, train_df[MAIN_FEATURES], y_tr, w_tr)
    val_preds["HGBm gradient-boosted, monotonic"] = hgb_mono.predict_proba(val_df[MAIN_FEATURES])[:, 1]
    print(f"      HGB  best={best_hgb_p} | weighted CV={hgb_cv:.4f} | val={summarize_metrics(y_va, val_preds['HGB gradient-boosted trees'])['log_loss']:.4f}", flush=True)

    # LightGBM & Monotonic LightGBM
    best_lgbm_p = None
    if LGBMClassifier is not None:
        best_lgbm_p, lgbm_cv, lgbm_model = weighted_grouped_cv(
            lambda p: make_lgbm(MAIN_FEATURES, monotonic=False, random_state=random_state, **p),
            {
                "learning_rate": [0.03, 0.08],
                "max_depth": [2, 3],
                "n_estimators": [200],
                "min_child_samples": [20, 60],
                "reg_lambda": [1.0, 5.0],
            },
            train_df[MAIN_FEATURES],
            y_tr,
            groups_tr,
            sample_weight=w_tr,
        )
        val_preds["LGBM LightGBM"] = lgbm_model.predict_proba(val_df[MAIN_FEATURES])[:, 1]
        lgbm_mono = make_lgbm(MAIN_FEATURES, monotonic=True, random_state=random_state, **best_lgbm_p)
        fit_model_with_weights(lgbm_mono, train_df[MAIN_FEATURES], y_tr, w_tr)
        val_preds["LGBMm LightGBM, monotonic"] = lgbm_mono.predict_proba(val_df[MAIN_FEATURES])[:, 1]
        print(f"      LGBM best={best_lgbm_p} | weighted CV={lgbm_cv:.4f} | val={summarize_metrics(y_va, val_preds['LGBM LightGBM'])['log_loss']:.4f}", flush=True)

    # XGBoost & Monotonic XGBoost
    if XGBClassifier is not None:
        best_xgb_p, xgb_cv, xgb_model = weighted_grouped_cv(
            lambda p: make_xgb(MAIN_FEATURES, monotonic=False, random_state=random_state, **p),
            {
                "learning_rate": [0.03, 0.08],
                "max_depth": [2, 3],
                "n_estimators": [200],
                "min_child_weight": [10, 30],
                "reg_lambda": [1.0, 5.0],
            },
            train_df[MAIN_FEATURES],
            y_tr,
            groups_tr,
            sample_weight=w_tr,
        )
        val_preds["XGB  XGBoost"] = xgb_model.predict_proba(val_df[MAIN_FEATURES])[:, 1]
        xgb_mono = make_xgb(MAIN_FEATURES, monotonic=True, random_state=random_state, **best_xgb_p)
        fit_model_with_weights(xgb_mono, train_df[MAIN_FEATURES], y_tr, w_tr)
        val_preds["XGBm XGBoost, monotonic"] = xgb_mono.predict_proba(val_df[MAIN_FEATURES])[:, 1]
        print(f"      XGB  best={best_xgb_p} | weighted CV={xgb_cv:.4f} | val={summarize_metrics(y_va, val_preds['XGB  XGBoost'])['log_loss']:.4f}", flush=True)

    # Weighted MLP (fixed: now uses w_tr consistently!)
    best_mlp_p, mlp_cv, mlp_model = weighted_grouped_cv(
        lambda p: make_mlp(MAIN_FEATURES, random_state=random_state, **p),
        {"hidden_layer_sizes": [(16,), (32, 16)], "alpha": [1e-2, 1e-1]},
        train_df[MAIN_FEATURES],
        y_tr,
        groups_tr,
        sample_weight=w_tr,
    )
    val_preds["MLP small neural network"] = mlp_model.predict_proba(val_df[MAIN_FEATURES])[:, 1]
    print(f"      MLP  best={best_mlp_p} | weighted CV={mlp_cv:.4f} | val={summarize_metrics(y_va, val_preds['MLP small neural network'])['log_loss']:.4f}", flush=True)

    val_table = build_metric_table(val_preds, y_va, val_df["match_id"].to_numpy(), REF_NAME, n_boot=n_boot, seed=random_state)
    val_table.to_csv(res_dir / "validation_table.csv")

    # Weighted OOF recalibration check
    recal_lr = weighted_oof_recalibrate(
        lambda: make_logreg(MAIN_FEATURES, C=best_lr_p["C"]),
        train_df[MAIN_FEATURES],
        y_tr,
        groups_tr,
        w_tr,
        lr_model,
        val_df[MAIN_FEATURES],
    )
    recal_hgb = weighted_oof_recalibrate(
        lambda: make_hgb(MAIN_FEATURES, monotonic=False, random_state=random_state, **best_hgb_p),
        train_df[MAIN_FEATURES],
        y_tr,
        groups_tr,
        w_tr,
        hgb_model,
        val_df[MAIN_FEATURES],
    )
    recal_summary = {
        "LR raw": summarize_metrics(y_va, recal_lr["raw"]),
        "LR + Platt": summarize_metrics(y_va, recal_lr["platt"]),
        "LR + isotonic": summarize_metrics(y_va, recal_lr["isotonic"]),
        "HGB raw": summarize_metrics(y_va, recal_hgb["raw"]),
        "HGB + Platt": summarize_metrics(y_va, recal_hgb["platt"]),
        "HGB + isotonic": summarize_metrics(y_va, recal_hgb["isotonic"]),
    }
    (res_dir / "recalibration_summary.json").write_text(json.dumps(recal_summary, indent=2), encoding="utf-8")

    # 7-stage feature ladder
    ladder, ladder_preds = run_feature_ladder(
        train_df,
        val_df,
        w_tr,
        best_c=float(best_lr_p["C"]),
        best_hgb_params=best_hgb_p,
        best_lgbm_params=best_lgbm_p,
        random_state=random_state,
    )
    ladder.to_csv(res_dir / "feature_ladder.csv", index=False)

    pick = select_parsimonious_model(ladder, tol=tol)
    sel_model = str(pick["model"])
    sel_stage = str(pick["feature set"])
    stage_groups = {
        "A core": ["core"],
        "B +derived": ["core", "derived"],
        "C +phase+momentum": ["core", "derived", "phase", "momentum"],
        "D +batters+bowling+impact": ["core", "derived", "phase", "momentum", "batters", "bowling", "impact"],
        "E +history": ["core", "derived", "phase", "momentum", "batters", "bowling", "impact", "history"],
        "F +home": ["core", "derived", "phase", "momentum", "batters", "bowling", "impact", "history", "home"],
        "G +form (all)": list(FEATURE_GROUPS.keys()),
    }
    sel_features = [f for g in stage_groups[sel_stage] for f in FEATURE_GROUPS[g]]
    sel_params = (
        {"C": float(best_lr_p["C"])}
        if sel_model == "logreg"
        else (best_lgbm_p if sel_model == "lgbm" else best_hgb_p)
    )
    selection = {
        "model": sel_model,
        "feature_set": sel_stage,
        "features": sel_features,
        "params": sel_params,
        "recency_decay": recency_decay,
        "validation_log_loss": float(pick["log_loss"]),
        "selection_rule": f"simplest candidate within {tol} of the best validation log loss",
        "train_seasons": [int(train_df["season"].min()), int(train_df["season"].max())],
        "validation_seasons": [int(val_df["season"].min()), int(val_df["season"].max())],
    }
    (res_dir / "model_selection.json").write_text(json.dumps(selection, indent=2), encoding="utf-8")
    print(f"      Selected: {sel_model} on '{sel_stage}' ({len(sel_features)} feats, val log loss={pick['log_loss']:.4f})")

    # Save val predictions
    keep_val = {**val_preds, f"{sel_model} | {sel_stage}": ladder_preds[(sel_stage, sel_model)]}
    pd.concat(
        [val_df[["match_id", "over", LABEL]].reset_index(drop=True), pd.DataFrame(keep_val)],
        axis=1,
    ).to_csv(res_dir / "val_predictions.csv", index=False)

    print("[5/6] Evaluating selected model on held-out 2025-2026 test set & computing importances ...")
    full_df = pd.concat([train_df, val_df], ignore_index=True)
    y_full = full_df[LABEL].to_numpy()
    y_te = test_df[LABEL].to_numpy()
    w_full = recency_weights(full_df["season"].to_numpy(), decay=recency_decay)

    def _build_selected(cols):
        if sel_model == "logreg":
            return make_logreg(cols, C=float(sel_params["C"]))
        if sel_model == "lgbm":
            return make_lgbm(cols, monotonic=False, random_state=random_state, **sel_params)
        return make_hgb(cols, monotonic=False, random_state=random_state, **sel_params)

    final_model = _build_selected(sel_features)
    fit_model_with_weights(final_model, full_df[sel_features], y_full, w_full)
    train_only_model = _build_selected(sel_features)
    fit_model_with_weights(train_only_model, train_df[sel_features], y_tr, w_tr)

    test_preds_map, _ = compute_baselines(
        full_df, test_df, const_name="A  constant (train+val win rate)"
    )
    final_key = f"FINAL {sel_model} ({sel_stage})"
    test_preds_map[final_key] = final_model.predict_proba(test_df[sel_features])[:, 1]
    test_preds_map["(ref) same model, train only"] = train_only_model.predict_proba(test_df[sel_features])[:, 1]

    test_table = build_metric_table(
        test_preds_map, y_te, test_df["match_id"].to_numpy(), REF_NAME, n_boot=n_boot, seed=random_state
    )
    test_table.to_csv(final_dir / "test_table.csv")
    print(f"      Held-out Test: {final_key} log_loss={test_table.loc[final_key, 'log_loss']:.4f}, Brier={test_table.loc[final_key, 'brier']:.4f}, Acc={test_table.loc[final_key, 'accuracy']:.4f}")

    # Per-season test breakdown
    season_rows = []
    for s, g in test_df.groupby("season"):
        yy = g[LABEL].to_numpy()
        idx = test_df.index.get_indexer(g.index)
        for k in (REF_NAME, final_key):
            season_rows.append(
                {
                    "season": int(s),
                    "matches": int(g["match_id"].nunique()),
                    "rows": int(len(g)),
                    "model": k.split()[0],
                    **summarize_metrics(yy, test_preds_map[k][idx]),
                }
            )
    pd.DataFrame(season_rows).round(4).to_csv(final_dir / "test_by_season.csv", index=False)

    # Match-level errors
    err_df = test_df.copy()
    err_df["p"] = test_preds_map[final_key]
    err_df["loss"] = row_log_loss(y_te, err_df["p"])
    err_df["lossB"] = row_log_loss(y_te, test_preds_map[REF_NAME])
    mm = (
        err_df.groupby("match_id")
        .agg(
            date=("date", "first"),
            season=("season", "first"),
            batting_team=("batting_team", "first"),
            bowling_team=("bowling_team", "first"),
            venue_clean=("venue_clean", "first"),
            target=("target", "first"),
            chase_won=(LABEL, "first"),
            mean_p=("p", "mean"),
            mean_loss=("loss", "mean"),
            mean_lossB=("lossB", "mean"),
        )
        .sort_values("mean_loss", ascending=False)
        .round(3)
    )
    mm.to_csv(final_dir / "test_match_errors.csv")

    cal_slope, cal_intercept = calibration_slope_intercept(y_te, test_preds_map[final_key])
    perm_imp = compute_permutation_importance(final_model, test_df, y_te, sel_features, n_repeats=5, seed=random_state)
    perm_imp.round(4).to_frame("log loss increase").to_csv(final_dir / "test_permutation_importance.csv")

    w_key = "clf__sample_weight" if sel_model == "logreg" else "sample_weight"
    drop_imp = compute_drop_column_importance(
        _build_selected, full_df, y_full, test_df, y_te, sel_features, sample_weight=w_full, fit_weight_key=w_key
    )
    drop_imp.round(4).to_frame("drop_column_log_loss_increase").to_csv(final_dir / "test_drop_column_importance.csv")

    test_results = {
        "model": sel_model,
        "feature_set": sel_stage,
        "features": sel_features,
        "params": sel_params,
        "fitted_on_seasons": [int(full_df["season"].min()), int(full_df["season"].max())],
        "test_seasons": [int(x) for x in sorted(test_df["season"].unique())],
        "test_matches": int(test_df["match_id"].nunique()),
        "test_rows": int(len(test_df)),
        "test_metrics": {k: summarize_metrics(y_te, p) for k, p in test_preds_map.items()},
        "calibration_slope": cal_slope,
        "calibration_intercept": cal_intercept,
    }
    (final_dir / "test_results.json").write_text(json.dumps(test_results, indent=2), encoding="utf-8")

    test_preds_df = pd.concat(
        [
            test_df[["match_id", "season", "over"]].reset_index(drop=True),
            pd.Series(y_te, name=LABEL),
            pd.DataFrame(test_preds_map),
        ],
        axis=1,
    )
    test_preds_df.to_csv(final_dir / "test_predictions.csv", index=False)

    # Ball-by-ball granularity + modern GBDT benchmark (High-Impact Upgrade #3)
    ball_benchmark = None
    if include_ball_by_ball and len(balls_df) > 0:
        print("[5b/6] Running ball-by-ball (~130k rows) benchmark across Rule B, LR, HGB, LightGBM, XGBoost ...")
        b_feat_df, _ = build_features(balls_df, first_df, dls_params=dls_params, verify_leakage=False)
        b_tr, b_va, b_te = split_by_season(b_feat_df)
        b_full = pd.concat([b_tr, b_va], ignore_index=True)
        by_full = b_full[LABEL].to_numpy()
        by_te = b_te[LABEL].to_numpy()
        bw_full = recency_weights(b_full["season"].to_numpy(), decay=recency_decay)

        b_preds, _ = compute_baselines(b_full, b_te, const_name="A  constant")
        b_lr = make_logreg(sel_features, C=float(best_lr_p["C"]))
        fit_model_with_weights(b_lr, b_full[sel_features], by_full, bw_full)
        b_preds["LR (11 feats, ball-by-ball)"] = b_lr.predict_proba(b_te[sel_features])[:, 1]

        b_lr19 = make_logreg(MAIN_FEATURES, C=float(best_lr_p["C"]))
        fit_model_with_weights(b_lr19, b_full[MAIN_FEATURES], by_full, bw_full)
        b_preds["LR (19 feats, ball-by-ball)"] = b_lr19.predict_proba(b_te[MAIN_FEATURES])[:, 1]

        b_hgb = make_hgb(MAIN_FEATURES, monotonic=True, random_state=random_state, **best_hgb_p)
        fit_model_with_weights(b_hgb, b_full[MAIN_FEATURES], by_full, bw_full)
        b_preds["HGBm (19 feats, ball-by-ball)"] = b_hgb.predict_proba(b_te[MAIN_FEATURES])[:, 1]

        if LGBMClassifier is not None and best_lgbm_p is not None:
            b_lgbm = make_lgbm(MAIN_FEATURES, monotonic=True, random_state=random_state, **best_lgbm_p)
            fit_model_with_weights(b_lgbm, b_full[MAIN_FEATURES], by_full, bw_full)
            b_preds["LGBMm (19 feats, ball-by-ball)"] = b_lgbm.predict_proba(b_te[MAIN_FEATURES])[:, 1]

        if XGBClassifier is not None:
            b_xgb = make_xgb(MAIN_FEATURES, monotonic=True, random_state=random_state, **best_xgb_p)
            fit_model_with_weights(b_xgb, b_full[MAIN_FEATURES], by_full, bw_full)
            b_preds["XGBm (19 feats, ball-by-ball)"] = b_xgb.predict_proba(b_te[MAIN_FEATURES])[:, 1]

        b_tbl = build_metric_table(b_preds, by_te, b_te["match_id"].to_numpy(), REF_NAME, n_boot=n_boot, seed=random_state)
        b_tbl.to_csv(final_dir / "ball_by_ball_test_table.csv")
        ball_benchmark = {
            "total_rows": int(len(b_feat_df)),
            "train_val_rows": int(len(b_full)),
            "test_rows": int(len(b_te)),
            "test_matches": int(b_te["match_id"].nunique()),
            "models": [
                {
                    "name": str(k).strip(),
                    "log_loss": float(r["log_loss"]),
                    "brier": float(r["brier"]),
                    "accuracy": float(r["accuracy"]),
                    "ci": str(r["95% CI"]),
                    "diff": None if pd.isna(r["diff vs B"]) else float(r["diff vs B"]),
                    "diff_ci": str(r["diff 95% CI"]) if isinstance(r["diff 95% CI"], str) else "",
                }
                for k, r in b_tbl.iterrows()
            ],
        }
        (final_dir / "ball_by_ball_benchmark.json").write_text(json.dumps(ball_benchmark, indent=2), encoding="utf-8")
        print(f"      Ball-by-ball test ({len(b_te)} deliveries): LR11={b_tbl.loc['LR (11 feats, ball-by-ball)', 'log_loss']:.4f}")

    print("[6/6] Exporting site/data/site_data.json with verified <1e-6 sklearn parity ...")
    site = export_site_data(
        train_df=train_df,
        val_df=val_df,
        test_df=test_df,
        features_all_df=feat_df,
        selection=selection,
        test_results=test_results,
        test_table=test_table,
        test_preds=test_preds_df,
        perm_importance=perm_imp,
        drop_importance=drop_imp,
        dls_params=dls_params,
        player_profiles=profiles,
        val_table=val_table,
        ball_benchmark=ball_benchmark,
        out_path=repo_root / "site" / "data" / "site_data.json",
    )
    print(f"Done! Exported {len(site['matches'])} test matches | parity max_diff={site['meta']['parity_max_diff']:.2e}")
    return site


def main() -> None:
    ap = argparse.ArgumentParser(description="Run full IPL Chase Win Probability pipeline.")
    ap.add_argument("--root", type=Path, default=Path("."), help="Repository root directory.")
    ap.add_argument("--no-balls", action="store_true", help="Skip ball-by-ball benchmark.")
    ap.add_argument("--boot", type=int, default=2000, help="Match-cluster bootstrap replicates.")
    args = ap.parse_args()
    run_pipeline(args.root.resolve(), include_ball_by_ball=not args.no_balls, n_boot=args.boot)


if __name__ == "__main__":
    main()
