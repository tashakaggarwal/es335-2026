/* Universal browser + Node.js inference & attribution engine for IPL Chase Win Probability. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.IPLInference = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clamp(v, a, b) {
    return Math.min(b, Math.max(a, v));
  }

  function computeDLSResources(ballsLeft, wicketsLost, dlsParams) {
    if (!dlsParams || ballsLeft <= 0 || wicketsLost >= 10) return 0;
    const w = clamp(Math.round(wicketsLost), 0, 9);
    const z0 = (dlsParams.Z0 && Number(dlsParams.Z0[w])) || 160;
    const b = (dlsParams.b && Number(dlsParams.b[w])) || 0.015;
    const norm = Number(dlsParams.norm_120) || 168;
    const raw = z0 * (1 - Math.exp(-b * ballsLeft));
    return clamp((100 * raw) / norm, 0, 100);
  }

  /**
   * Evaluate standardized L2 logistic regression and compute exact additive
   * log-odds attributions (exact linear Shapley values: delta_i = coef_i * z_i).
   */
  function evalLinearModel(featMap, modelSpec) {
    let logit = Number(modelSpec.intercept) || 0;
    const contributions = [];
    for (let i = 0; i < modelSpec.features.length; i++) {
      const f = modelSpec.features[i];
      const mean = modelSpec.mean[i];
      const scale = modelSpec.scale[i] || 1;
      const coef = modelSpec.coef[i];
      const rawVal = f in featMap && featMap[f] != null && !Number.isNaN(featMap[f]) ? Number(featMap[f]) : mean;
      const z = (rawVal - mean) / scale;
      const delta = coef * z;
      logit += delta;
      contributions.push({ feature: f, value: rawVal, z, coef, delta });
    }
    const p = 1 / (1 + Math.exp(-logit));
    return { p, logit, contributions };
  }

  /**
   * Remaining bowling attack estimator — strictly mirrors src/ipl_winprob/parse.py:bowling_features.
   * Only schedules frontline bowlers (balls >= 60 or already bowled in this chase, padded to 5 by
   * highest past balls) so pure batters with 0 career balls never displace actual bowlers.
   */
  function computeRemainingBowling(activeBowlers, remOvers, fallbackEcon, fallbackWkt) {
    const MIN_PAST_BALLS = 60;
    const MIN_ATTACK = 5;
    if (!activeBowlers || activeBowlers.length === 0) {
      return {
        bowl_rem_econ: fallbackEcon,
        bowl_rem_wkt_rate: fallbackWkt,
        best_bowler_overs_left: Math.min(8, Math.round(remOvers * 0.42 * 10) / 10),
      };
    }

    const attack = activeBowlers.filter((b) => (b.bowled || 0) > 0 || (b.balls || 0) >= MIN_PAST_BALLS);
    if (attack.length < MIN_ATTACK) {
      const inAttack = new Set(attack);
      const rest = activeBowlers
        .filter((b) => !inAttack.has(b))
        .slice()
        .sort((a, b) => (b.balls || 0) - (a.balls || 0));
      const needed = Math.max(0, MIN_ATTACK - attack.length);
      for (let i = 0; i < Math.min(needed, rest.length); i++) {
        attack.push(rest[i]);
      }
    }

    const sortedAttack = attack.slice().sort((a, b) => a.econ - b.econ);
    const top2 = sortedAttack.slice(0, 2);
    const best_bowler_overs_left = Math.min(
      remOvers,
      top2.reduce((s, b) => s + Math.max(0, b.quotaLeft), 0)
    );

    if (remOvers <= 0) {
      return {
        bowl_rem_econ: fallbackEcon,
        bowl_rem_wkt_rate: fallbackWkt,
        best_bowler_overs_left: 0,
      };
    }

    let needOv = remOvers;
    let wEcon = 0;
    let wWkt = 0;
    for (let i = 0; i < sortedAttack.length; i++) {
      if (needOv <= 0) break;
      const b = sortedAttack[i];
      const take = Math.min(needOv, Math.max(0, b.quotaLeft));
      if (take > 0) {
        wEcon += take * b.econ;
        wWkt += take * b.wkt_rate;
        needOv -= take;
      }
    }
    if (needOv > 0) {
      wEcon += needOv * fallbackEcon;
      wWkt += needOv * fallbackWkt;
    }
    return {
      bowl_rem_econ: wEcon / remOvers,
      bowl_rem_wkt_rate: wWkt / remOvers,
      best_bowler_overs_left,
    };
  }

  /**
   * Build the exact 11-feature map for a historical Match Explorer over state
   * so real-time feature attributions match the exact model probability.
   */
  function buildExplorerFeatureMap(match, overRow, dlsParams, defaultPar) {
    const ov = overRow[0];
    const runs = overRow[1];
    const wkts = overRow[2];
    const target = match.target;
    const balls = 120 - 6 * ov;
    const need = Math.max(0, target - runs);
    const hand = Math.max(1, 10 - wkts);
    const crr = runs / ov;
    const rrr = balls > 0 ? Math.min(36, (need / balls) * 6) : 0;
    const dls_resources = computeDLSResources(balls, wkts, dlsParams);
    const par_score_diff = runs - target * (1 - dls_resources / 100);
    const vPar = match.venue_par != null ? match.venue_par : defaultPar;
    return {
      runs_so_far: runs,
      target,
      target_vs_venue_par: target - vPar,
      wickets_lost: wkts,
      balls_left: balls,
      current_run_rate: crr,
      required_run_rate: rrr,
      run_rate_diff: rrr - crr,
      runs_needed_frac: need / target,
      dls_resources,
      par_score_diff,
      runs_needed_per_wicket: need / hand,
    };
  }

  return {
    clamp,
    computeDLSResources,
    evalLinearModel,
    computeRemainingBowling,
    buildExplorerFeatureMap,
  };
});
