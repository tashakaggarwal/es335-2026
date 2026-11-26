"""Unit tests for Cricsheet ball-by-ball parsing, cricket edge cases, and serving profile parity."""

import json
from pathlib import Path

import pytest

from ipl_winprob.constants import AVG_K, AVG_PRIOR, BPD_K, BPD_PRIOR, SR_K, SR_PRIOR
from ipl_winprob.parse import (
    bowler_runs,
    bowler_wickets,
    build_serving_player_profiles,
    count_wickets,
    faced_ball,
    is_legal,
    parse_match,
)


def _make_match_json(
    *,
    method=None,
    winner="Team B",
    overs_target=20,
    super_over=False,
    event_name="Indian Premier League",
) -> dict:
    """Construct a minimal valid synthetic Cricsheet IPL JSON."""
    inn1_overs = []
    for ov in range(2):
        inn1_overs.append(
            {
                "over": ov,
                "deliveries": [
                    {
                        "batter": "A1",
                        "bowler": "B1",
                        "non_striker": "A2",
                        "runs": {"batter": 2, "extras": 0, "total": 2},
                    }
                    for _ in range(6)
                ],
            }
        )
    # Second innings: 2 overs with a wide, a no-ball, a penalty extra, a retired hurt, and a wicket
    ov0_deliveries = [
        {"batter": "B1", "bowler": "A1", "non_striker": "B2", "extras": {"wides": 1}, "runs": {"batter": 0, "extras": 1, "total": 1}},
        {"batter": "B1", "bowler": "A1", "non_striker": "B2", "extras": {"noballs": 1}, "runs": {"batter": 4, "extras": 1, "total": 5}},
        {"batter": "B1", "bowler": "A1", "non_striker": "B2", "extras": {"penalty": 5}, "runs": {"batter": 0, "extras": 5, "total": 5}},
        {
            "batter": "B1",
            "bowler": "A1",
            "non_striker": "B2",
            "runs": {"batter": 0, "extras": 0, "total": 0},
            "wickets": [{"player_out": "B1", "kind": "retired hurt"}],
        },
        {
            "batter": "B3",
            "bowler": "A1",
            "non_striker": "B2",
            "runs": {"batter": 0, "extras": 0, "total": 0},
            "wickets": [{"player_out": "B3", "kind": "bowled"}],
        },
        {"batter": "B4", "bowler": "A1", "non_striker": "B2", "runs": {"batter": 1, "extras": 0, "total": 1}},
        {"batter": "B2", "bowler": "A1", "non_striker": "B4", "runs": {"batter": 1, "extras": 0, "total": 1}},
        {"batter": "B4", "bowler": "A1", "non_striker": "B2", "runs": {"batter": 0, "extras": 0, "total": 0}},
    ]
    ov1_deliveries = [
        {"batter": "B2", "bowler": "A2", "non_striker": "B4", "runs": {"batter": 6, "extras": 0, "total": 6}},
        {"batter": "B2", "bowler": "A2", "non_striker": "B4", "runs": {"batter": 6, "extras": 0, "total": 6}},
        {"batter": "B2", "bowler": "A2", "non_striker": "B4", "runs": {"batter": 1, "extras": 0, "total": 1}},
    ]

    outcome = {}
    if winner is not None:
        outcome["winner"] = winner
    if method is not None:
        outcome["method"] = method

    innings = [
        {"team": "Team A", "overs": inn1_overs},
        {"team": "Team B", "overs": [{"over": 0, "deliveries": ov0_deliveries}, {"over": 1, "deliveries": ov1_deliveries}], "target": {"overs": overs_target, "runs": 25}},
    ]
    if super_over:
        innings.append({"team": "Team A", "overs": inn1_overs[:1], "super_over": True})

    return {
        "info": {
            "dates": ["2024-04-01"],
            "event": {"name": event_name},
            "venue": "Wankhede Stadium, Mumbai",
            "city": "Mumbai",
            "teams": ["Team A", "Team B"],
            "toss": {"winner": "Team B", "decision": "field"},
            "outcome": outcome,
            "players": {
                "Team A": ["A1", "A2", "A3", "A4", "A5", "A6"],
                "Team B": ["B1", "B2", "B3", "B4", "B5", "B6"],
            },
            "registry": {
                "people": {f"{t}{i}": f"id_{t}{i}" for t in ("A", "B") for i in range(1, 7)}
            },
        },
        "innings": innings,
    }


def test_delivery_rules():
    wide = {"extras": {"wides": 1}, "runs": {"batter": 0, "extras": 1, "total": 1}}
    nb = {"extras": {"noballs": 1}, "runs": {"batter": 4, "extras": 1, "total": 5}}
    pen = {"extras": {"penalty": 5}, "runs": {"batter": 0, "extras": 5, "total": 5}}
    ret_hurt = {"runs": {"batter": 0, "total": 0}, "wickets": [{"kind": "retired hurt"}]}
    ret_not_out = {"runs": {"batter": 0, "total": 0}, "wickets": [{"kind": "retired not out"}]}
    run_out = {"runs": {"batter": 0, "total": 0}, "wickets": [{"kind": "run out"}]}

    assert not is_legal(wide) and not faced_ball(wide)
    assert not is_legal(nb) and faced_ball(nb)
    assert bowler_runs(pen) == 0
    assert count_wickets(ret_hurt) == 0 and count_wickets(ret_not_out) == 0
    assert count_wickets(run_out) == 1 and bowler_wickets(run_out) == 0


def test_parse_match_exclusions_and_ball_granularity(tmp_path: Path):
    # 1. Valid match with over-level and ball-by-ball rows
    p_ok = tmp_path / "1001.json"
    p_ok.write_text(json.dumps(_make_match_json(super_over=True)), encoding="utf-8")
    res = parse_match(p_ok, include_balls=True)
    assert res["reason"] == "kept"
    # Over 0 ends at 13/1 (target 25); Over 1 reaches 26/1 (chase finished -> excluded)
    assert len(res["rows"]) == 1
    assert res["rows"][0]["runs_so_far"] == 13
    assert res["rows"][0]["wickets_lost"] == 1  # retired hurt NOT counted
    assert res["rows"][0]["balls_left"] == 114  # 6 legal balls (wide + noball excluded)
    # Ball-by-ball: 6 legal balls in over 0 (13/1) + 1 legal ball in over 1 (19/1); ball 2 hits 6 -> 25/1 (target reached!)
    assert len(res["ball_rows"]) == 7
    assert res["ball_rows"][-1]["runs_so_far"] == 19
    assert res["ball_rows"][-1]["runs_needed"] == 6

    # 2. Exclusions
    for name, kw, expected in [
        ("dls.json", {"method": "D/L"}, "dls_applied"),
        ("nr.json", {"winner": None}, "tie_or_no_result"),
        ("red.json", {"overs_target": 15}, "reduced_overs"),
        ("nonipl.json", {"event_name": "Big Bash League"}, "not_ipl"),
    ]:
        fp = tmp_path / name
        fp.write_text(json.dumps(_make_match_json(**kw)), encoding="utf-8")
        assert parse_match(fp)["reason"] == expected


def test_serving_profiles_match_training_shrinkage(tmp_path: Path):
    # Ensure build_serving_player_profiles uses IDENTICAL AVG_K=4, BPD_K=4, SR_K=60 & penalty rules
    m = _make_match_json()
    m["info"]["dates"] = ["2025-04-01"]
    (tmp_path / "2001.json").write_text(json.dumps(m), encoding="utf-8")
    prof = build_serving_player_profiles(tmp_path, full_name_map={}, squad_from_season=2025)

    # B1 faced: noball (4 runs, 1 ball) + penalty ball (0 runs, 1 ball) + retired hurt ball (0 runs, 1 ball) = 4 runs, 3 balls, 0 outs
    expected_sr = round((100.0 * 4 + SR_PRIOR * SR_K) / (3 + SR_K), 2)
    expected_bpd = round((3 + BPD_PRIOR * BPD_K) / (0 + BPD_K), 2)
    expected_avg = round((4 + AVG_PRIOR * AVG_K) / (0 + AVG_K), 2)
    assert prof["batters"]["B1"] == pytest.approx(expected_sr)
    assert prof["batters_bpd"]["B1"] == pytest.approx(expected_bpd)
    assert prof["batters_avg"]["B1"] == pytest.approx(expected_avg)
