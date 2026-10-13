"""
Parse Cricsheet IPL ball-by-ball JSON into a flat table of 2nd-innings (chase) states.

One row = state of the chase at the END of an over, using only information
available at that moment. Label = did the chasing team win the match.

Usage:
    python parse_cricsheet.py path/to/ipl_json  --out data/overs.csv

Outputs:
    data/overs.csv          one row per (match, completed over) of every kept chase
    data/match_log.csv      one row per match: kept or the reason it was dropped
"""
import argparse
import json
from pathlib import Path

import pandas as pd

# Renamed franchises -> one canonical name. Print df.batting_team.unique()
# after parsing and extend this map if you spot other variants.
TEAM_MAP = {
    "Delhi Daredevils": "Delhi Capitals",
    "Kings XI Punjab": "Punjab Kings",
    "Royal Challengers Bangalore": "Royal Challengers Bengaluru",
    "Rising Pune Supergiants": "Rising Pune Supergiant",
    "Gujarat Lions": "Gujarat Lions",
}

BALLS_IN_INNINGS = 120


def norm(team: str) -> str:
    return TEAM_MAP.get(team, team)


def is_legal(delivery: dict) -> bool:
    """Wides and no-balls do not use up one of the six balls."""
    extras = delivery.get("extras", {})
    return "wides" not in extras and "noballs" not in extras


def count_wickets(delivery: dict) -> int:
    return sum(
        1
        for w in delivery.get("wickets", [])
        if w.get("kind") not in ("retired hurt", "retired not out")
    )


def parse_match(path: Path):
    """Return (rows, reason). rows is None when the match is dropped."""
    m = json.loads(path.read_text(encoding="utf-8"))
    info = m["info"]
    outcome = info.get("outcome", {})

    if "Indian Premier League" not in info.get("event", {}).get("name", ""):
        return None, "not_ipl"
    if "method" in outcome:
        return None, "dls_applied"
    if "winner" not in outcome:
        return None, "tie_or_no_result"

    innings = [i for i in m["innings"] if not i.get("super_over")]
    if len(innings) != 2 or "target" not in innings[1]:
        return None, "missing_second_innings"
    if innings[1]["target"].get("overs") != 20:
        return None, "reduced_overs"

    target = innings[1]["target"]["runs"]
    chasing_team = innings[1]["team"]
    won = int(outcome["winner"] == chasing_team)

    base = {
        "match_id": path.stem,
        "date": info["dates"][0],
        "season": str(info["season"])[:4],  # "2007/08" -> "2007"
        "venue": info.get("venue"),
        "city": info.get("city"),
        "batting_team": norm(chasing_team),
        "bowling_team": norm(innings[0]["team"]),
        "toss_won_by_chaser": int(info.get("toss", {}).get("winner") == chasing_team),
        "target": target,
        "chasing_team_won": won,
    }

    rows, history = [], []
    runs = wkts = balls = 0
    for ov in innings[1]["overs"]:
        ov_runs = ov_wkts = 0
        for d in ov["deliveries"]:
            ov_runs += d["runs"]["total"]
            ov_wkts += count_wickets(d)
            balls += is_legal(d)
        runs += ov_runs
        wkts += ov_wkts
        history.append((ov_runs, ov_wkts))

        needed = target - runs
        balls_left = BALLS_IN_INNINGS - balls
        # Chase already decided (won, all out, or overs finished): not a
        # prediction problem, and including it would inflate scores.
        if needed <= 0 or wkts >= 10 or balls_left <= 0:
            break

        last3 = history[-3:]
        rows.append(
            {
                **base,
                "over": len(history),  # overs completed
                "runs_so_far": runs,
                "wickets_lost": wkts,
                "balls_left": balls_left,
                "runs_needed": needed,
                "current_run_rate": runs * 6 / balls,
                "required_run_rate": needed * 6 / balls_left,
                "runs_last_3": sum(r for r, _ in last3),
                "wkts_last_3": sum(w for _, w in last3),
            }
        )
    return rows, "kept"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("json_dir", type=Path)
    ap.add_argument("--out", type=Path, default=Path("data/overs.csv"))
    args = ap.parse_args()

    if not args.json_dir.is_dir():
        raise SystemExit(f"Folder not found: {args.json_dir.resolve()}")
    files = sorted(args.json_dir.rglob("*.json"))  # rglob also finds subfolders
    if not files:
        raise SystemExit(
            f"No .json files found under {args.json_dir.resolve()}. "
            "Unzip the Cricsheet IPL download first and point to that folder."
        )
    print(f"Found {len(files)} json files under {args.json_dir.resolve()}")

    all_rows, log = [], []
    for p in files:
        try:
            rows, reason = parse_match(p)
        except (KeyError, ValueError, IndexError):
            rows, reason = None, "parse_error"
        log.append({"match_id": p.stem, "status": reason})
        if rows:
            all_rows.extend(rows)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(all_rows)
    df.to_csv(args.out, index=False)
    log_df = pd.DataFrame(log)
    log_df.to_csv(args.out.parent / "match_log.csv", index=False)

    print(log_df["status"].value_counts().to_string())
    print(f"\n{df.match_id.nunique()} matches, {len(df)} rows -> {args.out}")
    print(df.groupby("season").match_id.nunique().to_string())
    print("Teams:", sorted(df.batting_team.unique()))


if __name__ == "__main__":
    main()