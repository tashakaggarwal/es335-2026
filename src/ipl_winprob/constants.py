"""Single source of truth for cricket domain rules, entity maps, shrinkage priors, and feature definitions."""

TEAM_MAP = {
    "Delhi Daredevils": "Delhi Capitals",
    "Kings XI Punjab": "Punjab Kings",
    "Royal Challengers Bangalore": "Royal Challengers Bengaluru",
    "Rising Pune Supergiants": "Rising Pune Supergiant",
}

HOME_GROUNDS = {
    "Chennai Super Kings": ["chidambaram"],
    "Mumbai Indians": ["wankhede"],
    "Kolkata Knight Riders": ["eden gardens"],
    "Royal Challengers Bengaluru": ["chinnaswamy"],
    "Delhi Capitals": ["arun jaitley", "feroz shah kotla", "rajasekhara reddy"],
    "Punjab Kings": [
        "punjab cricket association",
        "bindra",
        "himachal pradesh",
        "maharaja yadavindra singh",
    ],
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

VENUE_RULES = [
    ("chinnaswamy", "M Chinnaswamy Stadium, Bengaluru"),
    ("chidambaram", "MA Chidambaram Stadium, Chennai"),
    ("wankhede", "Wankhede Stadium, Mumbai"),
    ("brabourne", "Brabourne Stadium, Mumbai"),
    ("dy patil", "DY Patil Stadium, Navi Mumbai"),
    ("eden gardens", "Eden Gardens, Kolkata"),
    ("arun jaitley", "Arun Jaitley Stadium, Delhi"),
    ("feroz shah", "Arun Jaitley Stadium, Delhi"),
    ("narendra modi", "Narendra Modi Stadium, Ahmedabad"),
    ("sardar patel", "Narendra Modi Stadium, Ahmedabad"),
    ("motera", "Narendra Modi Stadium, Ahmedabad"),
    ("rajiv gandhi", "Rajiv Gandhi Stadium, Hyderabad"),
    ("sawai mansingh", "Sawai Mansingh Stadium, Jaipur"),
    ("punjab cricket association", "PCA Stadium, Mohali"),
    ("bindra", "PCA Stadium, Mohali"),
    ("maharaja yadavindra", "Mullanpur Stadium"),
    ("himachal pradesh", "HPCA Stadium, Dharamsala"),
    ("maharashtra cricket association", "MCA Stadium, Pune"),
    ("subrata roy", "MCA Stadium, Pune"),
    ("rajasekhara reddy", "ACA-VDCA Stadium, Visakhapatnam"),
    ("zayed", "Sheikh Zayed Stadium, Abu Dhabi"),
    ("sharjah", "Sharjah Cricket Stadium"),
    ("dubai international", "Dubai International Stadium"),
    ("ekana", "Ekana Stadium, Lucknow"),
    ("barsapara", "Barsapara Stadium, Guwahati"),
    ("saurashtra cricket association", "SCA Stadium, Rajkot"),
    ("green park", "Green Park, Kanpur"),
    ("holkar", "Holkar Stadium, Indore"),
    ("jsca", "JSCA Stadium, Ranchi"),
    ("vidarbha", "VCA Stadium, Nagpur"),
    ("shaheed veer narayan", "SVNS Stadium, Raipur"),
    ("barabati", "Barabati Stadium, Cuttack"),
    ("nehru stadium", "Nehru Stadium"),
]

NO_HOME_SEASONS = {2020, 2021}
BALLS_IN_INNINGS = 120
MAX_OVERS_PER_BOWLER = 4
RRR_CAP = 36.0

# Empirical Bayes shrinkage priors (shared identically by training parser and live serving)
AVG_PRIOR, AVG_K = 20.0, 4.0
SR_PRIOR, SR_K = 125.0, 60.0
BPD_PRIOR, BPD_K = 18.0, 4.0
BOWL_K = 120.0
MIN_PAST_BOWL_BALLS = 60
MIN_ATTACK = 5
FALLBACK_RPB = 8.0 / 6.0
FALLBACK_WPB = 1.0 / 20.0

K_SEASON = 5.0
RECENT_PAR_N, K_RECENT_PAR = 30, 5.0
K_VENUE_PAR = 8.0
K_VENUE = 10.0
K_HOME = 10.0
FORM_N, K_FORM = 5, 2.0

# Dismissal rules
NOT_OUT_KINDS = ("retired hurt", "retired not out")
NOT_BOWLER_KINDS = (
    "run out",
    "retired hurt",
    "retired not out",
    "retired out",
    "obstructing the field",
    "handled the ball",
    "timed out",
)

FEATURE_GROUPS = {
    "core": [
        "runs_so_far",
        "target_vs_venue_par",
        "wickets_lost",
        "balls_left",
        "current_run_rate",
        "required_run_rate",
    ],
    "derived": [
        "run_rate_diff",
        "runs_needed_frac",
        "dls_resources",
        "par_score_diff",
        "runs_needed_per_wicket",
    ],
    "phase": [
        "is_powerplay",
        "is_death",
        "powerplay_balls_left",
    ],
    "momentum": [
        "runs_last_3",
        "wkts_last_3",
        "boundaries_last_3",
        "acceleration",
        "balls_since_last_wicket",
    ],
    "batters": [
        "bat_sr_mean",
        "bat_bpd_mean",
        "bat_balls_max",
        "bat_runs_sum",
        "settled_sr_interaction",
        "rem_bat_quality",
        "rem_bat_sr",
    ],
    "bowling": [
        "bowl_rem_econ",
        "bowl_rem_wkt_rate",
        "best_bowler_overs_left",
    ],
    "impact": [
        "chasing_impact_used",
        "bowling_impact_used",
    ],
    "history": [
        "target_vs_season_avg",
        "target_vs_recent_par",
        "venue_chase_rate",
    ],
    "home": [
        "chasing_team_home",
        "bowling_team_home",
        "home_edge",
    ],
    "form": [
        "chaser_form",
        "bowler_form",
    ],
}

ALL_FEATURES = [f for fs in FEATURE_GROUPS.values() for f in fs]

FEATURE_DEFINITIONS = {
    "runs_so_far": "Current score of the chase",
    "target_vs_venue_par": "Target minus the past-only venue average target shrunk towards recent league par",
    "wickets_lost": "Wickets down",
    "balls_left": "Legal balls remaining (wides and no-balls do not count)",
    "current_run_rate": "Runs per over so far",
    "required_run_rate": "Runs needed per over for the rest of the chase, capped at 36",
    "run_rate_diff": "Required minus current run rate",
    "runs_needed_frac": "Runs needed / target",
    "dls_resources": "Empirical DLS resource percentage remaining (0-100), fitted on training 1st innings",
    "par_score_diff": "Runs so far minus the empirical DLS par score for current balls left and wickets lost",
    "runs_needed_per_wicket": "Runs needed / wickets in hand",
    "is_powerplay": "1 during powerplay overs (overs 1-6), 0 otherwise",
    "is_death": "1 during death overs (overs 15-19), 0 otherwise",
    "powerplay_balls_left": "Legal powerplay balls remaining in the innings (0 after over 6)",
    "runs_last_3": "Runs scored in the last 3 overs (or 18 legal balls)",
    "wkts_last_3": "Wickets lost in the last 3 overs (or 18 legal balls)",
    "boundaries_last_3": "Fours and sixes off the bat in the last 3 overs (or 18 legal balls)",
    "acceleration": "Run rate over the last 3 overs minus the overall current run rate",
    "balls_since_last_wicket": "Legal balls since the last wicket (current partnership)",
    "bat_sr_mean": "Mean past IPL strike rate of the two batters at the crease, shrunk towards 125",
    "bat_bpd_mean": "Mean past IPL balls-per-dismissal of the two batters at the crease, shrunk towards 18",
    "bat_balls_max": "Balls faced this innings by the more settled of the two batters",
    "bat_runs_sum": "Combined runs scored this innings by the two batters currently at the crease",
    "settled_sr_interaction": "Interaction of set batter balls faced and crease strike rate (bat_balls_max * bat_sr_mean / 100)",
    "rem_bat_quality": "Sum of top-3 shrunk past batting averages among un-batted players in the chasing squad",
    "rem_bat_sr": "Mean shrunk past strike rate of the top-3 un-batted players in the chasing squad",
    "bowl_rem_econ": "Expected economy rate of remaining overs using best available bowlers within 4-over quotas",
    "bowl_rem_wkt_rate": "Expected wickets per ball of remaining overs using best available bowlers within 4-over quotas",
    "best_bowler_overs_left": "Combined overs remaining (0-8) for the defending side's two best bowlers",
    "chasing_impact_used": "1 if the chasing team has made its Impact Player substitution",
    "bowling_impact_used": "1 if the bowling team has made its Impact Player substitution",
    "target_vs_season_avg": "Target minus the average target of this season's earlier matches (past only)",
    "target_vs_recent_par": "Target minus the rolling 30-match IPL average target before this date (past only)",
    "venue_chase_rate": "Past chase win rate at the ground, shrunk towards the league rate (past only)",
    "chasing_team_home": "1 if the chasing team is playing at one of its home grounds",
    "bowling_team_home": "1 if the bowling team is playing at one of its home grounds",
    "home_edge": "Home side's past home record minus league home win rate; positive favours chaser; 0 if neutral",
    "chaser_form": "Chasing team's win rate in its last 5 matches this season (past only, shrunk to 0.5)",
    "bowler_form": "Bowling team's win rate in its last 5 matches this season (past only, shrunk to 0.5)",
}

MONOTONIC_CONSTRAINTS = {
    "wickets_lost": -1,
    "required_run_rate": -1,
    "run_rate_diff": -1,
    "runs_needed_frac": -1,
    "runs_needed_per_wicket": -1,
    "dls_resources": 1,
    "par_score_diff": 1,
}


def norm_team(team: str) -> str:
    return TEAM_MAP.get(team, team)


def clean_venue(raw: str) -> str:
    low = str(raw).lower()
    for frag, name in VENUE_RULES:
        if frag in low:
            return name
    return str(raw).split(",")[0].strip()
