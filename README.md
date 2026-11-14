# IPL chase win probability

Predicts the probability that the chasing team wins an IPL match, given the state of the chase at the end of each completed over. Built for ES 335 (Machine Learning).

> **Live site:** [https://tashakaggarwal.github.io/es335-2026/](https://tashakaggarwal.github.io/es335-2026/)

## 1. Problem

- **Row:** the state of one second-innings chase at the end of one completed over (overs 1 to 19).
- **Target:** `chasing_team_won` (1 if the chasing team won the match, 0 otherwise).
- **Output:** a calibrated probability, not just a win/lose label.
- **Primary metric:** log loss. Secondary: Brier score, calibration curves, accuracy by over.
- **Why this is not trivial:** a baseline rule ("win if current run rate is at least the required rate") is already strong, so the question is how much a learned model adds, and whether it holds up as scoring levels rise.

## 2. Data

- Source: [Cricsheet](https://cricsheet.org/) ball-by-ball JSON for the IPL (1,243 raw match files parsed).
- Kept: **1,185** completed IPL matches with a full regular second innings (**21,251** over-by-over chase states, plus **22,438** first-innings states used to fit the empirical DLS resource curve on training seasons).
- Excluded (and logged in `data/parsed/match_log.csv` with a reason): DLS-affected matches, ties and no-results, missing second innings, reduced-overs matches, non-IPL files.
- Conventions: wides and no-balls are not legal balls; retired hurt is not a wicket; season is the calendar year of the match.

| Split | Seasons | Matches | Over States | Use |
|---|---|---:|---:|---|
| Train | 2008–2023 | 978 | 17,578 | Fitting, empirical DLS curve estimation, and 5-fold cross-validated tuning |
| Validation | 2024 | 69 | 1,239 | Comparing candidates and selecting the final model + feature set |
| Test | 2025–2026 | 138 | 2,434 | Evaluated **once**, in notebook 04 |

The split is by **season** (never by row), and every match stays wholly in one split. Splitting by row would put overs of the same match on both sides and inflate scores.

## 3. Repository layout

```
scripts/
  parse_cricsheet.py            raw JSON -> data/parsed/overs.csv, first_innings_states.csv, match_log.csv
  data_split.py                 splits features_all.csv into data/split/{train,validation,test}.csv
notebooks/
  01_eda.ipynb                  exploratory analysis (train + validation only)
  02_features.ipynb             builds features_all.csv and dls_params.json from parsed CSVs
  03_baselines_and_models.ipynb baselines, models, recency-weighted tuning, model selection
  04_final_test.ipynb           refit on train + validation, evaluate once on test
  05_export_site_data.ipynb     exports site/data/site_data.json (including 39-feature live model)
data/
  raw/                          Cricsheet JSON (not committed; download it)
  parsed/                       overs.csv, first_innings_states.csv, match_log.csv
  features/                     features_all.csv, feature_groups.json, feature_dictionary.csv, dls_params.json
  split/                        train.csv, validation.csv, test.csv
results/                        validation_table.csv, feature_ladder.csv, model_selection.json, figures
results/final/                  test_table.csv, test_results.json, test_predictions.csv, test_permutation_importance.csv
index.html                      GitHub Pages entry point (Match Explorer, Live Predictor, Scenario Simulator)
site/                           static website assets (app.js, style.css, data/site_data.json)
```

## 4. How to reproduce

Requires Python 3.10+ and: `pandas numpy scikit-learn scipy matplotlib pillow jupyter nbformat openpyxl`.

1. Download the IPL JSON zip from Cricsheet and unzip it into `data/raw/`.
2. Parse:
   ```
   python scripts/parse_cricsheet.py data/raw --out data/parsed/overs.csv
   ```
   Check `data/parsed/match_log.csv` and edit `TEAM_MAP` / `HOME_GROUNDS` in the script if team or ground names are missing.
3. Run `notebooks/02_features.ipynb` (paths in the first cell are relative to `notebooks/`). It reads the full file, fits the DLS resource curve strictly on training seasons (`season < 2024`), and runs a 60-match brute-force temporal leakage check.
4. Make the season split into `data/split/` (train 2008–2023, validation 2024, test 2025–2026):
   ```
   python scripts/data_split.py
   ```
5. Run `notebooks/01_eda.ipynb` on train and validation, then `notebooks/03_baselines_and_models.ipynb`. Each notebook starts with a settings cell holding every path. Use Restart & Run All.
6. Run `notebooks/04_final_test.ipynb` **last and once**. It refuses to run a second time unless `ALLOW_RERUN = True`.
7. Run `notebooks/05_export_site_data.ipynb` to regenerate `site/data/site_data.json`.

Randomness is controlled by `RANDOM_STATE = 0`. Package versions used: `python==3.13, pandas==3.0.5, numpy==2.5.3, scikit-learn==1.9.0, scipy==1.18.1, pillow==12.3.0`.

## 5. Features

Defined in `data/features/feature_dictionary.csv` and grouped into 10 groups (39 model features total) in `data/features/feature_groups.json`:

| Group | Count | Features |
|---|---:|---|
| `core` | 6 | `runs_so_far`, `target_vs_venue_par`, `wickets_lost`, `balls_left`, `current_run_rate`, `required_run_rate` (capped at 36) |
| `derived` | 5 | `run_rate_diff`, `runs_needed_frac`, `dls_resources`, `par_score_diff`, `runs_needed_per_wicket` |
| `phase` | 3 | `is_powerplay` (overs 1–6), `is_death` (overs 15–19), `powerplay_balls_left` |
| `momentum` | 5 | `runs_last_3`, `wkts_last_3`, `boundaries_last_3`, `acceleration`, `balls_since_last_wicket` |
| `batters` | 7 | `bat_sr_mean`, `bat_bpd_mean`, `bat_balls_max`, `bat_runs_sum`, `settled_sr_interaction`, `rem_bat_quality`, `rem_bat_sr` |
| `bowling` | 3 | `bowl_rem_econ`, `bowl_rem_wkt_rate`, `best_bowler_overs_left` |
| `impact` | 2 | `chasing_impact_used`, `bowling_impact_used` |
| `history` | 3 | `target_vs_season_avg`, `target_vs_recent_par` (30-match rolling league par), `venue_chase_rate` |
| `home` | 3 | `chasing_team_home`, `bowling_team_home`, `home_edge` |
| `form` | 2 | `chaser_form`, `bowler_form` (shrunk last-5-match win rate in the current season) |

**Simplification & Era-Drift Resilience:**
- Raw `target` is replaced in `core` by `target_vs_venue_par` (target minus past-only venue average target shrunk toward the 30-match rolling league par) because first-innings totals rose from an average of 167 (2008–2024) to 195 (2025–2026). This reduced out-of-range test rows to **0.8%**.
- Collinear linear `resources` (`balls_left * wickets_in_hand`) is replaced in `derived` by an empirical exponential DLS resource curve $R(\text{balls left}, \text{wickets lost})$ fitted strictly on training first innings (`season < 2024`) and `par_score_diff` (`runs_so_far - target * (1 - dls_resources / 100)`).

## 6. Methods

- **Baselines:** (A) constant training win rate; (A2) win rate by over; (B) the run-rate rule (`current_run_rate >= required_run_rate`), mapped to probabilities with two training win rates (`P(win | ahead) = 0.850`, `P(win | behind) = 0.365`).
- **Models:** L2 logistic regression; histogram gradient boosting (both unconstrained and with monotonic constraints so win probability cannot rise with `wickets_lost`, `required_run_rate`, `run_rate_diff`, `runs_needed_frac`, or `runs_needed_per_wicket`); and a small MLP neural network.
- **Recency Weighting:** Exponential season decay weights $w = \exp(-0.08 \cdot (\text{max season} - \text{season}))$ are passed via `sample_weight` during model fitting so modern high-scoring IPL seasons carry higher weight than early seasons.
- **Tuning:** Grid search with 5-fold `GroupKFold` (`groups = match_id`), scored by log loss.
- **Calibration:** Platt and isotonic recalibration tested, fitted on out-of-fold training predictions only.
- **Model selection (rule fixed in advance):** The simplest `(model, feature_set)` candidate whose validation log loss is within `0.003` of the best. On the 2024 validation set, `C +phase+momentum` achieved `0.3690` and `B +derived` achieved `0.3697` (within `0.0007`), so the selection rule chose **L2 Logistic Regression (`C = 0.3162`) on `B +derived` (11 features)** (`results/model_selection.json`).
- **Uncertainty:** 95% confidence intervals come from bootstrapping whole matches (`N_BOOT = 2000`), including paired differences against baseline B.

## 7. Leakage controls

- Season-based split; whole matches stay together.
- Past-only history features (batter strike rates, balls per dismissal, batting averages, bowler economies/wicket rates, season/rolling/venue par targets, venue chase rate, home record, team form) use only matches **strictly before** the match date, and same-day matches are excluded. This was verified against a brute-force recomputation on 60 sampled matches with **0 disagreements**.
- The Empirical DLS exponential curve parameters (`data/features/dls_params.json`) are fitted strictly on training-season (`season < 2024`) first innings.
- The batters at the crease are read from the first delivery of the next over, which shows who is there, never what happens.
- Imputation and scaling are fitted on training rows only, inside scikit-learn pipelines (refitted in every CV fold).
- Gradient boosting runs with `early_stopping=False`, because its built-in early stopping splits by row.
- Notebooks 01 and 03 refuse to load any test season. Notebook 04 is the only place the test file is read, and it locks after one run.

## 8. Results

### Validation Set (2024 Season — 69 Matches, 1,239 Over States)
From `results/validation_table.csv` and `results/feature_ladder.csv`:

| Model | Validation Log Loss | Validation Brier | Validation Accuracy | Diff vs Rule B (95% CI) |
|---|---:|---:|---:|---|
| A: Constant (train win rate) | 0.6958 | 0.2513 | 48.75% | +0.1440 `[+0.0868, +0.2005]` |
| A2: Win rate by over | 0.6923 | 0.2496 | 50.77% | +0.1405 `[+0.0841, +0.1965]` |
| B: Run-rate rule (`CRR >= RRR`) | 0.5522 | 0.1838 | 75.95% | — |
| HGB: Gradient-boosted trees | 0.3899 | 0.1253 | 81.60% | -0.1614 `[-0.2540, -0.0529]` |
| HGBm: Gradient-boosted (monotonic) | 0.3901 | 0.1253 | 81.68% | -0.1612 `[-0.2550, -0.0513]` |
| MLP: Small neural network | 0.3856 | 0.1218 | 82.41% | -0.1655 `[-0.2689, -0.0387]` |
| **LR: Logistic regression (`C +phase+momentum`, 19 feats)** | **0.3690** | **0.1174** | 82.49% | **-0.1825 `[-0.2672, -0.0874]`** |
| **Selected Final (`LR` on `B +derived`, 11 feats)** | **0.3697** | **0.1176** | **82.89%** | *(within 0.003 rule threshold)* |

### Held-Out Test Set (2025–2026 Seasons — 138 Matches, 2,434 Over States)
From `results/final/test_table.csv`:

| Model | Test Log Loss | Test 95% CI | Test Brier | Test Accuracy | Test vs Rule B (95% CI) |
|---|---:|---|---:|---:|---|
| A: Constant (train+val win rate) | 0.6882 | `[0.6805, 0.6962]` | 0.2475 | 56.41% | +0.1488 `[+0.0953, +0.2016]` |
| A2: Win rate by over | 0.6853 | `[0.6769, 0.6937]` | 0.2461 | 56.74% | +0.1459 `[+0.0925, +0.1984]` |
| B: Run-rate rule (`CRR >= RRR`) | 0.5396 | `[0.4842, 0.5964]` | 0.1792 | 75.31% | — |
| **FINAL: Logistic regression (`B +derived`)** | **0.3815** | **`[0.3200, 0.4499]`** | **0.1219** | **82.05%** | **-0.1576 `[-0.2126, -0.0985]`** |
| *(Ref) Same model, fit on train only* | *0.3884* | *`[0.3267, 0.4572]`* | *0.1248* | *81.68%* | *-0.1506 `[-0.2071, -0.0904]`* |

- **Test Calibration:** Calibration slope is **1.19** (`1.00` = ideal) and intercept is **0.61** (`0.00` = ideal). The model beat the simple run-rate rule in **104 of 138** test matches (`P(better than B) = 1.0`).
- **Top Permutation Importances on Test (`results/final/test_permutation_importance.csv`):** `balls_left` (`+0.1811` log loss when permuted), `runs_needed_per_wicket` (`+0.1265`), `required_run_rate` (`+0.0718`), `run_rate_diff` (`+0.0469`), `target_vs_venue_par` (`+0.0409`), `wickets_lost` (`+0.0372`), and `runs_so_far` (`+0.0370`).

Figures: `results/calibration_and_by_over.png`, `results/feature_ladder.png`, `results/final/test_calibration_and_by_over.png`, `results/final/test_match_trajectories.png`, `results/final/test_permutation_importance.png`.

## 9. Limitations

- Few matches: about 70 per season, so the intervals are wide. Differences between close models are mostly noise.
- Rows in one match are correlated; the match-level bootstrap accounts for this, but effective sample size is the number of matches, not rows.
- No information on the pitch, dew, weather, or who bowls the next over.
- Distribution shift: scoring levels rose over time, so the test seasons contain states the training data barely covers.
- Excluded matches (DLS, ties, no-results) mean the model is not meant for those situations.
- Home grounds and venue names are mapped by hand and may miss edge cases (neutral venues, relocated matches).
- Test set is small and was used once; the reported test number is a single estimate.

## 10. Honesty notes

- Test seasons were evaluated once, after the model was frozen in notebook 03.

## 11. Data licence and credits

Ball-by-ball data from [Cricsheet](https://cricsheet.org/)
