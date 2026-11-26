"""Automated temporal leakage audit and chronological split disjointness tests."""

import numpy as np
import pandas as pd

from ipl_winprob.features import compute_history_features, split_by_season, verify_no_temporal_leakage


def _synthetic_matches(n_matches: int = 80) -> pd.DataFrame:
    rng = np.random.default_rng(7)
    teams = ["Mumbai Indians", "Chennai Super Kings", "Royal Challengers Bengaluru", "Kolkata Knight Riders"]
    venues = ["Wankhede Stadium, Mumbai", "MA Chidambaram Stadium, Chennai", "Eden Gardens, Kolkata"]
    rows = []
    # Include deliberate same-day doubleheaders to verify same-day exclusion
    dates = pd.date_range("2021-04-01", periods=n_matches // 2, freq="3D").repeat(2)
    for i in range(n_matches):
        ch, bw = rng.choice(teams, size=2, replace=False)
        rows.append(
            {
                "match_id": f"m_{i:04d}",
                "date": dates[i],
                "season": int(dates[i].year),
                "venue": str(rng.choice(venues)),
                "chaser": str(ch),
                "bowler": str(bw),
                "target": int(rng.integers(135, 225)),
                "won": int(rng.integers(0, 2)),
                "chaser_home": int(i % 3 == 0),
                "bowler_home": int(i % 3 == 1),
            }
        )
    return pd.DataFrame(rows).sort_values(["date", "match_id"]).reset_index(drop=True)


def test_past_only_history_has_zero_leakage():
    mt = _synthetic_matches(80)
    hist = compute_history_features(mt)
    disagreements = verify_no_temporal_leakage(mt, hist, n_sample=60, seed=0)
    assert disagreements == 0


def test_same_day_doubleheader_does_not_leak():
    mt = _synthetic_matches(10)
    # Match 0 and Match 1 are on the exact same first day; neither may see the other
    hist = compute_history_features(mt)
    assert np.isnan(hist.loc["m_0000", "target_vs_season_avg"])
    assert np.isnan(hist.loc["m_0001", "target_vs_season_avg"])
    # Both share identical initial venue chase rate prior (0.5)
    assert hist.loc["m_0000", "venue_chase_rate"] == 0.5
    assert hist.loc["m_0001", "venue_chase_rate"] == 0.5


def test_chronological_season_split_is_disjoint():
    df = pd.DataFrame(
        {
            "match_id": [f"m_{s}_{i}" for s in (2022, 2023, 2024, 2025, 2026) for i in range(3)],
            "season": [s for s in (2022, 2023, 2024, 2025, 2026) for _ in range(3)],
        }
    )
    tr, va, te = split_by_season(df, train_end=2023, val_season=2024, test_start=2025)
    assert tr["season"].max() <= 2023
    assert set(va["season"].unique()) == {2024}
    assert te["season"].min() >= 2025
    assert not (set(tr["match_id"]) & set(va["match_id"]))
    assert not (set(tr["match_id"]) & set(te["match_id"]))
    assert not (set(va["match_id"]) & set(te["match_id"]))
