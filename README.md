# IPL chase win probability

Predicts the probability that the chasing team wins an IPL match, given the state of the chase at the end of each completed over. Built for ES 335 (Machine Learning).

> **Live site:** `<link to GitHub Pages>`  |  **Author:** `<your name>` (individual project)

## 1. Problem

- **Row:** the state of one second-innings chase at the end of one completed over (overs 1 to 19).
- **Target:** `chasing_team_won` (1 if the chasing team won the match, 0 otherwise).
- **Output:** a calibrated probability, not just a win/lose label.
- **Primary metric:** log loss. Secondary: Brier score, calibration curves, accuracy by over.
- **Why this is not trivial:** a baseline rule ("win if current run rate is at least the required rate") is already strong, so the question is how much a learned model adds, and whether it holds up as scoring levels rise.

## 2. Data

- Source: [Cricsheet](https://cricsheet.org/) ball-by-ball JSON for the IPL.
- Kept: completed IPL matches with a full second innings.
- Excluded (and logged in `data/parsed/match_log.csv` with a reason): DLS-affected matches, ties and no-results, missing second innings, reduced-overs matches, non-IPL files.
- Conventions: wides and no-balls are not legal balls; retired hurt is not a wicket; season is the calendar year of the match.

| Split | Seasons | Use |
|---|---|---|
| Train | 2008-2023 | fitting and cross-validated tuning |
| Validation | 2024 | comparing candidates, choosing the final model |
| Test | 2025-26 | evaluated **once**, in notebook 04 |

The split is by **season** (never by row), and every match stays wholly in one split. Splitting by row would put overs of the same match on both sides and inflate scores.

## 3. Repository layout

```
scripts/
  parse_cricsheet.py            raw JSON -> data/parsed/overs.csv (+ match_log.csv)
  data_split.py                 splits features_all.csv into data/split/
notebooks/
  01_eda.ipynb                  exploratory analysis (train + validation only)
  02_features.ipynb             builds features_all.csv from overs.csv
  03_baselines_and_models.ipynb baselines, models, tuning, model selection
  04_final_test.ipynb           refit on train + validation, evaluate once on test
  05_export_site_data.ipynb     exports site/data/site_data.json
data/
  raw/                          Cricsheet JSON (not committed; download it)
  parsed/                       overs.csv, match_log.csv
  features/                     features_all.csv, feature_groups.json, feature_dictionary.csv
  split/                        train.csv, validation.csv, test.csv
results/                        tables, figures, model_selection.json
results/final/                  test results (written by notebook 04)
index.html                      GitHub Pages entry point
site/                           static website assets (app.js, style.css, data/)
```

## 4. How to reproduce

Requires Python 3.10+ and: `pandas numpy scikit-learn matplotlib jupyter nbformat openpyxl`.

1. Download the IPL JSON zip from Cricsheet and unzip it into `data/raw/`.
2. Parse:
   ```
   python scripts/parse_cricsheet.py data/raw --out data/parsed/overs.csv
   ```
   Check `data/parsed/match_log.csv` and edit `TEAM_MAP` / `HOME_GROUNDS` in the script if team or ground names are missing.
3. Run `notebooks/02_features.ipynb` (paths in the first cell are relative to `notebooks/`). It reads the full file and does no splitting.
4. Make the season split into `data/split/` (train 2008-2023, validation 2024, test 2025-26):
   ```
   python scripts/data_split.py
   ```
5. Run `notebooks/01_eda.ipynb` on train and validation, then `notebooks/03_baselines_and_models.ipynb`. Each notebook starts with a settings cell holding every path. Use Restart & Run All.
6. Run `notebooks/04_final_test.ipynb` **last and once**. It refuses to run a second time unless `ALLOW_RERUN = True`.
7. Run `notebooks/05_export_site_data.ipynb` to regenerate `site/data/site_data.json`.

Randomness is controlled by `RANDOM_STATE = 0`. Package versions used: `<paste output of pip freeze for the packages above>`.

## 5. Features

Defined in `data/features/feature_dictionary.csv` and grouped in `feature_groups.json`:

| Group | Examples |
|---|---|
| core | runs so far, target, wickets lost, balls left, current and required run rate (capped at 36) |
| derived | run-rate gap, runs needed / target, resources (balls left x wickets in hand), runs needed per wicket |
| momentum | runs and wickets in last 3 overs, boundaries, acceleration, balls since last wicket |
| batters | shrunk past strike rate, balls faced by the two batters at the crease |
| impact | impact player used by either side |
| history | target vs season average, venue chase win rate |
| home | home ground flags, home-record edge |
| form | each side's last-5-match form this season |

Scale-free features are preferred because first-innings totals rose from about 171 (2008-23) to about 191 (2024) and higher after, and tree models cannot extrapolate beyond the range they saw.

## 6. Methods

- **Baselines:** (A) constant training win rate; (A2) win rate by over; (B) the run-rate rule, mapped to probabilities with two training win rates.
- **Models:** L2 logistic regression; histogram gradient boosting (also with monotonic constraints: win probability may not rise with wickets lost or required rate); an optional small neural network.
- **Tuning:** grid search with 5-fold `GroupKFold`, groups = match id, scored by log loss.
- **Calibration:** Platt and isotonic recalibration tested, fitted on out-of-fold training predictions only.
- **Model selection (rule fixed in advance):** the simplest (model, feature set) candidate whose validation log loss is within 0.003 of the best. The result is stored in `results/model_selection.json`.
- **Uncertainty:** confidence intervals come from bootstrapping whole matches, including paired differences against baseline B.

## 7. Leakage controls

- Season-based split; whole matches stay together.
- Past-only history features (strike rates, season average, venue rate, home record, form) use only matches **strictly before** the match date, and same-day matches are excluded. This was checked against a brute-force recomputation on 60 sampled matches with 0 disagreements.
- The batters at the crease are read from the first delivery of the next over, which shows who is there, never what happens.
- Imputation and scaling are fitted on training rows only, inside pipelines (refitted in every fold).
- Gradient boosting runs with `early_stopping=False`, because its built-in early stopping splits by row.
- Notebooks 01 and 03 refuse to load any test season. Notebook 04 is the only place the test file is read, and it locks after one run.

## 8. Results

`<fill from results/validation_table.csv and results/final/test_table.csv>`

| Model | Validation log loss | Test log loss (95% CI) | Test vs rule B (95% CI) |
|---|---|---|---|
| A constant | | | |
| A2 by over | | | |
| B run-rate rule | | | |
| Final model | | | |

Figures: `results/calibration_and_by_over.png`, `results/feature_ladder.png`, `results/final/test_calibration_and_by_over.png`, `results/final/test_match_trajectories.png`.

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
- `<Add one line if you looked at test-season statistics at any earlier point, for example during profiling.>`

## 11. Data licence and credits

Ball-by-ball data from [Cricsheet](https://cricsheet.org/) (check their licence and credit requirements before publishing). Code: `<your licence>`.
