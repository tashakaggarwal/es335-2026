"""
Parse Cricsheet IPL ball-by-ball JSON into a flat table of 2nd-innings (chase) states.

One row = state of the chase at the END of an over, using only information
available at that moment. Label = did the chasing team win the match.

Usage:
    python parse_cricsheet.py path/to/ipl_json  --out data/overs.csv

Outputs:
    data/overs.csv          one row per (match, completed over) of every kept chase
    data/match_log.csv      one row per match: kept or the reason it was dropped

Columns added for the "parse" features in ml_parameters.xlsx
------------------------------------------------------------
batsmen at crease at start of over
    striker, non_striker, striker_id, non_striker_id
        The two batters standing at the crease when the NEXT over starts
        (read from that over's first delivery; only who is there, never what happens).
        Empty if there is no next over. Use the *_id columns (Cricsheet registry ids).
strike rate of batsmen (overall past strike rate)
    striker_past_sr, non_striker_past_sr
        100 x runs off the bat / legal balls faced, over all IPL matches in the folder
        played STRICTLY BEFORE this match's date. Empty if the batter has no earlier
        IPL history.
    striker_past_balls, non_striker_past_balls
        The number of balls behind that strike rate (0 = no history). Use it to
        shrink noisy strike rates later.
balls played by the batsmen
    striker_balls_faced, non_striker_balls_faced
        Balls each of those two batters has faced so far in this chase.
        Wides do not count as faced; no-balls do.
impact player used?
    chasing_impact_used, bowling_impact_used
        1 once that team has made its Impact Player substitution, counted over the
        whole first innings plus the chase up to the end of this over. 0 before the
        rule existed (2023).
boundaries in last 3 overs
    boundaries_last_3
        Fours and sixes hit off the bat in the last 3 completed overs
        (same window as runs_last_3).
current partnership
    balls_since_last_wicket
        Legal balls bowled since the last wicket fell (or since the start of the chase).
home ground?
    chasing_team_home, bowling_team_home
        1 if the match was played at one of that team's home grounds (see HOME_GROUNDS,
        an approximation you can edit). 0 in 2020-2021 (bubble seasons) and in 2022
        league games (4 neutral grounds); abroad seasons are 0 automatically.
"""
import argparse
import json
from bisect import bisect_left
from collections import defaultdict
from pathlib import Path

import numpy as np
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

# Home grounds per franchise: lowercase fragments matched against the venue name.
# This is an approximation (teams sometimes play "home" games at second grounds).
HOME_GROUNDS = {
    "Chennai Super Kings": ["chidambaram"],
    "Mumbai Indians": ["wankhede"],
    "Kolkata Knight Riders": ["eden gardens"],
    "Royal Challengers Bengaluru": ["chinnaswamy"],
    "Delhi Capitals": ["arun jaitley", "feroz shah kotla", "rajasekhara reddy"],
    "Punjab Kings": ["punjab cricket association", "bindra", "himachal pradesh",
                     "maharaja yadavindra singh"],
    "Rajasthan Royals": ["sawai mansingh", "barsapara"],
    "Sunrisers Hyderabad": ["rajiv gandhi"],
    "Deccan Chargers": ["rajiv gandhi"],
    "Gujarat Titans": ["narendra modi", "sardar patel", "motera"],
    "Lucknow Super Giants": ["ekana"],
    "Gujarat Lions": ["saurashtra cricket association", "green park"],
    "Rising Pune Supergiant": ["maharashtra cricket association"],
    "Pune Warriors": ["subrata roy sahara", "maharashtra cricket association"],
    "Kochi Tuskers Kerala": ["nehru stadium"],
}
NO_HOME_SEASONS = {2020, 2021}  # bubble / closed-door seasons
# 2022 league games were played at four neutral grounds; only play-offs count there.

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


def faced_ball(delivery: dict) -> bool:
    """A batter faces every delivery except wides (no-balls count as faced)."""
    return "wides" not in delivery.get("extras", {})


def is_boundary(delivery: dict) -> bool:
    r = delivery["runs"]
    return r["batter"] in (4, 6) and not r.get("non_boundary")


def impact_teams(delivery: dict) -> set:
    """Teams that make an Impact Player substitution on this delivery."""
    teams = set()
    for lst in delivery.get("replacements", {}).values():
        for rep in lst:
            if rep.get("reason") == "impact_player":
                teams.add(rep["team"])
    return teams


def is_home(team: str, venue, season: int, stage) -> int:
    if season in NO_HOME_SEASONS or (season == 2022 and not stage):
        return 0
    v = (venue or "").lower()
    return int(any(k in v for k in HOME_GROUNDS.get(team, [])))


def parse_match(path: Path):
    """Return {"reason", "rows", "bat"}.

    rows: chase states (empty when the match is dropped).
    bat:  (date, batter_id, runs, balls) per batter per innings, for the
          past-strike-rate history. Collected for every IPL match, even ones
          dropped from the table (a rain-hit match still tells us about batters).
    """
    m = json.loads(path.read_text(encoding="utf-8"))
    info = m["info"]
    if "Indian Premier League" not in info.get("event", {}).get("name", ""):
        return {"reason": "not_ipl", "rows": [], "bat": []}

    date = info["dates"][0]
    people = info.get("registry", {}).get("people", {})

    def pid(name):
        return people.get(name, name)

    regular = [i for i in m["innings"] if not i.get("super_over")]

    # ---- batting history (every regular innings of this match)
    bat = []
    for inn in regular:
        agg = defaultdict(lambda: [0, 0])
        for ov in inn["overs"]:
            for d in ov["deliveries"]:
                a = agg[pid(d["batter"])]
                a[0] += d["runs"]["batter"]
                a[1] += int(faced_ball(d))
        bat += [(date, b, r, n) for b, (r, n) in agg.items()]

    # ---- filters for the chase table
    outcome = info.get("outcome", {})
    if "method" in outcome:
        return {"reason": "dls_applied", "rows": [], "bat": bat}
    if "winner" not in outcome:
        return {"reason": "tie_or_no_result", "rows": [], "bat": bat}
    if len(regular) != 2 or "target" not in regular[1]:
        return {"reason": "missing_second_innings", "rows": [], "bat": bat}
    if regular[1]["target"].get("overs") != 20:
        return {"reason": "reduced_overs", "rows": [], "bat": bat}

    inn1, inn2 = regular
    target = inn2["target"]["runs"]
    chasing_team = inn2["team"]      # raw names, as written in the file
    bowling_team = inn1["team"]
    won = int(outcome["winner"] == chasing_team)
    season = int(date[:4])
    venue = info.get("venue")
    stage = info.get("event", {}).get("stage")

    base = {
        "match_id": path.stem,
        "date": date,
        # IPL edition = calendar year of the match. Cricsheet's own label is
        # "2007/08" and "2009/10" for two editions, which truncating to four
        # characters turns into 2007 and a clash with the real 2009 season.
        "season": season,
        "venue": venue,
        "city": info.get("city"),
        "batting_team": norm(chasing_team),
        "bowling_team": norm(bowling_team),
        "toss_won_by_chaser": int(info.get("toss", {}).get("winner") == chasing_team),
        "target": target,
        "chasing_team_won": won,
    }
    home = {
        "chasing_team_home": is_home(norm(chasing_team), venue, season, stage),
        "bowling_team_home": is_home(norm(bowling_team), venue, season, stage),
    }

    # Impact substitutions made anywhere in the first innings are already known
    impact_used = set()
    for ov in inn1["overs"]:
        for d in ov["deliveries"]:
            impact_used |= impact_teams(d)

    overs2 = inn2["overs"]
    rows, history = [], []
    faced = defaultdict(int)  # balls faced so far in the chase, per batter id
    runs = wkts = balls = last_wicket_ball = 0
    for k, ov in enumerate(overs2):
        ov_runs = ov_wkts = ov_bounds = 0
        for d in ov["deliveries"]:
            ov_runs += d["runs"]["total"]
            nw = count_wickets(d)
            ov_wkts += nw
            balls += is_legal(d)
            if nw:
                last_wicket_ball = balls
            ov_bounds += is_boundary(d)
            if faced_ball(d):
                faced[pid(d["batter"])] += 1
            impact_used |= impact_teams(d)
        runs += ov_runs
        wkts += ov_wkts
        history.append((ov_runs, ov_wkts, ov_bounds))

        needed = target - runs
        balls_left = BALLS_IN_INNINGS - balls
        # Chase already decided (won, all out, or overs finished): not a
        # prediction problem, and including it would inflate scores.
        if needed <= 0 or wkts >= 10 or balls_left <= 0:
            break

        # Batters at the crease when the next over starts (who is there, nothing more)
        nxt = overs2[k + 1]["deliveries"] if k + 1 < len(overs2) else []
        striker = nxt[0]["batter"] if nxt else None
        non_striker = nxt[0]["non_striker"] if nxt else None
        s_id = pid(striker) if striker else None
        n_id = pid(non_striker) if non_striker else None

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
                "runs_last_3": sum(r for r, _, _ in last3),
                "wkts_last_3": sum(w for _, w, _ in last3),
                # ---- new parse features
                "striker": striker,
                "non_striker": non_striker,
                "striker_id": s_id,
                "non_striker_id": n_id,
                "striker_balls_faced": faced.get(s_id, 0) if s_id else np.nan,
                "non_striker_balls_faced": faced.get(n_id, 0) if n_id else np.nan,
                "chasing_impact_used": int(chasing_team in impact_used),
                "bowling_impact_used": int(bowling_team in impact_used),
                "boundaries_last_3": sum(b for _, _, b in last3),
                "balls_since_last_wicket": balls - last_wicket_ball,
                **home,
            }
        )
    return {"reason": "kept", "rows": rows, "bat": bat}


def build_history(bat_records):
    """batter id -> (sorted dates, cumulative runs, cumulative balls)."""
    by = defaultdict(list)
    for date, b, r, n in bat_records:
        by[b].append((date, r, n))
    idx = {}
    for b, lst in by.items():
        lst.sort()
        idx[b] = ([x[0] for x in lst],
                  np.cumsum([x[1] for x in lst]),
                  np.cumsum([x[2] for x in lst]))
    return idx


def past_stats(idx, batter_id, date):
    """(strike rate, balls) from IPL matches played strictly before `date`."""
    if batter_id is None:
        return np.nan, np.nan
    if batter_id not in idx:
        return np.nan, 0
    dates, cum_runs, cum_balls = idx[batter_id]
    i = bisect_left(dates, date)  # dates are ISO strings, so this is chronological
    if i == 0:
        return np.nan, 0
    balls = int(cum_balls[i - 1])
    return (100 * cum_runs[i - 1] / balls if balls else np.nan), balls


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

    all_rows, bat_records, log = [], [], []
    for p in files:
        try:
            res = parse_match(p)
        except (KeyError, ValueError, IndexError, TypeError):
            res = {"reason": "parse_error", "rows": [], "bat": []}
        log.append({"match_id": p.stem, "status": res["reason"]})
        all_rows.extend(res["rows"])
        bat_records.extend(res["bat"])

    # Past strike rates: only matches strictly before each match's date
    idx = build_history(bat_records)
    for r in all_rows:
        for who in ("striker", "non_striker"):
            sr, nb = past_stats(idx, r[f"{who}_id"], r["date"])
            r[f"{who}_past_sr"] = sr
            r[f"{who}_past_balls"] = nb

    args.out.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(all_rows)
    df.to_csv(args.out, index=False)
    log_df = pd.DataFrame(log)
    log_df.to_csv(args.out.parent / "match_log.csv", index=False)

    print(log_df["status"].value_counts().to_string())
    print(f"\n{df.match_id.nunique()} matches, {len(df)} rows -> {args.out}")
    print(df.groupby("season").match_id.nunique().to_string())
    print("Teams:", sorted(df.batting_team.unique()))
    new_cols = ["striker_past_sr", "non_striker_past_sr", "striker_balls_faced",
                "non_striker_balls_faced", "chasing_team_home", "bowling_team_home"]
    print("\nEmpty values in new columns:\n", df[new_cols].isna().sum().to_string())
    print("Home-ground rows (chasing team at home):", int(df.chasing_team_home.sum()))


if __name__ == "__main__":
    main()
