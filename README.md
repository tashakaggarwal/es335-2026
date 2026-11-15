# IPL Chase Win Probability

Predicts the calibrated probability that the chasing team wins an Indian Premier League (IPL) match, given the state of the chase at the end of each completed over. Built for **ES 335 (Machine Learning)**.

> **Live Website:** [https://tashakaggarwal.github.io/es335-2026/](https://tashakaggarwal.github.io/es335-2026/)  
> **Repository:** [https://github.com/tashakaggarwal/es335-2026](https://github.com/tashakaggarwal/es335-2026)

---

## 1. Problem Formulation & Question

- **Research Question:** Given the state of a second-innings IPL run chase at the end of each completed over, how much probabilistic accuracy (measured by log loss and calibration) does a learned machine learning model add over the textbook broadcast rule (*"win if current run rate is at least the required run rate"*), and does it remain calibrated despite the 2024–2026 scoring surge?
- **What One Row Represents:** The exact snapshot of one regular second-innings chase at the end of one completed over $o \in \{1, \dots, 19\}$ (before the 20th over starts or the match finishes earlier).
- **Target Variable:** `chasing_team_won` $\in \{0, 1\}$ (`1` if the chasing team eventually won the match, `0` otherwise).
- **Output:** A calibrated probability $\hat{p} \in (0, 1)$, not just a binary win/lose label.
- **Primary Evaluation Metric:** **Log loss** (cross-entropy), with probabilities clipped to $[10^{-6}, 1 - 10^{-6}]$. **Secondary metrics:** Brier score, calibration slope/intercept & reliability curves, and accuracy by over. All 95% confidence intervals and paired model comparisons resample **whole matches** (`N_BOOT = 2000`) to account for within-match correlation.

---

## 2. Data Source, Size, Quality Issues & Splits

- **Source & Data Access:** [Cricsheet](https://cricsheet.org/) ball-by-ball JSON archive for the Indian Premier League (`https://cricsheet.org/downloads/ipl_json.zip`, licensed under CC BY 4.0). All **1,243** raw match JSON files (seasons 2008–2026) are included directly in `data/raw/` for immediate reproduction.
- **Kept Volume:** **1,185** completed regular IPL matches (**21,251** second-innings over-by-over chase states, plus **22,438** first-innings over states used strictly on training seasons to fit the empirical Duckworth–Lewis–Stern resource curve).
- **Excluded Matches (58 files total, logged with reasons in `data/parsed/match_log.csv`):**
  - `tie_or_no_result` (**25** matches): Super-over ties and abandoned/no-result games.
  - `dls_applied` (**23** matches): Rain-interrupted chases where targets or overs were revised mid-match via DLS.
  - `reduced_overs` (**10** matches): Pre-match shortened innings (< 20 overs per side).
- **Data Quality Issues Resolved:**
  1. **Scoring Era Drift:** Average first-innings targets rose from **165.8** (2008–2023) to **191.1** (2024) and **195.4** (2025–2026). Raw targets cause severe covariate shift, which we solved by normalizing targets against past-only venue and rolling league par (`target_vs_venue_par`).
  2. **Entity & Stadium Standardization:** 60 raw stadium strings in Cricsheet were canonicalized into **36 grounds** (`venue_clean`), and historical franchise renamings (*Delhi Daredevils* $\rightarrow$ *Delhi Capitals*, *Kings XI Punjab* $\rightarrow$ *Punjab Kings*, *Royal Challengers Bangalore* $\rightarrow$ *Royal Challengers Bengaluru*, *Rising Pune Supergiant(s)*, etc.) were unified in `scripts/parse_cricsheet.py`.
  3. **Delivery & Dismissal Accounting:** Wides and no-balls add runs without consuming a legal ball; `retired hurt` is not counted as a wicket; incoming batters at the end of an over are read strictly from the first delivery of the next over (which identifies who is at the crease without leaking future outcomes).

### Chronological Split by Season

| Split | Seasons | Matches | Over States | Mean Target | Chase Win % | Role in Pipeline |
|---|---|---:|---:|---:|---:|---|
| **Train** | 2008–2023 | 977 | 17,578 | 165.8 | 54.2% | Fit empirical DLS curve, 5-fold `GroupKFold` tuning, out-of-fold calibration |
| **Validation** | 2024 | 70 | 1,239 | 191.1 | 51.4% | Compare model families & 7-step feature ladder; apply 0.003 selection rule |
| **Held-Out Test** | 2025–2026 | 138 | 2,434 | 195.4 | 56.5% | Evaluated **once** in `04_final_test.ipynb` after refitting on 2008–2024 |

The split is strictly by **calendar season** (never by row), and every match stays wholly in one split. Splitting randomly by row would place adjacent overs of the same chase in both train and test sets and severely inflate performance.

---

## 3. Repository Layout

```text
scripts/
  parse_cricsheet.py            raw JSON -> data/parsed/overs.csv, first_innings_states.csv, match_log.csv
  data_split.py                 splits features_all.csv into data/split/{train,validation,test}.csv
  player_names.py               extracts full player names, squads, and past-only career profiles
notebooks/
  01_eda.ipynb                  exploratory analysis & data quality checks (train + validation only)
  02_features.ipynb             builds features_all.csv & dls_params.json + 60-match brute-force leakage audit
  03_baselines_and_models.ipynb baselines, models, recency-weighted CV tuning, recalibration & feature ladder
  04_final_test.ipynb           refit on train + validation, evaluate once on test, error & shift analysis
  05_export_site_data.ipynb     exports site/data/site_data.json (11-feature final + 39-feature live model)
data/
  raw/                          1,243 Cricsheet IPL JSON files + LICENSE.txt
  parsed/                       overs.csv, first_innings_states.csv, match_log.csv, player_profiles.json
  features/                     features_all.csv, feature_groups.json, feature_dictionary.csv, dls_params.json
  split/                        train.csv, validation.csv, test.csv
results/                        validation_table.csv, feature_ladder.csv, model_selection.json, val_predictions.csv, figures
results/final/                  test_table.csv, test_results.json, test_predictions.csv, test_match_errors.csv,
                                test_by_season.csv, test_permutation_importance.csv, figures
index.html                      GitHub Pages entry point (Reasoning, Interactive Explorers, Results & Error Analysis)
site/                           static website assets (app.js, style.css, data/site_data.json)
requirements.txt                Python package dependencies
```

---

## 4. Setup & How to Reproduce

### Environment Setup

Requires **Python 3.10+** (developed and verified on Python 3.13 / 3.14). Install dependencies via:

```bash
pip install -r requirements.txt
```

### Step-by-Step Reproduction

1. **Raw Data Access:** The 1,243 Cricsheet IPL JSON files are already present in `data/raw/`. (To download a fresh copy from Cricsheet, grab [ipl_json.zip](https://cricsheet.org/downloads/ipl_json.zip) and unzip into `data/raw/`.)
2. **Parse Ball-by-Ball JSONs into Over States:**
   ```bash
   python scripts/parse_cricsheet.py data/raw --out data/parsed/overs.csv
   ```
   This writes `data/parsed/overs.csv` (21,251 rows), `data/parsed/first_innings_states.csv` (22,438 rows), and `data/parsed/match_log.csv` (1,243 rows).
3. **Build Features & Verify Zero Temporal Leakage:**
   Run `notebooks/02_features.ipynb` (or execute via `jupyter nbconvert --to notebook --execute notebooks/02_features.ipynb`). It fits the empirical DLS exponential curve strictly on training seasons (`season < 2024`), computes all 39 features, and runs a 60-match brute-force temporal leakage verification (`0 disagreements`).
4. **Create the Chronological Season Splits:**
   ```bash
   python scripts/data_split.py
   ```
   Writes `data/split/train.csv` (2008–2023), `data/split/validation.csv` (2024), and `data/split/test.csv` (2025–2026).
5. **Run EDA & Model Selection:**
   Run `notebooks/01_eda.ipynb` and `notebooks/03_baselines_and_models.ipynb` (Restart & Run All). Notebook 03 tunes all models, runs the feature-group ladder, writes `results/validation_table.csv`, `results/feature_ladder.csv`, and freezes `results/model_selection.json`.
6. **Run Final Held-Out Test Evaluation:**
   Run `notebooks/04_final_test.ipynb` **last and once**. It writes a lock file (`results/final/test_results.json`) and refuses to run a second time unless `ALLOW_RERUN = True`.
7. **Export Website Data & Preview Locally:**
   Run `notebooks/05_export_site_data.ipynb` to regenerate `site/data/site_data.json`, then serve the static site from the repository root:
   ```bash
   python -m http.server 8000
   ```
   Open `http://localhost:8000` in your browser.

Randomness is controlled everywhere by `RANDOM_STATE = 0`.

---

## 5. Preprocessing Choices & Feature Engineering

All 39 features are documented in `data/features/feature_dictionary.csv` and organized into 10 groups in `data/features/feature_groups.json`:

| Group | Count | Features |
|---|---:|---|
| `core` *(in Final 11)* | 6 | `runs_so_far`, `target_vs_venue_par`, `wickets_lost`, `balls_left`, `current_run_rate`, `required_run_rate` (capped at 36) |
| `derived` *(in Final 11)* | 5 | `run_rate_diff`, `runs_needed_frac`, `dls_resources`, `par_score_diff`, `runs_needed_per_wicket` |
| `phase` | 3 | `is_powerplay` (overs 1–6), `is_death` (overs 15–19), `powerplay_balls_left` |
| `momentum` | 5 | `runs_last_3`, `wkts_last_3`, `boundaries_last_3`, `acceleration`, `balls_since_last_wicket` |
| `batters` | 7 | `bat_sr_mean`, `bat_bpd_mean`, `bat_balls_max`, `bat_runs_sum`, `settled_sr_interaction`, `rem_bat_quality`, `rem_bat_sr` |
| `bowling` | 3 | `bowl_rem_econ`, `bowl_rem_wkt_rate`, `best_bowler_overs_left` |
| `impact` | 2 | `chasing_impact_used`, `bowling_impact_used` |
| `history` | 3 | `target_vs_season_avg`, `target_vs_recent_par` (30-match rolling league par), `venue_chase_rate` |
| `home` | 3 | `chasing_team_home`, `bowling_team_home`, `home_edge` |
| `form` | 2 | `chaser_form`, `bowler_form` (shrunk last-5-match win rate in the current season) |

### Why We Made These Preprocessing Choices

1. **Replacing raw `target` with `target_vs_venue_par`:** Because IPL totals inflated by ~30 runs between 2008–2023 and 2025–2026, a model using raw `target` treats modern par chases as extreme outliers. Subtracting the past-only venue average target (shrunk toward the 30-match rolling league par with $K = 8$ pseudo-matches) reduced out-of-range test rows to **0.8%**.
2. **Replacing linear `resources` with an Empirical Exponential DLS Curve (`dls_resources`, `par_score_diff`):** A linear product `balls_left * wickets_in_hand` wrongly assumes losing a wicket in Over 2 costs the same proportion of scoring capacity as in Over 18. We fitted the standard Duckworth–Lewis–Stern functional form $Z(u, w) = Z_0(w)[1 - \exp(-b(w)u)]$ via non-linear least squares strictly on 2008–2023 first innings (`data/features/dls_params.json`).
3. **Capping `required_run_rate` at `36.0`:** 36 runs per over is the maximum achievable off 6 legal deliveries without extras. Uncapped ratios in the final overs (e.g., 24 needed off 1 ball $\rightarrow \text{RRR} = 144$) distort feature standardization and linear coefficients.
4. **Empirical Bayes Shrinkage on Historical Features:** To handle debutants and rarely used grounds without noisy extremes, historical rates are shrunk toward league priors using strictly past-only matches: batter strike rate toward `125.0` ($K = 60$ balls), balls per dismissal toward `18.0` ($K = 3$ dismissals), venue chase rate toward league mean ($K = 10$ matches), home edge ($K = 10$), and 5-match form toward `0.5` ($K = 2$).
5. **In-Fold Median Imputation, Standard Scaling & Recency Weights:** `SimpleImputer(strategy="median")` and `StandardScaler()` are wrapped inside scikit-learn `Pipeline` objects so statistics are fitted inside each CV fold. Sample weights $w = \exp(-0.08 \cdot (\text{max season} - \text{season}))$ emphasize modern seasons during fitting.

---

## 6. Baselines, Models & Selection Protocol

- **Baselines:**
  - **A (Constant):** Always predicts the training row-level chase win rate (`0.526` on train; `0.564` on test).
  - **A2 (By-Over Empirical Rate):** Predicts the training chase win rate for each over number $o \in \{1, \dots, 19\}$.
  - **B (Run-Rate Rule `CRR >= RRR`):** Maps the textbook rule (`run_rate_diff <= 0`) to two empirical training probabilities: $P(\text{win} \mid \text{ahead}) = 0.850$, $P(\text{win} \mid \text{behind}) = 0.365$.
- **Candidate Models Compared:**
  - **LR:** L2-regularized Logistic Regression (`C` tuned across $10^{-3} \dots 10^2$ via 5-fold `GroupKFold`, best $C = 0.3162$).
  - **HGB:** Histogram Gradient-Boosted Trees (`early_stopping=False`, tuned over `learning_rate` $\in \{0.03, 0.1\}$, `max_depth` $\in \{2, 3, 4\}$, `max_iter` $\in \{100, 300\}$, `min_samples_leaf` $\in \{20, 60\}$, `l2_regularization` $\in \{0.0, 1.0\}$).
  - **HGBm:** Monotonic Histogram Gradient-Boosted Trees enforcing cricket domain monotonicity (win probability cannot increase with `wickets_lost`, `required_run_rate`, `run_rate_diff`, `runs_needed_frac`, or `runs_needed_per_wicket`, and cannot decrease with `dls_resources` or `par_score_diff`).
  - **MLP:** Multi-Layer Perceptron neural network (`hidden_layer_sizes` $\in \{(16,), (32, 16)\}$, `alpha` $\in \{10^{-3}, 10^{-2}, 10^{-1}\}$).
- **Pre-Registered Selection Rule:** Pick the **simplest `(model, feature_set)` candidate** (fewest features, linear before trees) whose validation log loss is within `0.003` of the overall best.

---

## 7. Leakage Controls

- Strict chronological season splits (`2008–2023` Train, `2024` Validation, `2025–2026` Test); every match stays wholly in one split.
- All historical player, venue, par, home, and form features use matches **strictly before** the match date (same-day matches excluded), verified against a brute-force recomputation on 60 random matches in `02_features.ipynb` with **0 disagreements**.
- Empirical DLS parameters (`dls_params.json`) are fitted strictly on training first innings (`season < 2024`).
- Crease batters at the end of over $o$ are identified from the first delivery of over $o+1$ (which records who is standing at the crease, never what happens on that ball).
- Imputation and scaling live inside scikit-learn `Pipeline` stages; Platt and isotonic recalibrators are fitted on out-of-fold training predictions only.
- Notebooks 01 and 03 assert `season < 2025`. Notebook 04 writes a lock file (`results/final/test_results.json`) and blocks re-execution.

---

## 8. Results & Error Analysis

### 8.1 Validation Set (2024 Season — 70 Matches, 1,239 Over States)

From `results/validation_table.csv` and `results/feature_ladder.csv`:

| Model / Candidate | Val Log Loss | 95% Match CI | Val Brier | Val Accuracy | Diff vs Rule B (95% CI) | P(Better than B) |
|---|---:|---|---:|---:|---|---:|
| A: Constant (train win rate) | 0.6958 | `[0.6835, 0.7075]` | 0.2513 | 48.75% | +0.1440 `[+0.0868, +0.2005]` | 0.0% |
| A2: Win rate by over | 0.6923 | `[0.6795, 0.7045]` | 0.2496 | 50.77% | +0.1405 `[+0.0841, +0.1965]` | 0.0% |
| B: Run-rate rule (`CRR >= RRR`) | 0.5522 | `[0.4927, 0.6112]` | 0.1838 | 75.95% | — | — |
| HGB: Gradient-boosted trees (19 feats) | 0.3899 | `[0.2948, 0.5008]` | 0.1253 | 81.60% | -0.1614 `[-0.2540, -0.0529]` | 99.7% |
| HGBm: Gradient-boosted, monotonic | 0.3901 | `[0.2944, 0.5019]` | 0.1253 | 81.68% | -0.1612 `[-0.2550, -0.0513]` | 99.7% |
| MLP: Small neural network (19 feats) | 0.3856 | `[0.2808, 0.5109]` | 0.1218 | 82.41% | -0.1655 `[-0.2689, -0.0387]` | 99.4% |
| **LR: Logistic regression (`C +phase+momentum`, 19 feats)** | **0.3690** | **`[0.2827, 0.4714]`** | **0.1174** | 82.49% | **-0.1825 `[-0.2672, -0.0874]`** | **100.0%** |
| **Selected Final: LR (`B +derived`, 11 feats)** | **0.3697** | **`[0.2835, 0.4719]`** | **0.1176** | **82.89%** | *(within 0.0007 <= 0.003 rule)* | **100.0%** |

- **Feature-Group Ladder (`results/feature_ladder.csv`):** For Logistic Regression, validation log loss across the 7 stages was: `A core` (6 feats) `0.3741` $\rightarrow$ `B +derived` (11 feats) `0.3697` $\rightarrow$ `C +phase+momentum` (19 feats) `0.3690` $\rightarrow$ `D +batters+bowling+impact` (31 feats) `0.3789` $\rightarrow$ `E +history` (34 feats) `0.3852` $\rightarrow$ `F +home` (37 feats) `0.3877` $\rightarrow$ `G +form (all)` (39 feats) `0.3866`. Adding player, venue, and short-term form features hurt validation generalization due to match-level variance, so the `0.003` rule selected **L2 Logistic Regression (`C = 0.3162`) on `B +derived` (11 features)**.
- **Recalibration Check:** Out-of-fold Platt scaling (`0.3695`) and isotonic regression (`0.3707`) did not improve on raw LR (`0.3690`).

### 8.2 Held-Out Test Set (2025–2026 Seasons — 138 Matches, 2,434 Over States)

From `results/final/test_table.csv`:

| Model | Test Log Loss | Test 95% CI | Test Brier | Test Accuracy | Test vs Rule B (95% CI) | P(Better than B) |
|---|---:|---|---:|---:|---|---:|
| A: Constant (train+val win rate) | 0.6882 | `[0.6805, 0.6962]` | 0.2475 | 56.41% | +0.1488 `[+0.0953, +0.2016]` | 0.0% |
| A2: Win rate by over | 0.6853 | `[0.6769, 0.6937]` | 0.2461 | 56.74% | +0.1459 `[+0.0925, +0.1984]` | 0.0% |
| B: Run-rate rule (`CRR >= RRR`) | 0.5396 | `[0.4842, 0.5964]` | 0.1792 | 75.31% | — | — |
| **FINAL: Logistic regression (`B +derived`, 11 feats)** | **0.3815** | **`[0.3200, 0.4499]`** | **0.1219** | **82.05%** | **-0.1576 `[-0.2126, -0.0985]`** | **100.0%** |
| *(Ref) Same model, fit on 2008–2023 train only* | *0.3884* | *`[0.3267, 0.4572]`* | *0.1248* | *81.68%* | *-0.1506 `[-0.2071, -0.0904]`* | *100.0%* |

- **Top Permutation Importances on Test (`results/final/test_permutation_importance.csv`):** `balls_left` (`+0.1811` log loss when permuted), `runs_needed_per_wicket` (`+0.1265`), `required_run_rate` (`+0.0718`), `run_rate_diff` (`+0.0469`), `target_vs_venue_par` (`+0.0409`), `wickets_lost` (`+0.0372`), and `runs_so_far` (`+0.0370`).

### 8.3 Error Analysis & Distribution Shift Check

- **Match-Level Win Rate vs. Rule B:** The final model achieved a lower average log loss than Rule B in **104 of 138** test matches (`75.4%`).
- **Worst Held-Out Matches (`results/final/test_match_errors.csv`):**
  1. **Match `1473468` (2025-04-15, KKR vs PBKS at Mullanpur, target 112, chase lost):** Mean model $\hat{p} = 0.884$, mean log loss **2.592** (Rule B: `1.894`). Chasing just 112, KKR reached 62/2 after Over 7 ($\hat{p} = 0.980$, single-row loss **3.894**—the largest single-over error in the test set) before collapsing to 95 all out.
  2. **Match `1473441` (2025-03-24, DC vs LSG at Visakhapatnam, target 210, chase won):** Mean model $\hat{p} = 0.145$, mean log loss **2.505** (Rule B: `0.919`). DC slumped to 7/3 in Over 2 ($\hat{p} = 0.029$, row loss **3.538**) and 65/5 in Over 7 ($\hat{p} = 0.032$) before Ashutosh Sharma's unbeaten 66* off 31 balls pulled off a 1-wicket miracle.
  3. **Match `1529298` (2026-05-11, DC vs PBKS at Dharamsala, target 211, chase won):** Mean model $\hat{p} = 0.219$, mean log loss **1.759** (Rule B: `0.961`). Late death-over boundary surge overcame a steep required rate with middle-order wickets down.
  4. **Match `1473473` (2025-04-19, RR vs LSG at Jaipur, target 181, chase lost):** Mean model $\hat{p} = 0.785$, mean log loss **1.610** (Rule B: `1.591`). RR cruised to 156/2 after Over 17 needing 25 off 18 balls ($\hat{p} > 0.90$) before choking in the final 3 overs to lose by 2 runs.
- **Error by Game State (`04_final_test.ipynb` §8):**
  - *By Required Run Rate:* Model log loss is highest in the competitive coin-flip bands $\text{RRR} \in (8, 10]$ (`0.559`) and $(10, 12]$ (`0.605`), and drops sharply when $\text{RRR} > 14$ (`0.137` for $(14, 18]$ and `0.016` for $> 18$, where Rule B suffers `0.454–0.483`).
  - *By Wickets Lost:* Highest in early 0-wicket states (`0.508` log loss across 431 rows) where 14+ overs remain; lowest when 8–9 wickets are down (`0.049–0.115`).
- **Season & Era-Shift Breakdown (`results/final/test_by_season.csv`):**
  - **2025 (68 matches, 1,202 rows):** Final LR log loss `0.4211` (Brier `0.1352`, Acc `79.95%`) vs. Rule B `0.5911`.
  - **2026 (70 matches, 1,232 rows):** Final LR log loss `0.3428` (Brier `0.1088`, Acc `84.09%`) vs. Rule B `0.4894`.
  - **Calibration under Era Shift:** Calibration slope is **1.19** (`1.00` = ideal) and intercept is **+0.61** (`0.00` = ideal). Because 2025–2026 chasing sides won `56.4%` of over-states despite `37.7%` of test rows having targets above the training 90th percentile (`203`), the model is slightly cautious (under-predicting win probability by ~5–8 percentage points in the 40%–75% band).

---

## 9. Limitations

- **Modest effective sample size:** ~70 matches per season (`138` test matches total) means match-bootstrap confidence intervals are wide (`±0.06` log loss); small differences between close feature sets are indistinguishable from noise.
- **Correlated rows within a match:** The 19 overs of one chase share the same outcome; effective sample size is the number of matches, not rows.
- **Unmodeled match conditions:** The model sees no information on pitch deterioration, evening dew, wind/boundary dimensions, or weather interruptions.
- **Lineup features in small samples:** Adding 28 extra phase, momentum, player, bowling, venue, home, and form features (`D`–`G`) slightly hurt 2024 validation log loss (`0.3697` $\rightarrow$ `0.3866`) due to finite-sample variance; therefore, the parsimonious 11-feature model (`B +derived`) is used for formal evaluation while the 39-feature model is provided in the interactive Live Predictor.
- **Excluded match types:** Rain-affected DLS games, super-over ties, no-results, and shortened matches are excluded; the model is not applicable to shortened chases.
- **Manual venue & franchise mapping:** Stadium and franchise mappings are maintained by hand in `parse_cricsheet.py` and `02_features.ipynb` and may need updates for future expansion teams or neutral venues.

---

## 10. AI-Use Disclosure

In accordance with course policy, AI coding assistants (GitHub Copilot / LLMs) were used during this project for:
1. **Frontend UI & SVG Chart Scaffolding:** Assisting with CSS styling (Day/Night match themes in `site/style.css`), DOM/SVG rendering helpers in `site/app.js` for the interactive worm charts and Playing 11 selectors, and HTML layout structuring in `index.html`.
2. **Boilerplate & Debugging:** Assisting with player name disambiguation mapping in `scripts/player_names.py` and formatting markdown tables in documentation.

**Verification:** All data parsing logic (`scripts/parse_cricsheet.py`), chronological splitting (`scripts/data_split.py`), empirical DLS curve fitting and 60-match brute-force temporal leakage checks (`notebooks/02_features.ipynb`), cross-validated model training and selection (`notebooks/03_baselines_and_models.ipynb`), and locked test evaluation (`notebooks/04_final_test.ipynb`) were executed, verified via automated assertions (`assert np.abs(mine - theirs).max() < 1e-6`, `0 disagreements` on past-only history features), and audited against the raw Cricsheet match logs.

---

## 11. Citations & Data Licence

1. **Ball-by-Ball Dataset:**  
   Rushe, S. (2008–2026). *Cricsheet: Ball-by-ball cricket match data for the Indian Premier League (IPL)*. Available at [https://cricsheet.org/](https://cricsheet.org/). Licensed under the [Creative Commons Attribution 4.0 International License (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/) (see `data/raw/LICENSE.txt`).
2. **Duckworth–Lewis–Stern Resource Formulation:**  
   Duckworth, F. C., & Lewis, A. J. (1998). A fair method for resetting the target in interrupted one-day cricket matches. *Journal of the Operational Research Society*, 49(3), 220–227.
3. **Software & Scientific Computing Stack:**  
   - Pedregosa, F., et al. (2011). Scikit-learn: Machine Learning in Python. *Journal of Machine Learning Research*, 12, 2825–2830.
   - Harris, C. R., et al. (2020). Array programming with NumPy. *Nature*, 585, 357–362.
   - McKinney, W. (2010). Data structures for statistical computing in Python (*pandas*). *Proceedings of the 9th Python in Science Conference*, 56–61.
   - Virtanen, P., et al. (2020). SciPy 1.0: Fundamental algorithms for scientific computing in Python. *Nature Methods*, 17, 261–272.
