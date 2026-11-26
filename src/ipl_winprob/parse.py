"""Parse Cricsheet IPL ball-by-ball JSON into over-level and ball-by-ball chase state tables
and unified player serving profiles (zero training-serving skew)."""

import json
from bisect import bisect_left
from collections import defaultdict, deque
from pathlib import Path
from typing import Dict, List, Tuple

import numpy as np
import pandas as pd

from .constants import (
    AVG_K,
    AVG_PRIOR,
    BALLS_IN_INNINGS,
    BOWL_K,
    BPD_K,
    BPD_PRIOR,
    FALLBACK_RPB,
    FALLBACK_WPB,
    HOME_GROUNDS,
    MAX_OVERS_PER_BOWLER,
    MIN_ATTACK,
    MIN_PAST_BOWL_BALLS,
    NO_HOME_SEASONS,
    NOT_BOWLER_KINDS,
    NOT_OUT_KINDS,
    SR_K,
    SR_PRIOR,
    norm_team,
)


def is_legal(delivery: dict) -> bool:
    """Wides and no-balls do not consume one of the 6 legal balls in an over."""
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
    """Runs charged to the bowler: total minus byes, legbyes, and penalty extras."""
    ex = delivery.get("extras", {})
    return delivery["runs"]["total"] - ex.get("byes", 0) - ex.get("legbyes", 0) - ex.get("penalty", 0)


def bowler_wickets(delivery: dict) -> int:
    return sum(1 for w in delivery.get("wickets", []) if w.get("kind") not in NOT_BOWLER_KINDS)


def impact_teams(delivery: dict) -> set:
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


def parse_match(path: Path, include_balls: bool = False) -> dict:
    """Parse one Cricsheet JSON match file.

    Returns dict with keys:
      reason: 'kept' or exclusion reason
      rows: end-of-over chase states (overs 1..19)
      ball_rows: ball-by-ball legal-delivery chase states (balls 1..119) when include_balls=True
      bat: (date, batter_id, runs, balls, dismissed) per innings
      bowl: (date, bowler_id, runs_conceded, legal_balls, wickets) per innings
      first: end-of-over first-innings states (for DLS curve fitting)
    """
    m = json.loads(path.read_text(encoding="utf-8"))
    info = m["info"]
    if "Indian Premier League" not in info.get("event", {}).get("name", ""):
        return {"reason": "not_ipl", "rows": [], "ball_rows": [], "bat": [], "bowl": [], "first": []}

    date = info["dates"][0]
    people = info.get("registry", {}).get("people", {})

    def pid(name: str) -> str:
        return people.get(name, name)

    regular = [i for i in m["innings"] if not i.get("super_over")]

    bat, bowl = [], []
    for inn in regular:
        bagg = defaultdict(lambda: [0, 0, 0])
        wagg = defaultdict(lambda: [0, 0, 0])
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

    def dropped(reason: str) -> dict:
        return {"reason": reason, "rows": [], "ball_rows": [], "bat": bat, "bowl": bowl, "first": []}

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
    chasing_team = inn2["team"]
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
        "season": season,
        "venue": venue,
        "city": info.get("city"),
        "batting_team": norm_team(chasing_team),
        "bowling_team": norm_team(bowling_team),
        "toss_won_by_chaser": int(info.get("toss", {}).get("winner") == chasing_team),
        "target": target,
        "chasing_team_won": won,
    }
    home = {
        "chasing_team_home": is_home(norm_team(chasing_team), venue, season, stage),
        "bowling_team_home": is_home(norm_team(bowling_team), venue, season, stage),
    }

    # First-innings states + impact subs
    impact_used = set()
    first = []
    r1 = w1 = b1 = 0
    states1 = []
    for ov in inn1["overs"]:
        for d in ov["deliveries"]:
            impact_used |= impact_teams(d)
            r1 += d["runs"]["total"]
            w1 += count_wickets(d)
            b1 += int(is_legal(d))
        states1.append((b1, w1, r1))
    total1 = r1
    for b_, w_, r_ in states1:
        if w_ >= 10 or b_ >= BALLS_IN_INNINGS:
            break
        first.append(
            {
                "match_id": path.stem,
                "season": season,
                "balls_left": BALLS_IN_INNINGS - b_,
                "wickets_lost": w_,
                "runs_so_far": r_,
                "runs_remaining": total1 - r_,
                "innings_total": total1,
            }
        )

    overs2 = inn2["overs"]
    # Flatten deliveries with lookahead for next-delivery crease batters
    flat_deliveries: List[Tuple[int, int, dict]] = []
    for k, ov in enumerate(overs2):
        for j, d in enumerate(ov["deliveries"]):
            flat_deliveries.append((k, j, d))

    rows, ball_rows, history = [], [], []
    # Rolling 18-legal-ball window for ball-by-ball momentum
    ball_window: deque = deque(maxlen=18)
    faced = defaultdict(int)
    bat_runs = defaultdict(int)
    bowled = defaultdict(int)
    came_in = set()
    runs = wkts = balls = last_wicket_ball = 0

    flat_idx = 0
    for k, ov in enumerate(overs2):
        ov_runs = ov_wkts = ov_bounds = 0
        pending_extra_runs = 0
        pending_extra_wkts = 0
        pending_extra_bounds = 0

        for j, d in enumerate(ov["deliveries"]):
            d_runs = d["runs"]["total"]
            nw = count_wickets(d)
            legal = is_legal(d)
            bnd = int(is_boundary(d))

            ov_runs += d_runs
            ov_wkts += nw
            ov_bounds += bnd
            runs += d_runs
            wkts += nw
            balls += int(legal)
            if nw:
                last_wicket_ball = balls

            bid = pid(d["batter"])
            came_in.update((bid, pid(d["non_striker"])))
            if faced_ball(d):
                faced[bid] += 1
            bat_runs[bid] += d["runs"]["batter"]
            bowled[pid(d["bowler"])] += int(legal)
            impact_used |= impact_teams(d)

            if legal:
                ball_window.append((d_runs + pending_extra_runs, nw + pending_extra_wkts, bnd + pending_extra_bounds))
                pending_extra_runs = pending_extra_wkts = pending_extra_bounds = 0
            else:
                pending_extra_runs += d_runs
                pending_extra_wkts += nw
                pending_extra_bounds += bnd

            if include_balls and legal:
                needed_b = target - runs
                balls_left_b = BALLS_IN_INNINGS - balls
                if needed_b > 0 and wkts < 10 and balls_left_b > 0:
                    nxt_d = flat_deliveries[flat_idx + 1][2] if flat_idx + 1 < len(flat_deliveries) else None
                    s_name = nxt_d["batter"] if nxt_d else None
                    n_name = nxt_d["non_striker"] if nxt_d else None
                    s_id = pid(s_name) if s_name else None
                    n_id = pid(n_name) if n_name else None
                    at_crease = {x for x in (s_id, n_id) if x}
                    ball_rows.append(
                        {
                            **base,
                            "over": balls / 6.0,
                            "ball_num": balls,
                            "runs_so_far": runs,
                            "wickets_lost": wkts,
                            "balls_left": balls_left_b,
                            "runs_needed": needed_b,
                            "current_run_rate": runs * 6.0 / balls,
                            "required_run_rate": needed_b * 6.0 / balls_left_b,
                            "runs_last_3": sum(x[0] for x in ball_window),
                            "wkts_last_3": sum(x[1] for x in ball_window),
                            "boundaries_last_3": sum(x[2] for x in ball_window),
                            "striker": s_name,
                            "non_striker": n_name,
                            "striker_id": s_id,
                            "non_striker_id": n_id,
                            "striker_balls_faced": faced.get(s_id, 0) if s_id else np.nan,
                            "non_striker_balls_faced": faced.get(n_id, 0) if n_id else np.nan,
                            "striker_runs": bat_runs.get(s_id, 0) if s_id else np.nan,
                            "non_striker_runs": bat_runs.get(n_id, 0) if n_id else np.nan,
                            "chasing_impact_used": int(chasing_team in impact_used),
                            "bowling_impact_used": int(bowling_team in impact_used),
                            "balls_since_last_wicket": balls - last_wicket_ball,
                            **home,
                            "_yet_to_bat": [p for p in chase_xi if p not in came_in and p not in at_crease],
                            "_bowl_xi": bowl_xi,
                            "_bowled": dict(bowled),
                        }
                    )
            flat_idx += 1

        history.append((ov_runs, ov_wkts, ov_bounds))
        needed = target - runs
        balls_left = BALLS_IN_INNINGS - balls
        if needed <= 0 or wkts >= 10 or balls_left <= 0:
            break

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
                "over": len(history),
                "runs_so_far": runs,
                "wickets_lost": wkts,
                "balls_left": balls_left,
                "runs_needed": needed,
                "current_run_rate": runs * 6.0 / balls,
                "required_run_rate": needed * 6.0 / balls_left,
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
                "_yet_to_bat": [p for p in chase_xi if p not in came_in and p not in at_crease],
                "_bowl_xi": bowl_xi,
                "_bowled": dict(bowled),
            }
        )

    return {"reason": "kept", "rows": rows, "ball_rows": ball_rows, "bat": bat, "bowl": bowl, "first": first}


class PastIndex:
    """player id -> cumulative sums by ISO date, for strictly-past lookups."""

    def __init__(self, records, ncols: int):
        by = defaultdict(list)
        for rec in records:
            by[rec[1]].append((rec[0],) + tuple(rec[2:]))
        self.ncols = ncols
        self.idx = {}
        for p, lst in by.items():
            lst.sort()
            self.idx[p] = (
                [x[0] for x in lst],
                np.cumsum(np.array([x[1:] for x in lst], dtype=float), axis=0),
            )
        allrec = sorted((rec[0],) + tuple(rec[2:]) for rec in records)
        self.lg_dates = [x[0] for x in allrec]
        self.lg_cum = (
            np.cumsum(np.array([x[1:] for x in allrec], dtype=float), axis=0)
            if allrec
            else np.zeros((0, ncols), dtype=float)
        )

    def get(self, p, date: str) -> np.ndarray:
        if p is None or p not in self.idx:
            return np.zeros(self.ncols, dtype=float)
        dates, cum = self.idx[p]
        i = bisect_left(dates, date)
        return cum[i - 1] if i else np.zeros(self.ncols, dtype=float)

    def league(self, date: str) -> np.ndarray:
        i = bisect_left(self.lg_dates, date)
        return self.lg_cum[i - 1] if i else np.zeros(self.ncols, dtype=float)


def batting_stats(bat_idx: PastIndex, p, date: str) -> Tuple[float, float, float, float, float]:
    """Return (raw_sr_or_nan, past_balls, shrunk_avg, shrunk_sr, shrunk_bpd)."""
    runs, balls, outs = bat_idx.get(p, date)
    sr = 100.0 * runs / balls if balls else np.nan
    avg = (runs + AVG_PRIOR * AVG_K) / (outs + AVG_K)
    sr_s = (100.0 * runs + SR_PRIOR * SR_K) / (balls + SR_K)
    bpd = (balls + BPD_PRIOR * BPD_K) / (outs + BPD_K)
    return sr, balls, avg, sr_s, bpd


def bowling_features(
    bowl_idx: PastIndex, xi: List[str], bowled: Dict[str, int], balls_left: int, date: str
) -> Tuple[float, float, float]:
    """Expected remaining economy, wicket rate, and top-2 bowlers' overs left."""
    lr, lb, lw = bowl_idx.league(date)
    rpb0 = lr / lb if lb else FALLBACK_RPB
    wpb0 = lw / lb if lb else FALLBACK_WPB
    cands = []
    for p in set(xi) | set(bowled):
        r, b, w = bowl_idx.get(p, date)
        cands.append(
            {
                "past_balls": b,
                "chase_balls": bowled.get(p, 0),
                "rpb": (r + rpb0 * BOWL_K) / (b + BOWL_K),
                "wpb": (w + wpb0 * BOWL_K) / (b + BOWL_K),
            }
        )
    attack = [c for c in cands if c["chase_balls"] > 0 or c["past_balls"] >= MIN_PAST_BOWL_BALLS]
    rest = sorted((c for c in cands if c not in attack), key=lambda c: -c["past_balls"])
    attack += rest[: max(0, MIN_ATTACK - len(attack))]
    for c in attack:
        c["left"] = max(0.0, MAX_OVERS_PER_BOWLER * 6 - c["chase_balls"])
    attack.sort(key=lambda c: c["rpb"])

    need, er, ew = float(balls_left), 0.0, 0.0
    for c in attack:
        use = min(c["left"], need)
        er += use * c["rpb"]
        ew += use * c["wpb"]
        need -= use
        if need <= 0:
            break
    if need > 0:
        er += need * rpb0
        ew += need * wpb0
    best2 = sum(c["left"] for c in attack[:2]) / 6.0
    return 6.0 * er / balls_left, ew / balls_left, best2


def _attach_past_player_features(rows: List[dict], bat_idx: PastIndex, bowl_idx: PastIndex) -> None:
    for r in rows:
        for who in ("striker", "non_striker"):
            p = r[f"{who}_id"]
            sr, nb, _, _, bpd = batting_stats(bat_idx, p, r["date"])
            r[f"{who}_past_sr"] = sr if p else np.nan
            r[f"{who}_past_balls"] = nb if p else np.nan
            r[f"{who}_past_bpd"] = bpd if p else np.nan

        yet = sorted(
            (batting_stats(bat_idx, p, r["date"]) for p in r.pop("_yet_to_bat")),
            key=lambda s: -s[2],
        )[:3]
        r["rem_bat_n"] = len(yet)
        r["rem_bat_quality"] = sum(s[2] for s in yet)
        r["rem_bat_sr"] = float(np.mean([s[3] for s in yet])) if yet else np.nan

        econ, wpb, best2 = bowling_features(
            bowl_idx, r.pop("_bowl_xi"), r.pop("_bowled"), r["balls_left"], r["date"]
        )
        r["bowl_rem_econ"] = econ
        r["bowl_rem_wkt_rate"] = wpb
        r["best_bowler_overs_left"] = best2


def parse_directory(
    json_dir: Path, include_balls: bool = False
) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """Parse all Cricsheet JSON files in json_dir.

    Returns (overs_df, first_innings_df, match_log_df, balls_df).
    """
    files = sorted(Path(json_dir).rglob("*.json"))
    if not files:
        raise FileNotFoundError(f"No .json files found under {Path(json_dir).resolve()}")

    all_rows, all_ball_rows, bat_records, bowl_records, first_rows, log = [], [], [], [], [], []
    for p in files:
        try:
            res = parse_match(p, include_balls=include_balls)
            err = ""
        except (KeyError, ValueError, IndexError, TypeError) as e:
            res = {"reason": "parse_error", "rows": [], "ball_rows": [], "bat": [], "bowl": [], "first": []}
            err = f"{type(e).__name__}: {e}"
        log.append({"match_id": p.stem, "status": res["reason"], "error": err})
        all_rows.extend(res["rows"])
        all_ball_rows.extend(res["ball_rows"])
        bat_records.extend(res["bat"])
        bowl_records.extend(res["bowl"])
        first_rows.extend(res["first"])

    bat_idx = PastIndex(bat_records, 3)
    bowl_idx = PastIndex(bowl_records, 3)
    _attach_past_player_features(all_rows, bat_idx, bowl_idx)
    if include_balls:
        _attach_past_player_features(all_ball_rows, bat_idx, bowl_idx)

    return (
        pd.DataFrame(all_rows),
        pd.DataFrame(first_rows),
        pd.DataFrame(log),
        pd.DataFrame(all_ball_rows) if include_balls else pd.DataFrame(),
    )


def build_serving_player_profiles(
    raw_dir: Path, full_name_map: Dict[str, str], squad_from_season: int = 2025
) -> dict:
    """Build live-predictor player profiles using the EXACT SAME registry_id tracking,
    shrinkage priors (AVG_K=4, BPD_K=4, SR_K=60, BOWL_K=120), dismissal rules, and
    bowler_runs accounting as parse_match() — eliminating training-serving skew."""
    bat_runs: Dict[str, int] = defaultdict(int)
    bat_balls: Dict[str, int] = defaultdict(int)
    bat_outs: Dict[str, int] = defaultdict(int)
    bowl_runs: Dict[str, int] = defaultdict(int)
    bowl_balls: Dict[str, int] = defaultdict(int)
    bowl_wkts: Dict[str, int] = defaultdict(int)

    # Map registry_id -> canonical display full name
    id_to_display: Dict[str, str] = {}
    team_app: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))
    team_bat_pos: Dict[str, Dict[str, List[int]]] = defaultdict(lambda: defaultdict(list))
    team_bowl_app: Dict[str, Dict[str, int]] = defaultdict(lambda: defaultdict(int))

    files = sorted(Path(raw_dir).glob("*.json"))
    total_lg_runs = total_lg_balls = total_lg_wkts = 0

    for fp in files:
        data = json.loads(fp.read_text(encoding="utf-8"))
        info = data.get("info", {})
        event_name = (info.get("event") or {}).get("name", "")
        if "Indian Premier League" not in event_name and info.get("competition") != "IPL":
            continue
        dates = info.get("dates") or []
        if not dates:
            continue
        season = int(str(dates[0])[:4])
        people = (info.get("registry") or {}).get("people") or {}

        def pid(short_name: str) -> str:
            return people.get(short_name, short_name)

        def register(short_name: str) -> str:
            p_id = pid(short_name)
            id_to_display[p_id] = full_name_map.get(short_name, short_name)
            return p_id

        for raw_t, plist in (info.get("players") or {}).items():
            t = norm_team(raw_t)
            for p_short in plist:
                p_id = register(p_short)
                if season >= squad_from_season:
                    team_app[t][p_id] += 1

        for inn in data.get("innings", []):
            if inn.get("super_over"):
                continue
            bt = norm_team(inn.get("team", ""))
            all_teams = [norm_team(rt) for rt in (info.get("teams") or [])]
            bw_team = next((t for t in all_teams if t != bt), "")
            bowlers_in_inn = set()
            seen_batters: List[str] = []

            for ov in inn.get("overs", []):
                for d in ov.get("deliveries", []):
                    b_id = register(d["batter"])
                    ns_id = register(d["non_striker"])
                    bw_id = register(d["bowler"])
                    if b_id not in seen_batters:
                        seen_batters.append(b_id)
                    if ns_id not in seen_batters:
                        seen_batters.append(ns_id)
                    bowlers_in_inn.add(bw_id)

                    if faced_ball(d):
                        bat_balls[b_id] += 1
                    bat_runs[b_id] += d["runs"]["batter"]

                    b_legal = int(is_legal(d))
                    b_r = bowler_runs(d)
                    b_w = bowler_wickets(d)
                    bowl_balls[bw_id] += b_legal
                    bowl_runs[bw_id] += b_r
                    bowl_wkts[bw_id] += b_w
                    total_lg_balls += b_legal
                    total_lg_runs += b_r
                    total_lg_wkts += b_w

                    for w in d.get("wickets") or []:
                        if w.get("kind") not in NOT_OUT_KINDS:
                            out_id = register(w["player_out"])
                            bat_outs[out_id] += 1

            if season >= squad_from_season:
                for pos_idx, b_id in enumerate(seen_batters):
                    team_bat_pos[bt][b_id].append(pos_idx + 1)
                if bw_team:
                    for bw_id in bowlers_in_inn:
                        team_bowl_app[bw_team][bw_id] += 1

    rpb0 = total_lg_runs / total_lg_balls if total_lg_balls else FALLBACK_RPB
    wpb0 = total_lg_wkts / total_lg_balls if total_lg_balls else FALLBACK_WPB

    # Disambiguate rare duplicate display names across distinct registry_ids
    name_counts: Dict[str, int] = defaultdict(int)
    for disp in id_to_display.values():
        name_counts[disp] += 1

    id_to_label: Dict[str, str] = {}
    for p_id, disp in id_to_display.items():
        if name_counts[disp] > 1:
            id_to_label[p_id] = f"{disp} ({p_id[:4]})"
        else:
            id_to_label[p_id] = disp

    all_ids = sorted(
        set(bat_balls.keys()) | set(bowl_balls.keys()) | {p for td in team_app.values() for p in td.keys()},
        key=lambda x: id_to_label.get(x, x),
    )

    batters_sr, batters_bpd, batters_avg = {}, {}, {}
    bowlers_econ, bowlers_wkt, bowlers_balls_map = {}, {}, {}

    for p_id in all_ids:
        lbl = id_to_label[p_id]
        bb, br, bo = bat_balls[p_id], bat_runs[p_id], bat_outs[p_id]
        # Identical shrinkage equations to batting_stats()
        sr = (100.0 * br + SR_PRIOR * SR_K) / (bb + SR_K)
        bpd = (bb + BPD_PRIOR * BPD_K) / (bo + BPD_K)
        avg = (br + AVG_PRIOR * AVG_K) / (bo + AVG_K)
        batters_sr[lbl] = round(float(sr), 2)
        batters_bpd[lbl] = round(float(bpd), 2)
        batters_avg[lbl] = round(float(avg), 2)

        wb, wr, ww = bowl_balls[p_id], bowl_runs[p_id], bowl_wkts[p_id]
        # Identical shrinkage equations to bowling_features()
        econ = ((wr + rpb0 * BOWL_K) / (wb + BOWL_K)) * 6.0
        wkt_r = (ww + wpb0 * BOWL_K) / (wb + BOWL_K)
        bowlers_econ[lbl] = round(float(econ), 2)
        bowlers_wkt[lbl] = round(float(wkt_r), 5)
        bowlers_balls_map[lbl] = int(wb)

    team_squads, rosters, bowl_rosters = {}, {}, {}
    for t, app_dict in sorted(team_app.items()):
        def _mean_pos(p_id: str) -> float:
            pos_list = team_bat_pos[t][p_id]
            return sum(pos_list) / len(pos_list) if pos_list else 10.5

        squad_ids = sorted(app_dict.keys(), key=lambda p_id: (-app_dict[p_id], _mean_pos(p_id), id_to_label[p_id]))
        team_squads[t] = [id_to_label[p_id] for p_id in squad_ids]

        top12_bat_ids = sorted(squad_ids[:12], key=lambda p_id: (_mean_pos(p_id), -app_dict[p_id]))
        rosters[t] = [id_to_label[p_id] for p_id in top12_bat_ids]

        top12_bowl_ids = sorted(
            squad_ids[:12],
            key=lambda p_id: (-team_bowl_app[t].get(p_id, 0), bowlers_econ.get(id_to_label[p_id], 9.5), id_to_label[p_id]),
        )
        bowl_rosters[t] = [id_to_label[p_id] for p_id in top12_bowl_ids]

    return {
        "batters": batters_sr,
        "batters_bpd": batters_bpd,
        "batters_avg": batters_avg,
        "bowlers_econ": bowlers_econ,
        "bowlers_wkt": bowlers_wkt,
        "bowlers_balls": bowlers_balls_map,
        "league_prior_econ": round(float(rpb0 * 6.0), 3),
        "league_prior_wkt": round(float(wpb0), 5),
        "team_squads": team_squads,
        "rosters": rosters,
        "bowl_rosters": bowl_rosters,
    }
