"""
Parse Cricsheet IPL ball-by-ball JSON into a flat table of 2nd-innings (chase) states.

One row = state of the chase at the END of an over, using only information
available at that moment. Label = did the chasing team win the match.

Usage:
    python scripts/parse_cricsheet.py data/raw --out data/parsed/overs.csv

Outputs:
    data/parsed/overs.csv                 one row per (match, completed over) of every kept chase
    data/parsed/match_log.csv             one row per match: kept or the reason it was dropped
    data/parsed/first_innings_states.csv  one row per (match, completed over) of every kept
                                          FIRST innings: used to fit a DLS-style resource curve

Columns
-------
batsmen at crease at start of over
    striker, non_striker, striker_id, non_striker_id
        The two batters standing at the crease when the NEXT over starts
        (read from that over's first delivery; only who is there, never what happens).
        Empty if there is no next over. Use the *_id columns (Cricsheet registry ids).
past batting record of those two batters (IPL matches STRICTLY BEFORE this match's date)
    striker_past_sr, non_striker_past_sr       100 x runs off the bat / balls faced
    striker_past_balls, non_striker_past_balls balls behind that strike rate (0 = no history)
    striker_past_bpd, non_striker_past_bpd     balls per dismissal (survival), shrunk towards
                                               BPD_PRIOR with BPD_K pseudo-dismissals
balls played / runs scored by the batsmen in this chase
    striker_balls_faced, non_striker_balls_faced   wides do not count as faced; no-balls do
    striker_runs, non_striker_runs                 runs off the bat so far in this chase
impact player used?
    chasing_impact_used, bowling_impact_used
        1 once that team has made its Impact Player substitution (first innings plus the
        chase up to the end of this over). 0 before the rule existed (2023).
boundaries in last 3 overs
    boundaries_last_3   fours and sixes off the bat in the last 3 completed overs
current partnership
    balls_since_last_wicket   legal balls since the last wicket fell
home ground?
    chasing_team_home, bowling_team_home
        1 if the match was played at one of that team's home grounds (HOME_GROUNDS).
        0 in 2020-2021 (bubble seasons) and in 2022 league games (4 neutral grounds).
remaining batting depth of the chasing side (from the named playing XI / squad list)
    rem_bat_n          players in the chasing squad list who have not yet come to the crease
    rem_bat_quality    sum of the 3 best past batting averages (shrunk) among them; 0 if none
    rem_bat_sr         mean past strike rate (shrunk) of those same (up to) 3 players
remaining bowling of the defending side
    bowl_rem_econ          expected economy of the overs still to be bowled, if the captain
                           uses his best (past economy, shrunk) bowlers first within their
                           4-over quotas
    bowl_rem_wkt_rate      expected wickets per ball over those same overs
    best_bowler_overs_left overs left for the defending side's two best (lowest past
                           economy) bowlers in this match
    All bowling history is past-only (matches strictly before this match's date), and the
    economy prior is the league economy over those same past matches.
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
MAX_OVERS_PER_BOWLER = 4

# Shrinkage for past records (pseudo-observations pulling a small sample to a prior)
AVG_PRIOR, AVG_K = 20.0, 4       # batting average  -> 20 runs, 4 pseudo-dismissals
SR_PRIOR, SR_K = 125.0, 60       # strike rate      -> 125, 60 pseudo-balls
BPD_PRIOR, BPD_K = 18.0, 4       # balls/dismissal  -> 18 balls, 4 pseudo-dismissals
BOWL_K = 120                     # bowler economy / wicket rate -> league past rate, 120 balls
MIN_PAST_BOWL_BALLS = 60         # a player counts as a bowler with this much past bowling
MIN_ATTACK = 5                   # assume at least 5 bowling options
FALLBACK_RPB, FALLBACK_WPB = 8.0 / 6, 1 / 20.0   # league prior before any past data

# Dismissal kinds that are not wickets / not credited to the bowler
NOT_OUT_KINDS = ("retired hurt", "retired not out")
NOT_BOWLER_KINDS = ("run out", "retired hurt", "retired not out", "retired out",
                    "obstructing the field")


def norm(team: str) -> str:
    return TEAM_MAP.get(team, team)


def is_legal(delivery: dict) -> bool:
    """Wides and no-balls do not use up one of the six balls."""
    extras = delivery.get("extras", {})
    return "wides" not in extras and "noballs" not in extras


def count_wickets(delivery: dict) -> int:
    return sum(1 for w in delivery.get("wickets", []) if w.get("kind") not in NOT_OUT_KINDS)


def faced_ball(delivery: dict) -> bool:
    """A batter faces every delivery except wides (no-balls count as faced)."""
    return "wides" not in delivery.get("extras", {})


def is_boundary(delivery: dict) -> bool:
    r = delivery["runs"]
    return r["batter"] in (4, 6) and not r.get("non_boundary")


def bowler_runs(delivery: dict) -> int:
    """Runs charged to the bowler: everything except byes, leg byes and penalties."""
    ex = delivery.get("extras", {})
    return delivery["runs"]["total"] - ex.get("byes", 0) - ex.get("legbyes", 0) - ex.get("penalty", 0)


def bowler_wickets(delivery: dict) -> int:
    return sum(1 for w in delivery.get("wickets", []) if w.get("kind") not in NOT_BOWLER_KINDS)


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
    """Return {"reason", "rows", "bat", "bowl", "first"}.

    rows:  chase states (empty when the match is dropped).
    bat:   (date, batter_id, runs, balls, dismissed) per batter per innings.
    bowl:  (date, bowler_id, runs_conceded, legal_balls, wickets) per bowler per innings.
           bat and bowl are collected for every IPL match, even ones dropped from the
           table (a rain-hit match still tells us about players).
    first: first-innings states of kept matches (for the resource curve).
    """
    m = json.loads(path.read_text(encoding="utf-8"))
    info = m["info"]
    if "Indian Premier League" not in info.get("event", {}).get("name", ""):
        return {"reason": "not_ipl", "rows": [], "bat": [], "bowl": [], "first": []}

    date = info["dates"][0]
    people = info.get("registry", {}).get("people", {})

    def pid(name):
        return people.get(name, name)

    regular = [i for i in m["innings"] if not i.get("super_over")]

    # ---- batting and bowling history (every regular innings of this match)
    bat, bowl = [], []
    for inn in regular:
        bagg = defaultdict(lambda: [0, 0, 0])   # runs, balls, dismissed
        wagg = defaultdict(lambda: [0, 0, 0])   # runs conceded, legal balls, wickets
        for ov in inn["overs"]:
            for d in ov["deliveries"]:
                b = bagg[pid(d["batter"])]
                b[0] += d["runs"]["batter"]
                b[1] += int(faced_ball(d))
                for w in d.get("wickets", []):
                    if w.get("kind") not in NOT_OUT_KINDS:
                        bagg[pid(w["player_out"])][2] += 1
                w_ = wagg[pid(d["bowler"])]
                w_[0] += bowler_runs(d)
                w_[1] += int(is_legal(d))
                w_[2] += bowler_wickets(d)
        bat += [(date, b, r, n, out) for b, (r, n, out) in bagg.items()]
        bowl += [(date, b, r, n, w) for b, (r, n, w) in wagg.items()]

    def dropped(reason):
        return {"reason": reason, "rows": [], "bat": bat, "bowl": bowl, "first": []}

    # ---- filters for the chase table
    outcome = info.get("outcome", {})
    if "method" in outcome:
        return dropped("dls_applied")
    if "winner" not in outcome:
        return dropped("tie_or_no_result")
    if len(regular) != 2 or "target" not in regular[1]:
        return dropped("missing_second_innings")
    if regular[1]["target"].get("overs") != 20:
        return dropped("reduced_overs")

    inn1, inn2 = regular
    target = inn2["target"]["runs"]
    chasing_team = inn2["team"]      # raw names, as written in the file
    bowling_team = inn1["team"]
    won = int(outcome["winner"] == chasing_team)
    season = int(date[:4])
    venue = info.get("venue")
    stage = info.get("event", {}).get("stage")
    players = info.get("players", {})
    chase_xi = [pid(p) for p in players.get(chasing_team, [])]
    bowl_xi = [pid(p) for p in players.get(bowling_team, [])]

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

    # ---- first-innings states (for the resource curve), and impact subs already made
    impact_used = set()
    first = []
    r1 = w1 = b1 = 0
    states1 = []
    for ov in inn1["overs"]:
        for d in ov["deliveries"]:
            impact_used |= impact_teams(d)
            r1 += d["runs"]["total"]
            w1 += count_wickets(d)
            b1 += is_legal(d)
        states1.append((b1, w1, r1))
    total1 = r1
    for b_, w_, r_ in states1:
        if w_ >= 10 or b_ >= BALLS_IN_INNINGS:
            break
        first.append({"match_id": path.stem, "season": season,
                      "balls_left": BALLS_IN_INNINGS - b_, "wickets_lost": w_,
                      "runs_so_far": r_, "runs_remaining": total1 - r_, "innings_total": total1})

    overs2 = inn2["overs"]
    rows, history = [], []
    faced = defaultdict(int)     # balls faced so far in the chase, per batter id
    bat_runs = defaultdict(int)  # runs off the bat so far in the chase, per batter id
    bowled = defaultdict(int)    # legal balls bowled so far in the chase, per bowler id
    came_in = set()              # chasing batters who have been to the crease
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
            bid = pid(d["batter"])
            came_in.update((bid, pid(d["non_striker"])))
            if faced_ball(d):
                faced[bid] += 1
            bat_runs[bid] += d["runs"]["batter"]
            bowled[pid(d["bowler"])] += int(is_legal(d))
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
        at_crease = {x for x in (s_id, n_id) if x}

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
                "striker": striker,
                "non_striker": non_striker,
                "striker_id": s_id,
                "non_striker_id": n_id,
                "striker_balls_faced": faced.get(s_id, 0) if s_id else np.nan,
                "non_striker_balls_faced": faced.get(n_id, 0) if n_id else np.nan,
                "striker_runs": bat_runs.get(s_id, 0) if s_id else np.nan,
                "non_striker_runs": bat_runs.get(n_id, 0) if n_id else np.nan,
                "chasing_impact_used": int(chasing_team in impact_used),
                "bowling_impact_used": int(bowling_team in impact_used),
                "boundaries_last_3": sum(b for _, _, b in last3),
                "balls_since_last_wicket": balls - last_wicket_ball,
                **home,
                # temporary fields, turned into features once past records are indexed
                "_yet_to_bat": [p for p in chase_xi if p not in came_in and p not in at_crease],
                "_bowl_xi": bowl_xi,
                "_bowled": dict(bowled),
            }
        )
    return {"reason": "kept", "rows": rows, "bat": bat, "bowl": bowl, "first": first}


class PastIndex:
    """player id -> cumulative sums of some columns, by date, for strictly-past lookups."""

    def __init__(self, records, ncols):
        by = defaultdict(list)
        for rec in records:
            by[rec[1]].append((rec[0],) + tuple(rec[2:]))
        self.ncols = ncols
        self.idx = {}
        for p, lst in by.items():
            lst.sort()
            self.idx[p] = ([x[0] for x in lst],
                           np.cumsum(np.array([x[1:] for x in lst], dtype=float), axis=0))
        # league totals by date (for priors that move with the era)
        allrec = sorted((rec[0],) + tuple(rec[2:]) for rec in records)
        self.lg_dates = [x[0] for x in allrec]
        self.lg_cum = np.cumsum(np.array([x[1:] for x in allrec], dtype=float), axis=0)

    def get(self, p, date):
        """Sums over matches strictly before `date` (zeros if none)."""
        if p is None or p not in self.idx:
            return np.zeros(self.ncols)
        dates, cum = self.idx[p]
        i = bisect_left(dates, date)  # dates are ISO strings, so this is chronological
        return cum[i - 1] if i else np.zeros(self.ncols)

    def league(self, date):
        i = bisect_left(self.lg_dates, date)
        return self.lg_cum[i - 1] if i else np.zeros(self.ncols)


def batting_stats(bat_idx, p, date):
    """(past sr or nan, past balls, shrunk average, shrunk sr, shrunk balls per dismissal)."""
    runs, balls, outs = bat_idx.get(p, date)
    sr = 100 * runs / balls if balls else np.nan
    avg = (runs + AVG_PRIOR * AVG_K) / (outs + AVG_K)
    sr_s = (100 * runs + SR_PRIOR * SR_K) / (balls + SR_K)
    bpd = (balls + BPD_PRIOR * BPD_K) / (outs + BPD_K)
    return sr, balls, avg, sr_s, bpd


def bowling_features(bowl_idx, xi, bowled, balls_left, date):
    """Expected economy / wicket rate of the remaining overs, best bowlers first."""
    lr, lb, lw = bowl_idx.league(date)
    rpb0 = lr / lb if lb else FALLBACK_RPB
    wpb0 = lw / lb if lb else FALLBACK_WPB
    cands = []
    for p in set(xi) | set(bowled):
        r, b, w = bowl_idx.get(p, date)
        cands.append({
            "past_balls": b, "chase_balls": bowled.get(p, 0),
            "rpb": (r + rpb0 * BOWL_K) / (b + BOWL_K),
            "wpb": (w + wpb0 * BOWL_K) / (b + BOWL_K),
        })
    attack = [c for c in cands if c["chase_balls"] > 0 or c["past_balls"] >= MIN_PAST_BOWL_BALLS]
    rest = sorted((c for c in cands if c not in attack), key=lambda c: -c["past_balls"])
    attack += rest[:max(0, MIN_ATTACK - len(attack))]
    for c in attack:
        c["left"] = max(0.0, MAX_OVERS_PER_BOWLER * 6 - c["chase_balls"])  # balls left in quota
    attack.sort(key=lambda c: c["rpb"])

    need, er, ew = float(balls_left), 0.0, 0.0
    for c in attack:  # captain uses his best bowlers first
        use = min(c["left"], need)
        er += use * c["rpb"]
        ew += use * c["wpb"]
        need -= use
        if need <= 0:
            break
    if need > 0:  # quotas exhausted (should not happen with 5 bowlers): league rate
        er += need * rpb0
        ew += need * wpb0
    best2 = sum(c["left"] for c in attack[:2]) / 6
    return 6 * er / balls_left, ew / balls_left, best2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("json_dir", type=Path)
    ap.add_argument("--out", type=Path, default=Path("data/parsed/overs.csv"))
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

    all_rows, bat_records, bowl_records, first_rows, log = [], [], [], [], []
    for p in files:
        try:
            res = parse_match(p)
            err = ""
        except (KeyError, ValueError, IndexError, TypeError) as e:
            res = {"reason": "parse_error", "rows": [], "bat": [], "bowl": [], "first": []}
            err = f"{type(e).__name__}: {e}"
            print(f"  parse_error in {p.name}: {err}")
        log.append({"match_id": p.stem, "status": res["reason"], "error": err})
        all_rows.extend(res["rows"])
        bat_records.extend(res["bat"])
        bowl_records.extend(res["bowl"])
        first_rows.extend(res["first"])

    # Past records: only matches strictly before each match's date
    bat_idx = PastIndex(bat_records, 3)
    bowl_idx = PastIndex(bowl_records, 3)
    for r in all_rows:
        for who in ("striker", "non_striker"):
            p = r[f"{who}_id"]
            sr, nb, _, _, bpd = batting_stats(bat_idx, p, r["date"])
            r[f"{who}_past_sr"] = sr if p else np.nan
            r[f"{who}_past_balls"] = nb if p else np.nan
            r[f"{who}_past_bpd"] = bpd if p else np.nan

        yet = sorted((batting_stats(bat_idx, p, r["date"]) for p in r.pop("_yet_to_bat")),
                     key=lambda s: -s[2])[:3]
        r["rem_bat_n"] = len(yet)
        r["rem_bat_quality"] = sum(s[2] for s in yet)
        r["rem_bat_sr"] = np.mean([s[3] for s in yet]) if yet else np.nan

        econ, wpb, best2 = bowling_features(bowl_idx, r.pop("_bowl_xi"), r.pop("_bowled"),
                                            r["balls_left"], r["date"])
        r["bowl_rem_econ"] = econ
        r["bowl_rem_wkt_rate"] = wpb
        r["best_bowler_overs_left"] = best2

    args.out.parent.mkdir(parents=True, exist_ok=True)
    df = pd.DataFrame(all_rows)
    df.to_csv(args.out, index=False)
    log_df = pd.DataFrame(log)
    log_df.to_csv(args.out.parent / "match_log.csv", index=False)
    first_df = pd.DataFrame(first_rows)
    first_df.to_csv(args.out.parent / "first_innings_states.csv", index=False)

    print(log_df["status"].value_counts().to_string())
    print(f"\n{df.match_id.nunique()} matches, {len(df)} rows -> {args.out}")
    print(f"{first_df.match_id.nunique()} first innings, {len(first_df)} states -> "
          f"{args.out.parent / 'first_innings_states.csv'}")
    print(df.groupby("season").match_id.nunique().to_string())
    print("Teams:", sorted(df.batting_team.unique()))
    new_cols = ["striker_past_sr", "non_striker_past_sr", "striker_balls_faced",
                "non_striker_balls_faced", "striker_runs", "striker_past_bpd",
                "rem_bat_quality", "rem_bat_sr", "bowl_rem_econ", "bowl_rem_wkt_rate",
                "best_bowler_overs_left", "chasing_team_home", "bowling_team_home"]
    print("\nEmpty values in new columns:\n", df[new_cols].isna().sum().to_string())
    print("\nNew column summaries:\n", df[new_cols[4:11]].describe().round(3).to_string())


if __name__ == "__main__":
    main()
