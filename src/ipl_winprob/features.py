"""Leakage-free feature engineering, brute-force temporal audit, and chronological season splitting."""

from collections import defaultdict, deque
from typing import Dict, Tuple

import numpy as np
import pandas as pd

from .constants import (
    ALL_FEATURES,
    BPD_PRIOR,
    FORM_N,
    K_FORM,
    K_HOME,
    K_RECENT_PAR,
    K_SEASON,
    K_VENUE,
    K_VENUE_PAR,
    RECENT_PAR_N,
    RRR_CAP,
    SR_K,
    SR_PRIOR,
    clean_venue,
)
from .dls import evaluate_dls_resources, fit_dls_curve


def parse_dates(series: pd.Series) -> pd.Series:
    s = series.astype(str)
    if s.str.fullmatch(r"\d{4}-\d{2}-\d{2}").all():
        return pd.to_datetime(s, format="%Y-%m-%d")
    if s.str.fullmatch(r"\d{2}-\d{2}-\d{2}").all():
        return pd.to_datetime(s, format="%d-%m-%y")
    return pd.to_datetime(s)


def build_match_table(df: pd.DataFrame) -> pd.DataFrame:
    return (
        df.groupby("match_id")
        .agg(
            date=("date", "first"),
            season=("season", "first"),
            venue=("venue_clean", "first"),
            chaser=("batting_team", "first"),
            bowler=("bowling_team", "first"),
            target=("target", "first"),
            won=("chasing_team_won", "first"),
            chaser_home=("chasing_team_home", "first"),
            bowler_home=("bowling_team_home", "first"),
        )
        .reset_index()
        .sort_values(["date", "match_id"])
        .reset_index(drop=True)
    )


def compute_history_features(mt: pd.DataFrame) -> pd.DataFrame:
    """Compute strictly past-only match-level historical features (excluding same-day & future matches)."""
    season_sum, season_n = defaultdict(float), defaultdict(int)
    season_mean_final = mt.groupby("season")["target"].mean().to_dict()
    venue_w, venue_n = defaultdict(int), defaultdict(int)
    venue_t_sum = defaultdict(float)
    recent_targets: deque = deque(maxlen=RECENT_PAR_N)
    league_w = league_n = 0
    home_w, home_n = defaultdict(int), defaultdict(int)
    lh_w = lh_n = 0
    recent = defaultdict(lambda: deque(maxlen=FORM_N))

    out = []
    for _, day in mt.groupby("date", sort=True):
        # 1) Compute features strictly from matches before today
        for r in day.itertuples():
            prior = season_mean_final.get(r.season - 1, np.nan)
            n, s = season_n[r.season], season_sum[r.season]
            if np.isnan(prior):
                avg = s / n if n else np.nan
            else:
                avg = (s + K_SEASON * prior) / (n + K_SEASON)

            r_par = (sum(recent_targets) + K_RECENT_PAR * 170.0) / (len(recent_targets) + K_RECENT_PAR)
            v_par = (venue_t_sum[r.venue] + K_VENUE_PAR * r_par) / (venue_n[r.venue] + K_VENUE_PAR)
            p0 = league_w / league_n if league_n else 0.5
            ph = lh_w / lh_n if lh_n else 0.5

            edge = 0.0
            if r.chaser_home:
                edge = (home_w[r.chaser] + K_HOME * ph) / (home_n[r.chaser] + K_HOME) - ph
            elif r.bowler_home:
                edge = -((home_w[r.bowler] + K_HOME * ph) / (home_n[r.bowler] + K_HOME) - ph)

            def _form(team: str) -> float:
                h = recent[(team, r.season)]
                return (sum(h) + K_FORM * 0.5) / (len(h) + K_FORM)

            out.append(
                (
                    r.match_id,
                    r.target - avg,
                    r.target - r_par,
                    r.target - v_par,
                    v_par,
                    (venue_w[r.venue] + K_VENUE * p0) / (venue_n[r.venue] + K_VENUE),
                    edge,
                    _form(r.chaser),
                    _form(r.bowler),
                )
            )
        # 2) Only after scoring all of today's matches, update history accumulators
        for r in day.itertuples():
            season_sum[r.season] += r.target
            season_n[r.season] += 1
            venue_w[r.venue] += r.won
            venue_n[r.venue] += 1
            venue_t_sum[r.venue] += r.target
            recent_targets.append(r.target)
            league_w += r.won
            league_n += 1
            if r.chaser_home:
                home_w[r.chaser] += r.won
                home_n[r.chaser] += 1
                lh_w += r.won
                lh_n += 1
            elif r.bowler_home:
                home_w[r.bowler] += 1 - r.won
                home_n[r.bowler] += 1
                lh_w += 1 - r.won
                lh_n += 1
            recent[(r.chaser, r.season)].append(r.won)
            recent[(r.bowler, r.season)].append(1 - r.won)

    return pd.DataFrame(
        out,
        columns=[
            "match_id",
            "target_vs_season_avg",
            "target_vs_recent_par",
            "target_vs_venue_par",
            "venue_par_past",
            "venue_chase_rate",
            "home_edge",
            "chaser_form",
            "bowler_form",
        ],
    ).set_index("match_id")


def verify_no_temporal_leakage(
    mt: pd.DataFrame, hist: pd.DataFrame, n_sample: int = 60, seed: int = 0
) -> int:
    """Brute-force recompute past-only features on random matches and count disagreements."""
    cols = [
        "target_vs_season_avg",
        "target_vs_recent_par",
        "target_vs_venue_par",
        "venue_chase_rate",
        "home_edge",
        "chaser_form",
        "bowler_form",
    ]
    n_check = min(n_sample, len(mt))
    sample = mt.sample(n_check, random_state=seed)
    bad = 0
    for m in sample.itertuples():
        past = mt[mt["date"] < m.date]
        ps = past[past["season"] == m.season]
        prior = mt.loc[mt["season"] == m.season - 1, "target"].mean()
        n, s = len(ps), ps["target"].sum()
        avg = (s / n if n else np.nan) if np.isnan(prior) else (s + K_SEASON * prior) / (n + K_SEASON)
        p0 = past["won"].mean() if len(past) else 0.5
        rec_t = past["target"].tail(RECENT_PAR_N)
        r_par = (rec_t.sum() + K_RECENT_PAR * 170.0) / (len(rec_t) + K_RECENT_PAR)
        pv = past[past["venue"] == m.venue]
        v_par = (pv["target"].sum() + K_VENUE_PAR * r_par) / (len(pv) + K_VENUE_PAR)
        vcr = (pv["won"].sum() + K_VENUE * p0) / (len(pv) + K_VENUE)

        hg = pd.concat(
            [
                past[past["chaser_home"] == 1].assign(team=lambda x: x["chaser"], hw=lambda x: x["won"]),
                past[(past["bowler_home"] == 1) & (past["chaser_home"] != 1)].assign(
                    team=lambda x: x["bowler"], hw=lambda x: 1 - x["won"]
                ),
            ]
        )
        ph = hg["hw"].mean() if len(hg) else 0.5

        def _home_rec(team: str) -> float:
            g = hg[hg["team"] == team]
            return (g["hw"].sum() + K_HOME * ph) / (len(g) + K_HOME) - ph

        edge = _home_rec(m.chaser) if m.chaser_home else (-_home_rec(m.bowler) if m.bowler_home else 0.0)

        def _form(team: str) -> float:
            g = ps[(ps["chaser"] == team) | (ps["bowler"] == team)].tail(FORM_N)
            res = np.where(g["chaser"] == team, g["won"], 1 - g["won"])
            return (res.sum() + K_FORM * 0.5) / (len(g) + K_FORM)

        exp = np.array(
            [m.target - avg, m.target - r_par, m.target - v_par, vcr, edge, _form(m.chaser), _form(m.bowler)],
            dtype=float,
        )
        got = hist.loc[m.match_id, cols].to_numpy(dtype=float)
        if not np.all((np.isnan(exp) & np.isnan(got)) | np.isclose(exp, got, atol=1e-9)):
            bad += 1
    return bad


def _shrunk_sr(sr: pd.Series, balls: pd.Series) -> pd.Series:
    return (sr.fillna(SR_PRIOR) * balls.fillna(0) + SR_PRIOR * SR_K) / (balls.fillna(0) + SR_K)


def build_features(
    states_df: pd.DataFrame,
    first_innings_df: pd.DataFrame,
    dls_params: Dict[str, object] = None,
    dls_fit_before_season: int = 2024,
    verify_leakage: bool = True,
) -> Tuple[pd.DataFrame, Dict[str, object]]:
    """Build all 39 engineered features for either over-level or ball-by-ball chase states."""
    d = states_df.copy()
    d["date"] = parse_dates(d["date"])
    d["season"] = d["date"].dt.year
    d["venue_clean"] = d["venue"].map(clean_venue)
    sort_cols = ["date", "match_id", "ball_num"] if "ball_num" in d.columns else ["date", "match_id", "over"]
    d = d.sort_values(sort_cols).reset_index(drop=True)

    mt = build_match_table(d)
    hist = compute_history_features(mt)
    if verify_leakage:
        bad = verify_no_temporal_leakage(mt, hist, n_sample=60, seed=0)
        if bad != 0:
            raise AssertionError(f"Temporal leakage audit failed with {bad} disagreements")

    if dls_params is None:
        dls_params = fit_dls_curve(first_innings_df, fit_before_season=dls_fit_before_season)

    d["wickets_in_hand"] = 10 - d["wickets_lost"]
    d["required_run_rate"] = d["required_run_rate"].clip(upper=RRR_CAP)
    d["run_rate_diff"] = d["required_run_rate"] - d["current_run_rate"]
    d["runs_needed_frac"] = d["runs_needed"] / d["target"]
    d["resources"] = d["balls_left"] * d["wickets_in_hand"]
    d["runs_needed_per_wicket"] = d["runs_needed"] / d["wickets_in_hand"]
    d["acceleration"] = d["runs_last_3"] / d["over"].clip(lower=1.0 / 6.0, upper=3.0) - d["current_run_rate"]

    d["dls_resources"] = evaluate_dls_resources(
        d["balls_left"].to_numpy(), d["wickets_lost"].to_numpy(), dls_params
    )
    d["par_score_diff"] = d["runs_so_far"] - d["target"] * (1.0 - d["dls_resources"] / 100.0)

    d["is_powerplay"] = (d["over"] <= 6.0).astype(int)
    d["is_death"] = (d["over"] >= 15.0).astype(int)
    d["powerplay_balls_left"] = np.maximum(0, 36 - (120 - d["balls_left"]))

    d["bat_sr_mean"] = (
        _shrunk_sr(d["striker_past_sr"], d["striker_past_balls"])
        + _shrunk_sr(d["non_striker_past_sr"], d["non_striker_past_balls"])
    ) / 2.0
    d["bat_bpd_mean"] = (
        d["striker_past_bpd"].fillna(BPD_PRIOR) + d["non_striker_past_bpd"].fillna(BPD_PRIOR)
    ) / 2.0
    d["bat_balls_sum"] = d["striker_balls_faced"] + d["non_striker_balls_faced"]
    d["bat_balls_max"] = np.maximum(d["striker_balls_faced"], d["non_striker_balls_faced"])
    d["bat_runs_sum"] = d["striker_runs"].fillna(0) + d["non_striker_runs"].fillna(0)
    d["settled_sr_interaction"] = (d["bat_balls_max"] * d["bat_sr_mean"]) / 100.0

    no_batters = d["striker_id"].isna() | d["non_striker_id"].isna()
    d.loc[
        no_batters,
        ["bat_sr_mean", "bat_bpd_mean", "bat_balls_sum", "bat_balls_max", "bat_runs_sum", "settled_sr_interaction"],
    ] = np.nan

    d = d.merge(hist, left_on="match_id", right_index=True, how="left")

    meta = [
        "match_id",
        "date",
        "season",
        "over",
        *(["ball_num"] if "ball_num" in d.columns else []),
        "batting_team",
        "bowling_team",
        "venue_clean",
        "target",
        "venue_par_past",
        "resources",
        "bat_balls_sum",
        "chasing_team_won",
    ]
    d["date"] = d["date"].dt.strftime("%Y-%m-%d")
    return d[meta + ALL_FEATURES], dls_params


def split_by_season(
    df: pd.DataFrame,
    train_end: int = 2023,
    val_season: int = 2024,
    test_start: int = 2025,
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Chronological season split guaranteeing zero match overlap across splits."""
    s = pd.to_numeric(df["season"], errors="coerce")
    train_df = df[s <= train_end].copy()
    val_df = df[s == val_season].copy()
    test_df = df[s >= test_start].copy()
    assert not (set(train_df["match_id"]) & set(val_df["match_id"]))
    assert not (set(train_df["match_id"]) & set(test_df["match_id"]))
    assert not (set(val_df["match_id"]) & set(test_df["match_id"]))
    return train_df, val_df, test_df
