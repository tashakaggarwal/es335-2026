"""Python-vs-JavaScript inference parity, attribution identity, and bowling-quota regression tests."""

import json
import subprocess
from pathlib import Path

import numpy as np
import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SITE_DATA_PATH = REPO_ROOT / "site" / "data" / "site_data.json"
INFERENCE_JS = REPO_ROOT / "site" / "inference.js"


def _run_node(script: str, payload: dict = None) -> str:
    res = subprocess.run(
        ["node", "-e", script],
        cwd=str(REPO_ROOT),
        input=json.dumps(payload) if payload is not None else None,
        capture_output=True,
        text=True,
        check=True,
    )
    return res.stdout.strip()


def test_js_syntax_valid():
    for js_file in ("site/inference.js", "site/app.js"):
        subprocess.run(["node", "--check", js_file], cwd=str(REPO_ROOT), check=True)


def test_js_matches_python_logistic_models_and_attributions():
    assert SITE_DATA_PATH.exists(), "site/data/site_data.json must exist"
    site = json.loads(SITE_DATA_PATH.read_text(encoding="utf-8"))
    whatif = site["whatif"]

    # Check both the 11-feature final model and the 39-feature live model
    for key, spec in [("final_11", whatif), ("live_39", whatif["live_model"])]:
        rng = np.random.default_rng(123)
        feats = spec["features"]
        means = np.array(spec["mean"], dtype=float)
        scales = np.array(spec["scale"], dtype=float)
        coefs = np.array(spec["coef"], dtype=float)
        intercept = float(spec["intercept"])

        # Synthetic test inputs spanning +/- 2 std around training mean
        x_mat = means + rng.normal(0.0, 1.5, size=(20, len(feats))) * scales
        z_mat = (x_mat - means) / scales
        py_logits = z_mat @ coefs + intercept
        py_probs = 1.0 / (1.0 + np.exp(-py_logits))

        payload = {
            "spec": spec,
            "rows": [{f: float(row[j]) for j, f in enumerate(feats)} for row in x_mat],
        }
        node_code = (
            "const fs = require('fs');"
            "const inf = require('./site/inference.js');"
            "const p = JSON.parse(fs.readFileSync(0, 'utf8'));"
            "const out = p.rows.map(r => inf.evalLinearModel(r, p.spec));"
            "console.log(JSON.stringify(out));"
        )
        js_out = json.loads(_run_node(node_code, payload))

        for i, item in enumerate(js_out):
            assert abs(item["p"] - py_probs[i]) < 1e-12, f"{key} row {i} probability mismatch"
            assert abs(item["logit"] - py_logits[i]) < 1e-12, f"{key} row {i} logit mismatch"
            # Exact additive attribution identity: intercept + sum(delta_i) == logit
            sum_delta = sum(c["delta"] for c in item["contributions"])
            assert abs((intercept + sum_delta) - item["logit"]) < 1e-11


def test_bowling_quota_regression_excludes_pure_batters():
    """Pure batters (0 career balls, 8.30 prior econ) must NOT displace 5 frontline bowlers."""
    bowlers = [
        # 5 frontline bowlers with career balls >= 60 and economy 8.8 - 9.2
        {"name": "B1", "econ": 8.8, "wkt_rate": 0.055, "balls": 300, "bowled": 1, "quotaLeft": 3},
        {"name": "B2", "econ": 8.9, "wkt_rate": 0.050, "balls": 250, "bowled": 1, "quotaLeft": 3},
        {"name": "B3", "econ": 9.0, "wkt_rate": 0.048, "balls": 200, "bowled": 0, "quotaLeft": 4},
        {"name": "B4", "econ": 9.1, "wkt_rate": 0.045, "balls": 180, "bowled": 0, "quotaLeft": 4},
        {"name": "B5", "econ": 9.2, "wkt_rate": 0.042, "balls": 120, "bowled": 0, "quotaLeft": 4},
        # 6 pure batters with 0 balls bowled and shrunk prior economy 8.30
        {"name": "Bat1", "econ": 8.3, "wkt_rate": 0.052, "balls": 0, "bowled": 0, "quotaLeft": 4},
        {"name": "Bat2", "econ": 8.3, "wkt_rate": 0.052, "balls": 0, "bowled": 0, "quotaLeft": 4},
        {"name": "Bat3", "econ": 8.3, "wkt_rate": 0.052, "balls": 0, "bowled": 0, "quotaLeft": 4},
    ]
    node_code = (
        "const inf = require('./site/inference.js');"
        f"const res = inf.computeRemainingBowling({json.dumps(bowlers)}, 10, 8.3, 0.052);"
        "console.log(JSON.stringify(res));"
    )
    res = json.loads(_run_node(node_code))
    # Remaining 10 overs must come from B1 (3 ov @ 8.8), B2 (3 ov @ 8.9), B3 (4 ov @ 9.0) -> weighted econ = 8.91
    expected_econ = (3 * 8.8 + 3 * 8.9 + 4 * 9.0) / 10.0
    assert res["bowl_rem_econ"] == pytest.approx(expected_econ, abs=1e-6)
    assert res["best_bowler_overs_left"] == pytest.approx(6.0, abs=1e-6)


def test_explorer_feature_map_reproduces_exported_test_probabilities():
    site = json.loads(SITE_DATA_PATH.read_text(encoding="utf-8"))
    dls = site["whatif"]["dls_params"]
    default_par = site["whatif"]["default_recent_par"]
    sample_matches = site["matches"][:5]

    payload = {
        "matches": sample_matches,
        "spec": site["whatif"],
        "dls": dls,
        "defaultPar": default_par,
    }
    node_code = (
        "const fs = require('fs');"
        "const inf = require('./site/inference.js');"
        "const p = JSON.parse(fs.readFileSync(0, 'utf8'));"
        "const errs = [];"
        "for (const m of p.matches) {"
        "  for (const ov of m.overs) {"
        "    const fm = inf.buildExplorerFeatureMap(m, ov, p.dls, p.defaultPar);"
        "    const out = inf.evalLinearModel(fm, p.spec);"
        "    errs.push(Math.abs(out.p - ov[3]));"
        "  }"
        "}"
        "console.log(JSON.stringify({ maxErr: Math.max(...errs), count: errs.length }));"
    )
    res = json.loads(_run_node(node_code, payload))
    # Exported overs are rounded to 4 decimals (0.0001) and venue_par rounded to 2 decimals -> max error < 5e-4
    assert res["count"] > 50
    assert res["maxErr"] < 1e-3, f"Explorer attribution probability mismatch: maxErr={res['maxErr']}"
