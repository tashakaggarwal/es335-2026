# IPL Chase Win Probability Engine

[![CI](https://github.com/tashakaggarwal/es335-2026/actions/workflows/ci.yml/badge.svg)](https://github.com/tashakaggarwal/es335-2026/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Calibrated over-by-over and ball-by-ball win probability engine for Indian Premier League (IPL) run chases (2008–2026), built with a leakage-free temporal ML pipeline (`src/ipl_winprob/`), count-weighted empirical Duckworth–Lewis–Stern (DLS) resource curves, modern GBDT benchmarks (LightGBM, XGBoost, scikit-learn HGB), and a zero-backend interactive web app featuring real-time exact linear Shapley feature attributions.

> **Author:** Tashak Aggarwal (Roll No. 25110321)  
> **Live Demo:** [https://tashakaggarwal.github.io/es335-2026/](https://tashakaggarwal.github.io/es335-2026/)  
> **Repository:** [https://github.com/tashakaggarwal/es335-2026](https://github.com/tashakaggarwal/es335-2026)

---

## Key Highlights

- **Leakage-Free Temporal ML Pipeline:** Strictly chronological splits (`2008–2023` Train, `2024` Val, `2025–2026` Test), `GroupKFold(groups=match_id)` CV, strictly past-only player/venue/form features verified by an automated 60-match brute-force temporal audit (`0` disagreements), and a single-shot locked test set.
- **Count-Weighted Empirical DLS Curve & Era-Shift Handling:** Fits $Z(u, w) = Z_0(w)[1 - \exp(-b(w)u)]$ weighted by state observation counts strictly on training first innings (`norm_120 = 166.5`), plus past-only venue-par normalization (`target_vs_venue_par`) that cuts out-of-range test features under a +30-run scoring surge to **0.8%**.
- **Parsimonious Domain-Informed Model Beats GBDTs & MLP:** Across both **21,251 over states** and **131,586 ball-by-ball legal deliveries**, an 11-feature L2 logistic regression (`B +derived`) beats LightGBM, XGBoost, monotonic HGB, and a recency-weighted MLP on probabilistic log loss and Brier score, improving over the broadcast run-rate rule (`CRR >= RRR`) by **−0.1586 log loss** (`0.3805` vs `0.5396`, `95% match-bootstrap CI [-0.2134, -0.0997]`, winning **75.4%** of matches).
- **Zero-Backend Web App with Real-Time Attributions & CI Parity:** Browser inference (`site/inference.js`) computes live win probabilities and exact additive log-odds drivers ($\beta_i z_i$) across the **Match Explorer**, **39-Feature Live Predictor**, and **Scenario Simulator**, verified against Python `scikit-learn` to `< 1e-12` via automated `pytest` + Node.js CI.

---

## 1. Repository Layout

```text
src/ipl_winprob/
  constants.py                  canonical team/venue maps, shrinkage priors, 39 feature definitions
  parse.py                      Cricsheet JSON parser (over-level + ball-by-ball) & unified serving profiles
  dls.py                        count-weighted empirical exponential DLS curve fitter & evaluator
  features.py                   past-only historical features, brute-force leakage audit, season splitter
  models.py                     baselines, weighted grouped CV (LR, HGB, LightGBM, XGBoost, MLP), ladder
  evaluate.py                   log loss, Brier, 2,000x match-cluster bootstrap, drop-column & perm importance
  export.py                     exports site/data/site_data.json with <1e-6 sklearn parity assertions
  pipeline.py                   end-to-end CLI entrypoint (`python -m ipl_winprob.pipeline`)
scripts/
  download_data.py              fetches & extracts Cricsheet IPL ball-by-ball JSON archive into data/raw/
  parse_cricsheet.py            CLI wrapper around ipl_winprob.parse
  data_split.py                 CLI wrapper around ipl_winprob.features.split_by_season
  player_names.py               full player display-name map delegating profile building to ipl_winprob.parse
tests/
  test_parse.py                 cricket rules (wides, noballs, penalty, retired hurt/not out, ball-by-ball)
  test_dls.py                   count-weighted DLS curve monotonicity, boundaries & season-cutoff guards
  test_leakage.py               brute-force past-only leakage audit, doubleheader isolation & split checks
  test_js_parity.py             Node.js CI parity (<1e-12 vs Python), Shapley sum & bowling-quota regression
notebooks/
  01_eda.ipynb                  exploratory analysis & data quality checks (train + validation only)
  02_features.ipynb             interactive walkthrough of DLS fitting & leakage verification
  03_baselines_and_models.ipynb model family comparison, calibration & feature-group ladder
  04_final_test.ipynb           locked held-out test evaluation & error analysis
  05_export_site_data.ipynb     interactive website export notebook
results/                        validation_table.csv, feature_ladder.csv, recalibration_summary.json, figures
results/final/                  test_table.csv, ball_by_ball_test_table.csv, test_drop_column_importance.csv,
                                test_permutation_importance.csv, test_match_errors.csv, test_by_season.csv
site/                           inference.js (UMD browser+Node), app.js, style.css, data/site_data.json
index.html                      GitHub Pages static web app
.github/workflows/ci.yml        GitHub Actions CI (Ruff lint, Node syntax check, pytest suite)
pyproject.toml                  package metadata, ruff & pytest configuration
LICENSE                         MIT License (code) + CC BY 4.0 attribution notice (Cricsheet data)
```

---

## 2. Quickstart & Full Reproduction

Requires **Python 3.10+** and **Node.js 18+** (for JS parity tests). Raw/intermediate datasets (`data/`) are excluded from Git via `.gitignore` and reproduced automatically:

```bash
# 1. Install package + dev/test tools
pip install -e ".[dev]"

# 2. Download Cricsheet IPL ball-by-ball JSON archive (~1,243 matches) into data/raw/
python scripts/download_data.py

# 3. Run full end-to-end reproducible pipeline (over-by-over + 131k ball-by-ball + GBDT benchmarks + site export)
python -m ipl_winprob.pipeline

# 4. Run automated test suite (parsing, DLS, leakage audit, Python-vs-JS parity) and linter
pytest
ruff check src scripts tests

# 5. Preview interactive web app locally
python -m http.server 8000
```

All randomness is controlled via `RANDOM_STATE = 0`.

---

## 3. Data, Splits & Leakage Controls

- **Source:** [Cricsheet](https://cricsheet.org/) IPL ball-by-ball JSON archive (`CC BY 4.0`). Out of **1,243** raw match files (2008–2026), **1,185** regular completed chases are kept (**21,251** end-of-over states; **131,586** legal-delivery ball-by-ball states; **22,438** first-innings over states for DLS fitting). **58** files are excluded and logged (`25` ties/no-results, `23` DLS rain-revised chases, `10` shortened `<20`-over matches).
- **Entity & Rules Standardization:** 60 raw venue spellings unified into 36 canonical grounds; renamed franchises mapped (`Delhi Daredevils -> Delhi Capitals`, `Kings XI Punjab -> Punjab Kings`, `Royal Challengers Bangalore -> Royal Challengers Bengaluru`, `Rising Pune Supergiant(s)`); wides, no-balls, `penalty` extras, and `retired hurt`/`retired not out` handled identically across training parsing and live serving profiles (`registry_id`-tracked, `AVG_K=4`, `BPD_K=4`, `SR_K=60`, `BOWL_K=120`).

### Chronological Season Splits

| Split | Seasons | Matches | Over Rows | Ball Rows | Mean Target | Match Win % | Role in Pipeline |
|---|---|---:|---:|---:|---:|---:|---|
| **Train** | 2008–2023 | 977 | 17,578 | 108,823 | 165.8 | 54.2% | Count-weighted DLS curve, 5-fold `GroupKFold` weighted CV, OOF calibration |
| **Validation** | 2024 | 70 | 1,239 | 7,710 | 191.1 | 51.4% | Model family comparison & 7-stage feature ladder (`0.003` parsimony rule) |
| **Held-Out Test** | 2025–2026 | 138 | 2,434 | 15,053 | 195.4 | 56.5% | Single-shot locked evaluation after refitting chosen spec on 2008–2024 |

- **Leakage Controls:** Strict calendar-season splits; `GroupKFold(groups=match_id)` tuning; `early_stopping=False` on boosted trees; strictly past-only history features excluding same-day doubleheaders (`0` disagreements on automated brute-force verification); in-fold `SimpleImputer` + `StandardScaler`; locked `test_results.json`.
- **Honesty Note on Initial Data Profiling:** While no training, hyperparameter tuning, or model selection touched 2025–2026 rows, aggregate season-level target averages across the parsed archive (the 2024–2026 scoring surge) were observed during initial profiling, motivating scale-free and par-normalized features (`target_vs_venue_par`, `runs_needed_frac`).

---

## 4. Benchmark Results

### 4.1 2024 Validation Benchmark (70 Matches, 1,239 Over States — Consistent Recency Weighting $\lambda = 0.08$)

From `results/validation_table.csv` and `results/feature_ladder.csv`:

| Model / Baseline | Val Log Loss | 95% Match CI | Val Brier | Val Accuracy | Diff vs Rule B (95% CI) | P(Better) |
|---|---:|---|---:|---:|---|---:|
| A: Constant (train row win rate `0.526`) | 0.6958 | `[0.6835, 0.7075]` | 0.2513 | 48.75% | +0.1440 `[+0.0868, +0.2005]` | 0.0% |
| A2: Empirical win rate by over | 0.6923 | `[0.6795, 0.7045]` | 0.2496 | 50.77% | +0.1405 `[+0.0841, +0.1965]` | 0.0% |
| B: Run-rate rule (`CRR >= RRR`) | 0.5522 | `[0.4927, 0.6112]` | 0.1838 | 75.95% | — | — |
| HGB / HGBm (sklearn boosted trees, 19 feats) | 0.3957 | `[0.2978, 0.5090]` | 0.1288 | 81.19% | -0.1557 `[-0.2483, -0.0462]` | 99.6% |
| LGBM / LGBMm (LightGBM + monotonic, 19 feats) | 0.3854 | `[0.3001, 0.4835]` | 0.1240 | 82.41% | -0.1661 `[-0.2482, -0.0730]` | 100.0% |
| XGB / XGBm (XGBoost + monotonic, 19 feats) | 0.3846 | `[0.3008, 0.4796]` | 0.1235 | 82.81% | -0.1669 `[-0.2485, -0.0765]` | 100.0% |
| MLP (weighted neural network, 19 feats) | 0.3769 | `[0.2795, 0.4928]` | 0.1198 | **83.37%** | -0.1744 `[-0.2718, -0.0615]` | 99.9% |
| **LR (`C +phase+momentum`, 19 feats, `C=0.1`)** | **0.3682** | **`[0.2820, 0.4703]`** | **0.1171** | 82.65% | **-0.1832 `[-0.2676, -0.0880]`** | **100.0%** |
| **Selected Final: LR (`B +derived`, 11 feats)** | **0.3687** | **`[0.2825, 0.4708]`** | **0.1173** | 83.13% | *(within `0.0005 <= 0.003` rule)* | **100.0%** |

- **Weighted OOF Recalibration (`results/recalibration_summary.json`):** Raw LR (`0.3682`) vs. LR + Platt (`0.3686`) vs. LR + Isotonic (`0.3686`) — no post-hoc recalibration needed.

### 4.2 Held-Out 2025–2026 Test Evaluation (Over-by-Over: 138 Matches, 2,434 States)

From `results/final/test_table.csv` and `results/final/test_by_season.csv`:

| Model | Test Log Loss | 95% Match CI | Test Brier | Test Accuracy | Diff vs Rule B (95% CI) | P(Better) |
|---|---:|---|---:|---:|---|---:|
| A: Constant (train+val win rate) | 0.6882 | `[0.6805, 0.6962]` | 0.2475 | 56.41% | +0.1488 `[+0.0953, +0.2016]` | 0.0% |
| A2: Win rate by over | 0.6853 | `[0.6769, 0.6937]` | 0.2461 | 56.74% | +0.1459 `[+0.0925, +0.1984]` | 0.0% |
| B: Run-rate rule (`CRR >= RRR`) | 0.5396 | `[0.4842, 0.5964]` | 0.1792 | 75.31% | — | — |
| **FINAL: LR (`B +derived`, 11 feats)** | **0.3805** | **`[0.3195, 0.4493]`** | **0.1214** | **82.37%** | **-0.1586 `[-0.2134, -0.0997]`** | **100.0%** |
| *(Ref) Same model, fit on 2008–2023 train only* | *0.3867* | *`[0.3254, 0.4551]`* | *0.1240* | *81.64%* | *-0.1524 `[-0.2087, -0.0925]`* | *100.0%* |

- **Per-Season Breakdown:** **2025** (68 matches): `0.4214` log loss (`0.1353` Brier, `80.12%` acc) vs Rule B `0.5911`; **2026** (70 matches): **`0.3406`** log loss (`0.1079` Brier, `84.58%` acc) vs Rule B `0.4894`.
- **Collinearity-Safe Feature Importance (`test_drop_column_importance.csv`):** Refitting after dropping one feature at a time identifies `target_vs_venue_par` (`+0.0092`), `runs_so_far` (`+0.0029`), `par_score_diff` (`+0.0021`), and `wickets_lost` (`+0.0020`) as the most irreplaceable features under the 2025–2026 scoring surge.

### 4.3 Ball-by-Ball Granularity Benchmark (131,586 Deliveries; 15,053 Held-Out Test Deliveries)

From `results/final/ball_by_ball_test_table.csv`:

| Model (Ball-by-Ball, 15,053 Test Deliveries) | Test Log Loss | 95% Match CI | Test Brier | Test Accuracy | Diff vs Rule B (95% CI) |
|---|---:|---|---:|---:|---|
| B: Run-rate rule (`CRR >= RRR`) | 0.5466 | `[0.4939, 0.6018]` | 0.1822 | 74.66% | — |
| **LR (19 feats, ball-by-ball)** | **0.3820** | **`[0.3224, 0.4484]`** | **0.1226** | 82.10% | **-0.1640 `[-0.2184, -0.1065]`** |
| LR (11 feats, ball-by-ball) | 0.3847 | `[0.3232, 0.4526]` | 0.1233 | 81.85% | -0.1614 `[-0.2153, -0.1033]` |
| HGBm (monotonic HGB, 19 feats) | 0.3916 | `[0.3290, 0.4615]` | 0.1246 | 81.62% | -0.1545 `[-0.2145, -0.0910]` |
| XGBm (monotonic XGBoost, 19 feats) | 0.3932 | `[0.3359, 0.4564]` | 0.1253 | **82.52%** | -0.1529 `[-0.2077, -0.0962]` |
| LGBMm (monotonic LightGBM, 19 feats) | 0.3961 | `[0.3388, 0.4605]` | 0.1266 | 82.12% | -0.1499 `[-0.2045, -0.0931]` |

---

## 5. Limitations, AI-Use Disclosure & Citations

- **Limitations:** Effective sample size is matches (~70/season), not rows; calibration slope `1.19` / intercept `+0.60` reflects higher modern 200+ chase success; feature weights represent predictive associations, not causal interventions; unmodeled factors include pitch deterioration, evening dew, and injuries; DLS/shortened/tied matches are excluded.
- **AI-Use Disclosure:** AI coding assistants assisted with frontend UI/SVG scaffolding, refactoring boilerplate, and documentation formatting. All parsing logic, count-weighted DLS fitting, temporal leakage checks, weighted CV modeling, and Python-to-JavaScript parity (`< 1e-12`) are independently verified via `pytest` and GitHub Actions CI.
- **Citations & Licenses:** Project code is licensed under [MIT](LICENSE). Ball-by-ball IPL data is from [Cricsheet](https://cricsheet.org/) (Rushe, 2008–2026) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Empirical resource curve formulation follows Duckworth & Lewis (1998), *J. Operational Research Society*, 49(3), 220–227. Built with scikit-learn, LightGBM, XGBoost, NumPy, pandas, and SciPy.
