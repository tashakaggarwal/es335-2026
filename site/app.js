"use strict";

const NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);
const LABELS = {
  runs_so_far: "Runs scored", target: "Target", target_vs_venue_par: "Target vs venue par",
  target_vs_recent_par: "Target vs recent league par", wickets_lost: "Wickets lost", balls_left: "Balls left",
  current_run_rate: "Current run rate", required_run_rate: "Required run rate", run_rate_diff: "Run-rate gap",
  runs_needed_frac: "Share of target needed", resources: "Balls left x wickets",
  dls_resources: "DLS resource %", par_score_diff: "Runs vs DLS par",
  runs_needed_per_wicket: "Runs needed per wicket", is_powerplay: "In powerplay",
  is_death: "In death overs", powerplay_balls_left: "Powerplay balls left",
  runs_last_3: "Runs, last 3 overs", wkts_last_3: "Wickets, last 3 overs",
  boundaries_last_3: "Boundaries, last 3 overs", acceleration: "Recent acceleration",
  balls_since_last_wicket: "Balls since last wicket", bat_sr_mean: "Batters' strike rate",
  bat_bpd_mean: "Batters' balls per dismissal", bat_balls_sum: "Balls faced by batters",
  bat_balls_max: "Most balls faced by a batter", bat_runs_sum: "Partnership runs at crease",
  settled_sr_interaction: "Settled batter x strike rate", rem_bat_n: "Batters left in dugout",
  rem_bat_quality: "Dugout top-3 avg sum", rem_bat_sr: "Dugout top-3 strike rate",
  bowl_rem_econ: "Remaining bowling economy", bowl_rem_wkt_rate: "Remaining bowling wicket rate",
  best_bowler_overs_left: "Top-2 bowlers overs left", chasing_impact_used: "Chasing side used impact player",
  bowling_impact_used: "Bowling side used impact player", target_vs_season_avg: "Target vs season average",
  venue_chase_rate: "Venue chase record", chasing_team_home: "Chasing side at home", bowling_team_home: "Bowling side at home",
  home_edge: "Home record edge", chaser_form: "Chasing side form", bowler_form: "Bowling side form",
};
const label = (f) => LABELS[f] || f.replace(/_/g, " ");

/* Official IPL team palettes for Day Match (light) and Night Match (dark) + clash-avoidance secondary kit colors */
const TEAM_COLORS = {
  "Chennai Super Kings":         { light: ["#d49000", "#1b559c"], dark: ["#f5bd1f", "#4c8ff5"], family: "yellow" },
  "Mumbai Indians":              { light: ["#005da0", "#c98a00"], dark: ["#3b98f5", "#f0b429"], family: "blue" },
  "Royal Challengers Bengaluru": { light: ["#c81d25", "#2b3442"], dark: ["#f24952", "#e0b53b"], family: "red" },
  "Kolkata Knight Riders":       { light: ["#592c82", "#c48f00"], dark: ["#a770ef", "#f2c144"], family: "purple" },
  "Delhi Capitals":              { light: ["#17479e", "#c9252d"], dark: ["#4d88f7", "#f2555c"], family: "blue" },
  "Rajasthan Royals":            { light: ["#d11d73", "#1e3f85"], dark: ["#f55ca8", "#5989f2"], family: "pink" },
  "Sunrisers Hyderabad":         { light: ["#df5316", "#333942"], dark: ["#ff7d3b", "#a3adb8"], family: "orange" },
  "Punjab Kings":                { light: ["#b51b2e", "#b8860b"], dark: ["#f04e63", "#e6b842"], family: "red" },
  "Gujarat Titans":              { light: ["#1b396a", "#b88a14"], dark: ["#4997d6", "#e5b949"], family: "navy" },
  "Lucknow Super Giants":        { light: ["#007694", "#d95b16"], dark: ["#28bbe0", "#ff8442"], family: "cyan" },
};

function isDark() {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function getMatchColors(chaser, bowler) {
  const mode = isDark() ? "dark" : "light";
  const cDef = TEAM_COLORS[chaser] || { light: [css("--outfield"), css("--outfield")], dark: [css("--outfield"), css("--outfield")], family: "c" };
  const bDef = TEAM_COLORS[bowler] || { light: [css("--dusk"), css("--dusk")], dark: [css("--dusk"), css("--dusk")], family: "b" };
  const cCol = cDef[mode][0];
  const bCol = cDef.family === bDef.family ? bDef[mode][1] : bDef[mode][0];
  return [cCol, bCol];
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem("es335_theme"); } catch (_) {}
  const initial = saved === "dark" || saved === "light" ? saved : (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  applyTheme(initial, false);
  $("theme-toggle").addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    applyTheme(next, true);
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
    let curSaved = null;
    try { curSaved = localStorage.getItem("es335_theme"); } catch (_) {}
    if (!curSaved) applyTheme(e.matches ? "dark" : "light", false);
  });
}

function applyTheme(mode, persist) {
  document.documentElement.setAttribute("data-theme", mode);
  if (persist) {
    try { localStorage.setItem("es335_theme", mode); } catch (_) {}
  }
  const dark = mode === "dark";
  const btn = $("theme-toggle");
  if (btn) {
    const labelText = dark ? "Switch to Day match (light) theme" : "Switch to Night match (dark) theme";
    btn.title = labelText;
    btn.setAttribute("aria-label", labelText);
  }
  if (DATA) {
    drawWorm();
    drawState();
    refreshLiveUI();
    drawResults();
  }
}

function el(tag, attrs, parent, text) {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs || {}) e.setAttribute(k, attrs[k]);
  if (text != null) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const pct = (p) => (p < 0.005 ? "<1" : p > 0.995 ? ">99" : String(Math.round(p * 100)));
const f2 = (x, d = 2) => Number(x).toFixed(d);
const f3 = (x) => Number(x).toFixed(3);
const parseCI = (s) => { const m = /\[(-?[\d.]+),\s*(-?[\d.]+)\]/.exec(s || ""); return m ? [parseFloat(m[1]), parseFloat(m[2])] : null; };
const niceDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
};
const swing = (m) => Math.max(...m.overs.map((o) => o[3])) - Math.min(...m.overs.map((o) => o[3]));

let DATA, MATCHES, cur = null, overIdx = 0;

initTheme();

fetch("site/data/site_data.json")
  .then((r) => { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
  .then(init)
  .catch((e) => {
    const box = $("app-error");
    box.hidden = false;
    box.textContent = "The results file could not be loaded (" + e.message + "). Open this page through GitHub Pages or a local web server (python -m http.server), not by double-clicking the file, and check that site/data/site_data.json exists.";
    $("explorer-box").hidden = true;
  });

function init(d) {
  DATA = d; MATCHES = d.matches;
  fillText(); buildSelect(); wireExplorer(); initLive(); initWhatIf(); drawResults();
  const best = MATCHES.reduce((a, b) => (swing(b) > swing(a) ? b : a));
  pick(best.id, true);
  window.addEventListener("resize", () => { drawResults(); });
}

/* ---------- static text that depends on the data ---------- */
function fillText() {
  const m = DATA.meta, fin = DATA.results.find((r) => /^FINAL/.test(r.name)), rule = DATA.results.find((r) => /^B\b/.test(r.name));
  const seasons = m.test_seasons.length > 1 ? m.test_seasons[0] + " and " + m.test_seasons[m.test_seasons.length - 1] : String(m.test_seasons[0]);
  $("explorer-intro").textContent = "Pick a match from the " + seasons + " seasons, which the model never saw while it was being built. The line is hidden past the over you choose, so you can guess before you look.";
  const ci = parseCI(fin.diff_ci);
  const clear = ci && ci[1] < 0;
  $("results-intro").textContent = "On the " + m.test_matches + " matches of " + seasons + " (" + m.test_rows.toLocaleString() + " over-by-over states), the model's log loss is " + f3(fin.log_loss) + ", against " + f3(rule.log_loss) + " for the run-rate rule. Accuracy is " + Math.round(fin.accuracy * 100) + "% versus " + Math.round(rule.accuracy * 100) + "%.";
  $("results-read").textContent = (clear
    ? "The gap to the rule is " + f3(Math.abs(fin.diff)) + " log loss, and its interval (" + fin.diff_ci + ") stays below zero, so the improvement is unlikely to be luck of the draw. "
    : "The interval for the gap to the rule (" + fin.diff_ci + ") includes zero, so with this few matches the improvement cannot be separated from chance. ")
    + "Every number here counts each match as one unit when estimating uncertainty, because the overs of one match are not independent.";
  const lim = [
    "About " + m.test_matches + " test matches is a small sample. Treat differences of a few hundredths of log loss as noise.",
    "Average first-innings targets were about " + Math.round(m.mean_target_fit) + " in the fitting seasons and about " + Math.round(m.mean_target_test) + " in the test seasons. Scoring keeps rising, so recent games include situations the training data barely covers.",
    "The model sees only the state of the chase. It knows nothing about the pitch, dew, weather or who bowls the next over.",
    "Matches decided by DLS, ties and no-results are left out, so the model is not meant for them.",
    "Home grounds and venue names were mapped by hand and may miss unusual cases such as relocated matches.",
    "A win probability is not advice for betting or for any decision where money is at stake.",
  ];
  $("limits-list").replaceChildren(...lim.map((t) => { const li = document.createElement("li"); li.textContent = t; return li; }));
  const f = $("footer"); f.replaceChildren();
  const p = document.createElement("p");
  p.append("A project for ES 335, Machine Learning" + (m.author ? ", by " + m.author : "") + ". Ball-by-ball data from ");
  const a = document.createElement("a"); a.href = "https://cricsheet.org/"; a.textContent = "Cricsheet"; p.append(a, ". ");
  if (m.repo) { const r = document.createElement("a"); r.href = m.repo; r.textContent = "Code and notebooks"; p.append(r, "."); }
  f.append(p);
}

/* ---------- match explorer ---------- */
function buildSelect() {
  const sel = $("match-select"); sel.replaceChildren();
  const bySeason = {};
  MATCHES.forEach((m) => (bySeason[m.season] = bySeason[m.season] || []).push(m));
  Object.keys(bySeason).sort().forEach((s) => {
    const g = document.createElement("optgroup"); g.label = s;
    bySeason[s].forEach((m) => {
      const o = document.createElement("option"); o.value = m.id;
      o.textContent = niceDate(m.date).replace(/ \d{4}$/, "") + ": " + m.chaser + " chasing " + m.target + " v " + m.bowler;
      g.appendChild(o);
    });
    sel.appendChild(g);
  });
}
function wireExplorer() {
  $("match-select").addEventListener("change", (e) => pick(e.target.value, false));
  $("btn-random").addEventListener("click", () => pick(MATCHES[Math.floor(Math.random() * MATCHES.length)].id, true));
  $("btn-swing").addEventListener("click", () => {
    pick(MATCHES.reduce((a, b) => (swing(b) > swing(a) ? b : a)).id, true);
  });
  $("chk-rule").addEventListener("change", drawWorm);
  $("chk-reveal").addEventListener("change", () => { drawWorm(); drawState(); });
  $("over-slider").addEventListener("input", (e) => { overIdx = +e.target.value - 1; drawWorm(); drawState(); });
  const svg = $("worm");
  const scrub = (ev) => {
    const r = svg.getBoundingClientRect(); const x = ((ev.clientX - r.left) / r.width) * 760;
    const o = clamp(Math.round(xInv(x)), 1, cur.overs.length);
    overIdx = o - 1; $("over-slider").value = o; drawWorm(); drawState();
  };
  let down = false;
  svg.addEventListener("pointerdown", (e) => { down = true; svg.setPointerCapture(e.pointerId); scrub(e); });
  svg.addEventListener("pointermove", (e) => { if (down) scrub(e); });
  svg.addEventListener("pointerup", () => (down = false));
  svg.addEventListener("pointercancel", () => (down = false));
}

function makeTeamBadge(teamName, color) {
  const span = document.createElement("span");
  span.className = "team-name";
  span.style.color = color;
  span.textContent = teamName;
  return span;
}

function pick(id, reset) {
  cur = MATCHES.find((m) => m.id === id);
  $("match-select").value = id;
  const sl = $("over-slider"); sl.max = cur.overs.length;
  overIdx = reset || overIdx >= cur.overs.length ? Math.min(8, cur.overs.length - 1) : overIdx;
  sl.value = overIdx + 1;
  $("chk-reveal").checked = false;
  $("match-sub").textContent = [cur.venue, niceDate(cur.date)].filter(Boolean).join(", ");
  drawWorm(); drawState();
}

const G = { W: 760, H: 360, l: 50, r: 16, t: 16, b: 44 };
const xs = (o) => G.l + (o / 20) * (G.W - G.l - G.r);
const xInv = (x) => ((x - G.l) / (G.W - G.l - G.r)) * 20;
const ys = (p) => G.t + (1 - p) * (G.H - G.t - G.b);

function renderWormSVG(svg, chaser, bowler, chaserColor, bowlerColor, allOvers, upto, showRule, reveal, clipPrefix) {
  svg.replaceChildren();
  const ink = css("--ink"), grid = css("--grid"), ball = css("--ball"), soft = css("--ink-soft");
  const n = allOvers.length;
  const defs = el("defs", {}, svg);
  const up = el("clipPath", { id: clipPrefix + "-up" }, defs); el("rect", { x: 0, y: 0, width: G.W, height: ys(0.5) }, up);
  const dn = el("clipPath", { id: clipPrefix + "-dn" }, defs); el("rect", { x: 0, y: ys(0.5), width: G.W, height: G.H }, dn);
  [0, 0.25, 0.5, 0.75, 1].forEach((p) => {
    el("line", { x1: G.l, x2: G.W - G.r, y1: ys(p), y2: ys(p), stroke: p === 0.5 ? soft : grid, "stroke-width": p === 0.5 ? 1.2 : 1, "stroke-dasharray": p === 0.5 ? "5 4" : "" }, svg);
    el("text", { x: G.l - 8, y: ys(p) + 4, "text-anchor": "end" }, svg, Math.round(p * 100) + "%");
  });
  [0, 5, 10, 15, 20].forEach((o) => el("text", { x: xs(o), y: G.H - G.b + 20, "text-anchor": "middle" }, svg, o));
  el("text", { x: (G.l + G.W - G.r) / 2, y: G.H - 4, "text-anchor": "middle" }, svg, "overs completed");
  el("text", { x: G.l + 8, y: G.t + 16, fill: chaserColor, style: "fill:" + chaserColor + ";font-weight:700" }, svg, chaser + " ahead");
  el("text", { x: G.l + 8, y: G.H - G.b - 8, fill: bowlerColor, style: "fill:" + bowlerColor + ";font-weight:700" }, svg, bowler + " ahead");

  if (!n || upto <= 0) {
    el("text", { x: (G.l + G.W - G.r) / 2, y: ys(0.5) - 10, "text-anchor": "middle" }, svg, "Record Over 1 above to start plotting the live chase trajectory.");
    return;
  }

  const pts = (arr, k) => arr.map((o) => [xs(o[0]), ys(o[k])]);
  const line = (P) => P.map((q, i) => (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1)).join(" ");
  const step = (P) => P.map((q, i) => (i ? "H" + q[0].toFixed(1) + " V" + q[1].toFixed(1) : "M" + q[0].toFixed(1) + " " + q[1].toFixed(1))).join(" ");
  const seen = allOvers.slice(0, upto);

  if (showRule) {
    const rp = pts(seen, 4);
    el("path", { d: step(rp), fill: "none", stroke: soft, "stroke-width": 1.5, "stroke-dasharray": "3 3", opacity: 0.9 }, svg);
  }
  if (reveal && upto < n) {
    el("path", { d: line(pts(allOvers, 3)), fill: "none", stroke: chaserColor, "stroke-width": 2, "stroke-dasharray": "2 5", opacity: 0.55 }, svg);
  }
  const P = pts(seen, 3), y50 = ys(0.5);
  const area = line(P) + " L" + P[P.length - 1][0].toFixed(1) + " " + y50 + " L" + P[0][0].toFixed(1) + " " + y50 + " Z";
  el("path", { d: area, fill: chaserColor, opacity: 0.34, "clip-path": "url(#" + clipPrefix + "-up)" }, svg);
  el("path", { d: area, fill: bowlerColor, opacity: 0.34, "clip-path": "url(#" + clipPrefix + "-dn)" }, svg);
  el("path", { d: line(P), fill: "none", stroke: chaserColor, "stroke-width": 2.8, "stroke-linejoin": "round" }, svg);
  P.forEach((q, idx) => {
    const pVal = seen[idx][3];
    el("circle", { cx: q[0], cy: q[1], r: 3.2, fill: pVal >= 0.5 ? chaserColor : bowlerColor }, svg);
  });

  let prev = 0;
  seen.forEach((o) => {
    for (let k = 0; k < o[2] - prev; k++) el("line", { x1: xs(o[0]) - 4 + k * 5, x2: xs(o[0]) - 4 + k * 5, y1: G.H - G.b - 9, y2: G.H - G.b + 1, stroke: ball, "stroke-width": 2.5, "stroke-linecap": "round" }, svg);
    prev = o[2];
  });
  const c = P[P.length - 1];
  const lastP = seen[seen.length - 1][3];
  const activeCol = lastP >= 0.5 ? chaserColor : bowlerColor;
  el("line", { x1: c[0], x2: c[0], y1: G.t, y2: G.H - G.b, stroke: activeCol, "stroke-width": 1.3, opacity: 0.65 }, svg);
  el("circle", { cx: c[0], cy: c[1], r: 6.5, fill: activeCol, stroke: css("--paper"), "stroke-width": 2 }, svg);
  svg.setAttribute("aria-label", "Win probability for " + chaser + " after each over, shown up to over " + upto + ".");
}

function drawWorm() {
  if (!cur) return;
  const [cCol, bCol] = getMatchColors(cur.chaser, cur.bowler);
  document.documentElement.style.setProperty("--chaser-color", cCol);
  document.documentElement.style.setProperty("--bowler-color", bCol);
  const titleEl = $("match-title");
  titleEl.replaceChildren(
    makeTeamBadge(cur.chaser, cCol),
    document.createTextNode(" chasing " + cur.target + " against "),
    makeTeamBadge(cur.bowler, bCol)
  );
  renderWormSVG($("worm"), cur.chaser, cur.bowler, cCol, bCol, cur.overs, overIdx + 1, $("chk-rule").checked, $("chk-reveal").checked, "clip");
}

function drawState() {
  if (!cur) return;
  const [cCol, bCol] = getMatchColors(cur.chaser, cur.bowler);
  const o = cur.overs[overIdx], [ov, runs, wk, p, pB] = o;
  const need = cur.target - runs, balls = 120 - 6 * ov, rrr = balls > 0 ? (need / balls) * 6 : 0, crr = runs / ov;
  $("slider-label").textContent = "After over " + ov;
  const reveal = $("chk-reveal").checked;
  const s = $("state"); s.replaceChildren();
  const add = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = html; s.appendChild(e); return e; };
  add("div", "over", "After " + ov + " of 20 overs: " + runs + "/" + wk);
  const big = add("div", "big", "");
  big.style.color = p >= 0.5 ? cCol : bCol;
  big.append(pct(p));
  const sm = document.createElement("small"); sm.textContent = "%"; big.append(sm);
  const cap = add("div", "big-cap", "");
  cap.replaceChildren(makeTeamBadge(cur.chaser, cCol), document.createTextNode(" win chance (model)"));
  const sp = document.createElement("div"); sp.className = "split"; sp.style.background = bCol;
  sp.setAttribute("role", "img"); sp.setAttribute("aria-label", pct(p) + " percent for the chasing team");
  const i = document.createElement("i"); i.style.width = (p * 100).toFixed(1) + "%"; i.style.background = cCol; sp.appendChild(i); s.appendChild(sp);
  const dl = document.createElement("dl");
  const row = (k, v) => { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; dl.append(dt, dd); };
  row("Needs", need + " off " + balls + " balls");
  row("Required rate", f2(rrr) + " an over");
  row("Scoring at", f2(crr) + " an over");
  row("Run-rate rule", pB > 0.5 ? "chasing side is on or ahead of the rate" : "chasing side is behind the rate");
  s.appendChild(dl);
  if (reveal) add("div", "result", cur.chaser + (cur.won ? " won the chase." : " lost the chase.") + (cur.won === (p >= 0.5) ? " The model was leaning the right way at this point." : " The model was leaning the wrong way at this point."));
}

/* ---------- live match predictor (full 27-feature model, raw inputs only) ---------- */
const LIVE_STORAGE_KEY = "es335_live_match_v3";
let LIVE = null;

function evalFullModel(featMap, useLive27 = false) {
  const M = (useLive27 && DATA.whatif.live_model) ? DATA.whatif.live_model : DATA.whatif;
  let z = M.intercept;
  M.features.forEach((f, i) => {
    const x = f in featMap && !Number.isNaN(featMap[f]) ? featMap[f] : M.mean[i];
    z += M.coef[i] * ((x - M.mean[i]) / M.scale[i]);
  });
  return 1 / (1 + Math.exp(-z));
}

function computeDLSResources(ballsLeft, wicketsLost) {
  const dls = (DATA && DATA.whatif && DATA.whatif.dls_params) || null;
  if (!dls || ballsLeft <= 0 || wicketsLost >= 10) return 0;
  const w = clamp(Math.round(wicketsLost), 0, 9);
  const z0 = (dls.Z0 && dls.Z0[w]) || 160;
  const b = (dls.b && dls.b[w]) || 0.015;
  const norm = dls.norm_120 || 168;
  const raw = z0 * (1 - Math.exp(-b * ballsLeft));
  return clamp((100 * raw) / norm, 0, 100);
}

function getContextStats(liveState) {
  const venues = (DATA.whatif && DATA.whatif.venues) || {};
  const venuesPar = (DATA.whatif && DATA.whatif.venues_par) || {};
  const recentWins = (DATA.whatif && DATA.whatif.team_recent_wins) || {};
  const teamBowlEcon = (DATA.whatif && DATA.whatif.team_bowl_econ) || {};
  const teamBowlWkt = (DATA.whatif && DATA.whatif.team_bowl_wkt) || {};
  const seasonAvg = (DATA.whatif && DATA.whatif.default_season_avg_target) || 197.4;
  const recentPar = (DATA.whatif && DATA.whatif.default_recent_par) || seasonAvg;
  const venue_rate = venues[liveState.venue] != null ? venues[liveState.venue] : 0.542;
  const venue_par = venuesPar[liveState.venue] != null ? venuesPar[liveState.venue] : recentPar;
  const home_status = detectHomeStatus(liveState.venue, liveState.chaser, liveState.bowler);
  const home_edge = computeHomeEdge(home_status, liveState.chaser, liveState.bowler);
  const chaser_wins = recentWins[liveState.chaser] != null ? recentWins[liveState.chaser] : 3;
  const bowler_wins = recentWins[liveState.bowler] != null ? recentWins[liveState.bowler] : 2;
  const chaser_form = (chaser_wins + 2 * 0.5) / (5 + 2);
  const bowler_form = (bowler_wins + 2 * 0.5) / (5 + 2);
  const target_vs_season_avg = liveState.target - seasonAvg;
  const target_vs_venue_par = liveState.target - venue_par;
  const target_vs_recent_par = liveState.target - recentPar;
  const bowl_rem_econ = teamBowlEcon[liveState.bowler] != null ? teamBowlEcon[liveState.bowler] : 8.3;
  const bowl_rem_wkt_rate = teamBowlWkt[liveState.bowler] != null ? teamBowlWkt[liveState.bowler] : 0.052;
  return {
    venue_rate, venue_par, recent_par: recentPar, home_status, home_edge, season_avg: seasonAvg,
    target_vs_season_avg, target_vs_venue_par, target_vs_recent_par,
    bowl_rem_econ, bowl_rem_wkt_rate,
    chaser_wins, bowler_wins, chaser_form, bowler_form,
    chasing_team_home: home_status === "chaser" ? 1 : 0,
    bowling_team_home: home_status === "bowler" ? 1 : 0,
  };
}

function computeOverPrediction(oversSoFar, overEntry, liveState) {
  const target = liveState.target;
  const xi = liveState.xi;
  const ctx = getContextStats(liveState);
  const ov = overEntry.over;
  const runs = overEntry.runs;
  const wkts = overEntry.wkts;
  const need = Math.max(0, target - runs);
  const balls = 120 - 6 * ov;
  const hand = Math.max(1, 10 - wkts);
  const [pLose, pWin] = DATA.whatif.rule_probs || [0.3651, 0.8496];

  const crr = runs / ov;
  const rawRrr = balls > 0 ? ((target - runs) / balls) * 6 : 0;
  const rrr = balls > 0 ? Math.min(36, Math.max(0, rawRrr)) : 0;
  const rrd = rrr - crr;
  const runs_needed_frac = need / target;
  const resources = balls * (10 - wkts);
  const dls_resources = computeDLSResources(balls, wkts);
  const par_score_diff = runs - target * (1 - dls_resources / 100);
  const runs_needed_per_wicket = need / hand;

  const is_powerplay = ov <= 6 ? 1 : 0;
  const is_death = ov >= 15 ? 1 : 0;
  const powerplay_balls_left = Math.max(0, 36 - 6 * ov);

  const window3 = [...oversSoFar.slice(-2), overEntry];
  const runs_last_3 = window3.reduce((s, x) => s + x.ov_runs, 0);
  const wkts_last_3 = window3.reduce((s, x) => s + x.ov_wkts, 0);
  const bounds_last_3 = window3.reduce((s, x) => s + x.ov_bounds, 0);
  const accel = (runs_last_3 / Math.min(ov, 3)) - crr;

  const battersBpd = (DATA.whatif && DATA.whatif.batters_bpd) || {};
  const battersAvg = (DATA.whatif && DATA.whatif.batters_avg) || {};
  const name1 = (xi[overEntry.bat1] && xi[overEntry.bat1].name) || "";
  const name2 = (xi[overEntry.bat2] && xi[overEntry.bat2].name) || "";
  const sr1 = (xi[overEntry.bat1] && Number(xi[overEntry.bat1].sr)) || 125.0;
  const sr2 = (xi[overEntry.bat2] && Number(xi[overEntry.bat2].sr)) || 125.0;
  const bpd1 = name1 in battersBpd ? Number(battersBpd[name1]) : 18.0;
  const bpd2 = name2 in battersBpd ? Number(battersBpd[name2]) : 18.0;
  const bat_sr_mean = (sr1 + sr2) / 2;
  const bat_bpd_mean = (bpd1 + bpd2) / 2;
  const b1 = Number(overEntry.bat1_balls) || 0;
  const b2 = Number(overEntry.bat2_balls) || 0;
  const bat_balls_sum = b1 + b2;
  const bat_balls_max = Math.max(b1, b2);
  const bat_runs_sum = Math.min(runs, Math.round((b1 * sr1 + b2 * sr2) / 100));
  const settled_sr_interaction = (bat_balls_max * bat_sr_mean) / 100;

  const seenIdx = new Set([overEntry.bat1, overEntry.bat2]);
  for (let k = 0; k < Math.min(12, wkts + 2); k++) seenIdx.add(k);
  oversSoFar.forEach((x) => { seenIdx.add(x.bat1); seenIdx.add(x.bat2); });
  const unbatted = [];
  const maxSquadIdx = overEntry.imp_chase ? 12 : 11;
  for (let idx = 0; idx < maxSquadIdx; idx++) {
    if (!seenIdx.has(idx) && xi[idx]) {
      const nm = xi[idx].name || "";
      const avg = nm in battersAvg ? Number(battersAvg[nm]) : 22.5;
      const sr = Number(xi[idx].sr) || 125.0;
      unbatted.push({ avg, sr });
    }
  }
  unbatted.sort((a, b) => b.avg - a.avg);
  const rem_bat_n = Math.max(0, 9 - wkts);
  const top3 = unbatted.slice(0, Math.min(3, rem_bat_n));
  const rem_bat_quality = top3.reduce((s, x) => s + x.avg, 0);
  const rem_bat_sr = top3.length ? top3.reduce((s, x) => s + x.sr, 0) / top3.length : 110.0;

  const remOvers = Math.max(0, 20 - ov);
  const best_bowler_overs_left = Math.min(8, Math.round(remOvers * 0.42 * 10) / 10);
  const bowl_rem_econ = ctx.bowl_rem_econ;
  const bowl_rem_wkt_rate = ctx.bowl_rem_wkt_rate;

  const feats = {
    runs_so_far: runs,
    target: target,
    target_vs_venue_par: ctx.target_vs_venue_par,
    target_vs_recent_par: ctx.target_vs_recent_par,
    wickets_lost: wkts,
    balls_left: balls,
    current_run_rate: crr,
    required_run_rate: rrr,
    run_rate_diff: rrd,
    runs_needed_frac: runs_needed_frac,
    resources: resources,
    dls_resources: dls_resources,
    par_score_diff: par_score_diff,
    runs_needed_per_wicket: runs_needed_per_wicket,
    is_powerplay: is_powerplay,
    is_death: is_death,
    powerplay_balls_left: powerplay_balls_left,
    runs_last_3: runs_last_3,
    wkts_last_3: wkts_last_3,
    boundaries_last_3: bounds_last_3,
    acceleration: accel,
    balls_since_last_wicket: overEntry.bslw,
    bat_sr_mean: bat_sr_mean,
    bat_bpd_mean: bat_bpd_mean,
    bat_balls_sum: bat_balls_sum,
    bat_balls_max: bat_balls_max,
    bat_runs_sum: bat_runs_sum,
    settled_sr_interaction: settled_sr_interaction,
    rem_bat_n: rem_bat_n,
    rem_bat_quality: rem_bat_quality,
    rem_bat_sr: rem_bat_sr,
    bowl_rem_econ: bowl_rem_econ,
    bowl_rem_wkt_rate: bowl_rem_wkt_rate,
    best_bowler_overs_left: best_bowler_overs_left,
    chasing_impact_used: overEntry.imp_chase ? 1 : 0,
    bowling_impact_used: overEntry.imp_bowl ? 1 : 0,
    target_vs_season_avg: ctx.target_vs_season_avg,
    venue_chase_rate: ctx.venue_rate,
    chasing_team_home: ctx.chasing_team_home,
    bowling_team_home: ctx.bowling_team_home,
    home_edge: ctx.home_edge,
    chaser_form: ctx.chaser_form,
    bowler_form: ctx.bowler_form,
  };

  if (target - runs <= 0) {
    return { p: 1.0, pB: 1.0, rrr: 0, crr, rrd: -crr, need: 0, balls, resources, dls_resources, par_score_diff, runs_needed_frac: 0, runs_needed_per_wicket: 0, is_powerplay, is_death, powerplay_balls_left, runs_last_3, wkts_last_3, bounds_last_3, accel, bat_sr_mean, bat_bpd_mean, bat_balls_sum, bat_balls_max, bat_runs_sum, settled_sr_interaction, rem_bat_n, rem_bat_quality, rem_bat_sr, bowl_rem_econ, bowl_rem_wkt_rate, best_bowler_overs_left, ctx, decided: "won" };
  }
  if (wkts >= 10 || balls <= 0) {
    return { p: 0.0, pB: 0.0, rrr: rawRrr, crr, rrd, need, balls, resources: 0, dls_resources: 0, par_score_diff: runs - target, runs_needed_frac, runs_needed_per_wicket, is_powerplay, is_death, powerplay_balls_left: 0, runs_last_3, wkts_last_3, bounds_last_3, accel, bat_sr_mean, bat_bpd_mean, bat_balls_sum, bat_balls_max, bat_runs_sum, settled_sr_interaction, rem_bat_n: 0, rem_bat_quality: 0, rem_bat_sr, bowl_rem_econ, bowl_rem_wkt_rate, best_bowler_overs_left: 0, ctx, decided: "lost" };
  }

  const p = evalFullModel(feats, true);
  const pB = rrd <= 0 ? pWin : pLose;
  return { p, pB, rrr: rawRrr, crr, rrd, need, balls, resources, dls_resources, par_score_diff, runs_needed_frac, runs_needed_per_wicket, is_powerplay, is_death, powerplay_balls_left, runs_last_3, wkts_last_3, bounds_last_3, accel, bat_sr_mean, bat_bpd_mean, bat_balls_sum, bat_balls_max, bat_runs_sum, settled_sr_interaction, rem_bat_n, rem_bat_quality, rem_bat_sr, bowl_rem_econ, bowl_rem_wkt_rate, best_bowler_overs_left, ctx, decided: null };
}

function defaultTeamXI(teamName) {
  const rosters = (DATA.whatif && DATA.whatif.rosters) || {};
  const batters = (DATA.whatif && DATA.whatif.batters) || {};
  const list = rosters[teamName] || [];
  const xi = [];
  for (let i = 0; i < 12; i++) {
    const name = list[i] || ("Batter " + (i + 1));
    const sr = name in batters ? batters[name] : 125.0;
    xi.push({ name, sr });
  }
  return xi;
}

function detectHomeStatus(venue, chaser, bowler) {
  const hv = (DATA.whatif && DATA.whatif.team_home_venues) || {};
  if ((hv[chaser] || []).includes(venue)) return "chaser";
  if ((hv[bowler] || []).includes(venue)) return "bowler";
  return "neutral";
}

function computeHomeEdge(status, chaser, bowler) {
  const edges = (DATA.whatif && DATA.whatif.team_home_edge) || {};
  if (status === "chaser") return Number(edges[chaser] || 0);
  if (status === "bowler") return -Number(edges[bowler] || 0);
  return 0;
}

function saveLiveState() {
  try { localStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify(LIVE)); } catch (_) {}
}

function recomputeAllLiveOvers() {
  let cumRuns = 0, cumWkts = 0, bslw = 0;
  const ballsByBatter = new Array(12).fill(0);
  const updated = [];
  for (const o of LIVE.overs) {
    cumRuns += o.ov_runs;
    cumWkts = clamp(cumWkts + o.ov_wkts, 0, 10);
    if (o.ov_wkts === 0) {
      bslw += 6;
      ballsByBatter[o.bat1] = (ballsByBatter[o.bat1] || 0) + 3;
      ballsByBatter[o.bat2] = (ballsByBatter[o.bat2] || 0) + 3;
    } else {
      bslw = 3;
      ballsByBatter[o.bat1] = (ballsByBatter[o.bat1] || 0) + (o.ov_wkts === 1 ? 4 : 2);
      ballsByBatter[o.bat2] = (ballsByBatter[o.bat2] || 0) + 2;
    }
    const entry = {
      ...o,
      runs: cumRuns,
      wkts: cumWkts,
      bslw,
      bat1_balls: ballsByBatter[o.bat1] || 0,
      bat2_balls: ballsByBatter[o.bat2] || 0,
      imp_chase: (o.imp_chase || o.bat1 === 11 || o.bat2 === 11) ? 1 : 0,
    };
    const res = computeOverPrediction(updated, entry, LIVE);
    Object.assign(entry, res);
    updated.push(entry);
  }
  LIVE.overs = updated;
  LIVE._ballsByBatter = ballsByBatter;
  LIVE._bslw = bslw;
  saveLiveState();
}

function syncContextControls() {
  $("live-chaser").value = LIVE.chaser;
  $("live-bowler").value = LIVE.bowler;
  $("live-venue").value = LIVE.venue;
  $("live-target").value = LIVE.target;
}

function initLive() {
  const batters = (DATA.whatif && DATA.whatif.batters) || {};
  const rosters = (DATA.whatif && DATA.whatif.rosters) || {};
  const venues = (DATA.whatif && DATA.whatif.venues) || {};
  const homeVenues = (DATA.whatif && DATA.whatif.team_home_venues) || {};
  const teams = Object.keys(rosters).sort();
  const venueNames = Object.keys(venues).sort();

  const dl = $("ipl-batters");
  dl.replaceChildren();
  Object.keys(batters).sort().forEach((name) => {
    const opt = document.createElement("option");
    opt.value = name;
    dl.appendChild(opt);
  });

  const selC = $("live-chaser"), selB = $("live-bowler"), selV = $("live-venue");
  selC.replaceChildren(); selB.replaceChildren(); selV.replaceChildren();
  teams.forEach((t) => {
    const o1 = document.createElement("option"); o1.value = t; o1.textContent = t; selC.appendChild(o1);
    const o2 = document.createElement("option"); o2.value = t; o2.textContent = t; selB.appendChild(o2);
  });
  venueNames.forEach((v) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = v;
    selV.appendChild(o);
  });

  let loaded = null;
  try { loaded = JSON.parse(localStorage.getItem(LIVE_STORAGE_KEY) || "null"); } catch (_) {}
  if (loaded && loaded.xi && Array.isArray(loaded.xi) && loaded.xi.length === 12 && loaded.venue) {
    LIVE = loaded;
  } else {
    const defC = teams.includes("Royal Challengers Bengaluru") ? "Royal Challengers Bengaluru" : (teams[0] || "Chasing Team");
    const defB = teams.includes("Chennai Super Kings") ? "Chennai Super Kings" : (teams[1] || "Bowling Team");
    const defV = (homeVenues[defC] && homeVenues[defC][0]) || venueNames[0] || "M Chinnaswamy Stadium, Bengaluru";
    LIVE = {
      chaser: defC,
      bowler: defB,
      venue: defV,
      target: 185,
      xi: defaultTeamXI(defC),
      overs: [],
    };
  }

  syncContextControls();
  renderXIGrid();
  syncCreaseDropdowns();
  recomputeAllLiveOvers();
  prepareNextOverForm();
  refreshLiveUI();

  selC.addEventListener("change", () => {
    LIVE.chaser = selC.value;
    if (LIVE.overs.length === 0) {
      LIVE.xi = defaultTeamXI(LIVE.chaser);
      renderXIGrid();
      syncCreaseDropdowns();
    }
    recomputeAllLiveOvers();
    refreshLiveUI();
  });
  selB.addEventListener("change", () => {
    LIVE.bowler = selB.value;
    recomputeAllLiveOvers();
    refreshLiveUI();
  });
  selV.addEventListener("change", () => {
    LIVE.venue = selV.value;
    recomputeAllLiveOvers();
    refreshLiveUI();
  });
  $("live-target").addEventListener("input", () => {
    LIVE.target = clamp(+$("live-target").value || 185, 1, 400);
    recomputeAllLiveOvers();
    refreshLiveUI();
  });
  $("btn-load-xi").addEventListener("click", () => {
    LIVE.xi = defaultTeamXI(LIVE.chaser);
    renderXIGrid();
    syncCreaseDropdowns();
    recomputeAllLiveOvers();
    refreshLiveUI();
  });
  $("btn-reset-live").addEventListener("click", () => {
    LIVE.overs = [];
    recomputeAllLiveOvers();
    prepareNextOverForm();
    refreshLiveUI();
  });
  $("lo-wkts").addEventListener("change", onOverWicketsChanged);
  ["lo-runs", "lo-wkts", "lo-bounds", "lo-bat1", "lo-bat2", "lo-imp-chase", "lo-imp-bowl"].forEach((id) => {
    $(id).addEventListener("input", updateLiveFormPreview);
  });
  $("btn-add-over").addEventListener("click", recordNextOver);
  $("btn-undo-over").addEventListener("click", () => {
    if (!LIVE.overs.length) return;
    LIVE.overs.pop();
    recomputeAllLiveOvers();
    prepareNextOverForm();
    refreshLiveUI();
  });
}

function renderXIGrid() {
  const batters = (DATA.whatif && DATA.whatif.batters) || {};
  const grid = $("live-xi-grid");
  grid.replaceChildren();
  LIVE.xi.forEach((slot, idx) => {
    const row = document.createElement("div");
    row.className = "xi-slot";
    const num = document.createElement("span");
    num.className = "slot-num";
    num.textContent = idx < 11 ? "#" + (idx + 1) : "IMP";
    num.title = idx < 11 ? "Batting position " + (idx + 1) : "12th man / Impact Player substitute";

    const nameIn = document.createElement("input");
    nameIn.type = "text";
    nameIn.setAttribute("list", "ipl-batters");
    nameIn.value = slot.name;
    nameIn.placeholder = idx < 11 ? "Batter " + (idx + 1) : "Impact Player";
    nameIn.setAttribute("aria-label", (idx < 11 ? "Batter " + (idx + 1) : "Impact Player") + " name");

    const srTag = document.createElement("span");
    srTag.className = "sr-tag";
    srTag.textContent = "SR " + Number(slot.sr).toFixed(1);

    nameIn.addEventListener("input", () => {
      slot.name = nameIn.value.trim() || ("Batter " + (idx + 1));
      slot.sr = slot.name in batters ? batters[slot.name] : 125.0;
      srTag.textContent = "SR " + Number(slot.sr).toFixed(1);
      syncCreaseDropdowns();
      recomputeAllLiveOvers();
      refreshLiveUI();
    });

    row.append(num, nameIn, srTag);
    grid.appendChild(row);
  });
}

function syncCreaseDropdowns() {
  const b1 = $("lo-bat1"), b2 = $("lo-bat2");
  const v1 = b1.value !== "" ? +b1.value : 0;
  const v2 = b2.value !== "" ? +b2.value : 1;
  [b1, b2].forEach((sel) => {
    sel.replaceChildren();
    LIVE.xi.forEach((slot, idx) => {
      const o = document.createElement("option");
      o.value = idx;
      o.textContent = (idx < 11 ? "#" + (idx + 1) : "IMP") + " " + slot.name;
      sel.appendChild(o);
    });
  });
  b1.value = clamp(v1, 0, 11);
  b2.value = clamp(v2, 0, 11);
}

function prepareNextOverForm() {
  const nextOv = LIVE.overs.length + 1;
  if (nextOv === 1) {
    $("lo-runs").value = 8;
    $("lo-wkts").value = 0;
    $("lo-bounds").value = 1;
    $("lo-bat1").value = 0;
    $("lo-bat2").value = 1;
    $("lo-imp-chase").checked = false;
    $("lo-imp-bowl").checked = false;
  } else {
    const prev = LIVE.overs[LIVE.overs.length - 1];
    $("lo-runs").value = 8;
    $("lo-wkts").value = 0;
    $("lo-bounds").value = 1;
    $("lo-bat1").value = prev.bat1;
    $("lo-bat2").value = prev.bat2;
    $("lo-imp-chase").checked = !!prev.imp_chase;
    $("lo-imp-bowl").checked = !!prev.imp_bowl;
  }
}

function onOverWicketsChanged() {
  const w = clamp(+$("lo-wkts").value || 0, 0, 10);
  const prev = LIVE.overs.length ? LIVE.overs[LIVE.overs.length - 1] : null;
  const prevWkts = prev ? prev.wkts : 0;
  if (w === 0) {
    if (prev) {
      $("lo-bat1").value = prev.bat1;
      $("lo-bat2").value = prev.bat2;
    } else {
      $("lo-bat1").value = 0;
      $("lo-bat2").value = 1;
    }
  } else {
    const nextBatterIdx = clamp(prevWkts + w + 1, 2, 11);
    if (w === 1) {
      $("lo-bat2").value = nextBatterIdx;
    } else {
      $("lo-bat1").value = clamp(prevWkts + w, 2, 11);
      $("lo-bat2").value = nextBatterIdx;
    }
  }
  updateLiveFormPreview();
}

function buildDraftOverEntry() {
  const nextOv = LIVE.overs.length + 1;
  const prev = LIVE.overs.length ? LIVE.overs[LIVE.overs.length - 1] : { runs: 0, wkts: 0, bslw: 0 };
  const ov_runs = clamp(+$("lo-runs").value || 0, 0, 60);
  const ov_wkts = clamp(+$("lo-wkts").value || 0, 0, 10 - prev.wkts);
  const ov_bounds = clamp(+$("lo-bounds").value || 0, 0, 10);
  const bat1 = clamp(+$("lo-bat1").value || 0, 0, 11);
  const bat2 = clamp(+$("lo-bat2").value || 0, 0, 11);
  const imp_chase = ($("lo-imp-chase").checked || bat1 === 11 || bat2 === 11) ? 1 : 0;
  const imp_bowl = $("lo-imp-bowl").checked ? 1 : 0;

  const baseBalls = (LIVE._ballsByBatter || new Array(12).fill(0)).slice();
  let bslw;
  if (ov_wkts === 0) {
    bslw = prev.bslw + 6;
    baseBalls[bat1] = (baseBalls[bat1] || 0) + 3;
    baseBalls[bat2] = (baseBalls[bat2] || 0) + 3;
  } else {
    bslw = 3;
    baseBalls[bat1] = (baseBalls[bat1] || 0) + (ov_wkts === 1 ? 4 : 2);
    baseBalls[bat2] = (baseBalls[bat2] || 0) + 2;
  }

  const entry = {
    over: nextOv, ov_runs, ov_wkts, ov_bounds,
    runs: prev.runs + ov_runs, wkts: prev.wkts + ov_wkts, bslw,
    bat1, bat2, bat1_balls: baseBalls[bat1], bat2_balls: baseBalls[bat2], imp_chase, imp_bowl,
  };
  const res = computeOverPrediction(LIVE.overs, entry, LIVE);
  return Object.assign(entry, res);
}

function isChaseFinished() {
  if (!LIVE.overs.length) return false;
  const last = LIVE.overs[LIVE.overs.length - 1];
  return !!last.decided || last.over >= 19;
}

function updateLiveFormPreview() {
  const hint = $("live-form-hint");
  if (!LIVE || isChaseFinished()) {
    hint.textContent = "";
    return;
  }
  const draft = buildDraftOverEntry();
  hint.textContent = "Preview after Over " + draft.over + ": " + draft.runs + "/" + draft.wkts + " — Model win chance: " + pct(draft.p) + "%";
}

function recordNextOver() {
  if (isChaseFinished()) return;
  const entry = buildDraftOverEntry();
  LIVE.overs.push(entry);
  if (LIVE.overs.length === 1) {
    $("live-setup-box").open = false;
  }
  recomputeAllLiveOvers();
  prepareNextOverForm();
  refreshLiveUI();
}

function refreshLiveUI() {
  if (!LIVE) return;
  const [cCol, bCol] = getMatchColors(LIVE.chaser, LIVE.bowler);
  document.documentElement.style.setProperty("--live-chaser-color", cCol);
  document.documentElement.style.setProperty("--live-bowler-color", bCol);

  const finished = isChaseFinished();
  const nextOv = LIVE.overs.length + 1;
  $("btn-undo-over").disabled = LIVE.overs.length === 0;
  $("btn-add-over").disabled = finished;

  if (finished) {
    const last = LIVE.overs[LIVE.overs.length - 1];
    $("live-over-title").textContent = last.decided === "won"
      ? "Chase complete — " + LIVE.chaser + " won!"
      : last.decided === "lost"
      ? "Chase complete — " + LIVE.bowler + " won!"
      : "19 overs logged (end of over-by-over predictions)";
    $("btn-add-over").textContent = "Chase complete";
  } else {
    $("live-over-title").textContent = "Update after Over " + nextOv + " (target " + LIVE.target + ")";
    $("btn-add-over").textContent = "Record Over " + nextOv + " & Predict";
  }

  updateLiveFormPreview();
  drawLiveWorm();
  drawLiveState();
  drawLiveLog();
}

function drawLiveWorm() {
  const svg = $("live-worm");
  if (!svg || !LIVE) return;
  const [cCol, bCol] = getMatchColors(LIVE.chaser, LIVE.bowler);
  const wormOvers = LIVE.overs.map((o) => [o.over, o.runs, o.wkts, o.p, o.pB]);
  renderWormSVG(svg, LIVE.chaser, LIVE.bowler, cCol, bCol, wormOvers, wormOvers.length, true, false, "live-clip");
}

function drawLiveState() {
  const s = $("live-state");
  if (!s || !LIVE) return;
  s.replaceChildren();
  const [cCol, bCol] = getMatchColors(LIVE.chaser, LIVE.bowler);
  const add = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = txt; s.appendChild(e); return e; };

  const o = LIVE.overs.length ? LIVE.overs[LIVE.overs.length - 1] : buildDraftOverEntry();
  const ctx = o.ctx || getContextStats(LIVE);
  const homeLabel = ctx.home_status === "chaser" ? (LIVE.chaser + " home")
    : ctx.home_status === "bowler" ? (LIVE.bowler + " home") : "Neutral";
  const diffStr = (ctx.target_vs_season_avg >= 0 ? "+" : "") + f2(ctx.target_vs_season_avg, 1);

  const b1 = LIVE.xi[o.bat1] || { name: "Batter 1", sr: 125 };
  const b2 = LIVE.xi[o.bat2] || { name: "Batter 2", sr: 125 };

  add("div", "over", LIVE.overs.length === 0
    ? "Preview after Over 1: " + o.runs + "/" + o.wkts + " (target " + LIVE.target + ")"
    : "After " + o.over + " of 20 overs: " + o.runs + "/" + o.wkts + " (target " + LIVE.target + ")");
  const big = add("div", "big", "");
  big.style.color = o.p >= 0.5 ? cCol : bCol;
  big.append(pct(o.p));
  const sm = document.createElement("small"); sm.textContent = "%"; big.append(sm);
  const cap = add("div", "big-cap", "");
  cap.replaceChildren(
    makeTeamBadge(LIVE.chaser, cCol),
    document.createTextNode(LIVE.overs.length === 0 ? " preview win chance" : " win chance (model)")
  );
  const sp = document.createElement("div"); sp.className = "split"; sp.style.background = bCol;
  const i = document.createElement("i"); i.style.width = (o.p * 100).toFixed(1) + "%"; i.style.background = cCol; sp.appendChild(i); s.appendChild(sp);

  add("h3", "", "Computed statistics");
  const dl = document.createElement("dl");
  const row = (k, v) => { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; dl.append(dt, dd); };
  const parDiffStr = (o.par_score_diff >= 0 ? "+" : "") + f2(o.par_score_diff, 1);
  const vParDiffStr = (ctx.target_vs_venue_par >= 0 ? "+" : "") + f2(ctx.target_vs_venue_par, 1);
  const phaseLabel = o.is_powerplay ? ("Powerplay (" + o.powerplay_balls_left + "b left)") : o.is_death ? "Death overs (15-20)" : "Middle overs (7-14)";
  row("Needs", o.need + " off " + o.balls + " balls (" + Math.round(o.runs_needed_frac * 100) + "% of target)");
  row("Current / req. rate", f2(o.crr) + " / " + f2(o.rrr) + " (gap " + (o.rrd >= 0 ? "+" : "") + f2(o.rrd) + ")");
  row("DLS resources & par", f2(o.dls_resources, 1) + "% left | " + parDiffStr + " vs DLS par (" + f2(o.runs_needed_per_wicket, 1) + " R/wkt)");
  row("Match phase", phaseLabel);
  row("Last 3 overs", o.runs_last_3 + "R, " + o.wkts_last_3 + "W, " + o.bounds_last_3 + "x4/6 (accel " + (o.accel >= 0 ? "+" : "") + f2(o.accel) + ")");
  row("Partnership", o.bslw + "b since wkt | Est. " + o.bat_runs_sum + "R at crease");
  row("At the crease", b1.name + " (" + o.bat1_balls + "b, SR " + f2(b1.sr, 1) + ") & " + b2.name + " (" + o.bat2_balls + "b, SR " + f2(b2.sr, 1) + ")");
  row("Batter metrics", "Mean SR " + f2(o.bat_sr_mean, 1) + " | BPD " + f2(o.bat_bpd_mean, 1) + " | Settled x SR " + f2(o.settled_sr_interaction, 1));
  row("Dugout depth", o.rem_bat_n + " batters left | Top-3 avg sum " + f2(o.rem_bat_quality, 1) + " (SR " + f2(o.rem_bat_sr, 1) + ")");
  row("Bowling attack", "Rem. econ " + f2(o.bowl_rem_econ, 2) + " | Top-2 overs left " + f2(o.best_bowler_overs_left, 1));
  row("Venue record", LIVE.venue.split(",")[0] + " (chase win " + f2(ctx.venue_rate * 100, 1) + "%)");
  row("Home edge", homeLabel + " (" + (ctx.home_edge >= 0 ? "+" : "") + f2(ctx.home_edge, 3) + ")");
  row("Target vs par", vParDiffStr + " vs venue par (" + f2(ctx.venue_par, 1) + ") | " + diffStr + " vs season avg");
  row("Team form (last 5)", "Chaser " + f2(ctx.chaser_form, 2) + " (" + ctx.chaser_wins + "/5), Bowler " + f2(ctx.bowler_form, 2) + " (" + ctx.bowler_wins + "/5)");
  row("Run-rate rule", o.pB > 0.5 ? "Ahead/on rate (" + pct(o.pB) + "%)" : "Behind rate (" + pct(o.pB) + "%)");
  s.appendChild(dl);
}

function drawLiveLog() {
  const wrap = $("live-log-wrap"), body = $("live-log-body");
  if (!wrap || !body || !LIVE) return;
  if (LIVE.overs.length === 0) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  body.replaceChildren();
  const [cCol, bCol] = getMatchColors(LIVE.chaser, LIVE.bowler);
  LIVE.overs.slice().reverse().forEach((o) => {
    const tr = document.createElement("tr");
    const b1 = (LIVE.xi[o.bat1] && LIVE.xi[o.bat1].name) || ("#" + (o.bat1 + 1));
    const b2 = (LIVE.xi[o.bat2] && LIVE.xi[o.bat2].name) || ("#" + (o.bat2 + 1));
    const cells = [
      "Over " + o.over,
      o.ov_runs + " runs, " + o.ov_wkts + " wkt (" + o.ov_bounds + "x4/6)",
      o.runs + "/" + o.wkts + " (need " + o.need + " off " + o.balls + "b)",
      b1 + " (" + o.bat1_balls + "b), " + b2 + " (" + o.bat2_balls + "b)",
      o.runs_last_3 + "R / " + o.wkts_last_3 + "W",
      f2(o.rrr),
      pct(o.pB) + "%",
      pct(o.p) + "%",
    ];
    cells.forEach((c, idx) => {
      const td = document.createElement("td");
      if (idx === 7) {
        td.style.fontWeight = "700";
        td.style.color = o.p >= 0.5 ? cCol : bCol;
      }
      td.textContent = c;
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}

/* ---------- what if ---------- */
let WI;
function initWhatIf() {
  WI = DATA.whatif;
  const [tmin, tmax] = WI.target_range;
  const t = $("wi-target"); t.min = Math.max(60, tmin); t.max = tmax; t.value = Math.round(DATA.meta.mean_target_fit || 175);
  ["wi-target", "wi-over", "wi-runs", "wi-wkts"].forEach((id) => $(id).addEventListener("input", drawWhatIf));
  $("wi-note").textContent = WI.same_as_final_model
    ? "This is the final model. Inputs you cannot set here (" + (WI.held_at_average.length ? WI.held_at_average.map(label).join(", ").toLowerCase() : "venue par") + ") are held at their training average. Use the Live match predictor above to evaluate all 39 features."
    : "This panel uses a simpler logistic regression on the core and derived features, not the final model, so numbers can differ a little from the explorer.";
  drawWhatIf();
}
function wiProb(target, over, runs, wk) {
  const balls = 120 - 6 * over, need = target - runs, hand = 10 - wk;
  const rrr = Math.min(36, (need / balls) * 6), crr = runs / over;
  const dls_resources = computeDLSResources(balls, wk);
  const par_score_diff = runs - target * (1 - dls_resources / 100);
  const defaultPar = (DATA && DATA.whatif && DATA.whatif.default_recent_par) || (DATA && DATA.meta && DATA.meta.mean_target_fit) || 170;
  const v = {
    runs_so_far: runs, target, target_vs_venue_par: target - defaultPar, wickets_lost: wk, balls_left: balls,
    current_run_rate: crr, required_run_rate: rrr, run_rate_diff: rrr - crr, runs_needed_frac: need / target,
    resources: balls * hand, dls_resources, par_score_diff, runs_needed_per_wicket: need / hand,
  };
  const p = evalFullModel(v, false);
  return { p, need, balls, rrr: need / balls * 6, crr, ahead: crr >= need / balls * 6 };
}
function drawWhatIf() {
  const target = +$("wi-target").value, over = +$("wi-over").value, wk = +$("wi-wkts").value;
  const rs = $("wi-runs"); rs.min = 0; rs.max = target - 1;
  let runs = clamp(+rs.value || 0, 0, target - 1);
  if (!rs.dataset.init) { runs = Math.round((target / 20) * over * 0.95); rs.dataset.init = "1"; }
  rs.value = runs;
  $("o-target").textContent = target; $("o-over").textContent = over; $("o-runs").textContent = runs; $("o-wkts").textContent = wk;
  const r = wiProb(target, over, runs, wk);
  const s = $("wi-out"); s.replaceChildren();
  const add = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = txt; s.appendChild(e); return e; };
  const big = add("div", "big", "");
  big.style.color = r.p >= 0.5 ? css("--outfield") : css("--dusk");
  big.append(pct(r.p));
  const sm = document.createElement("small"); sm.textContent = "%"; big.append(sm);
  add("div", "big-cap", "chance the chasing team wins");
  const sp = document.createElement("div"); sp.className = "split"; sp.style.background = css("--dusk");
  const i = document.createElement("i"); i.style.width = (r.p * 100).toFixed(1) + "%"; i.style.background = css("--outfield"); sp.appendChild(i); s.appendChild(sp);
  const dl = document.createElement("dl");
  const row = (k, v) => { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; dl.append(dt, dd); };
  row("Needs", r.need + " off " + r.balls + " balls");
  row("Required rate", f2(r.rrr) + " an over");
  row("Scoring at", f2(r.crr) + " an over");
  row("Run-rate rule", r.ahead ? "on or ahead of the rate" : "behind the rate");
  s.appendChild(dl);
}

/* ---------- results ---------- */
function drawResults() {
  if (!DATA) return;
  const t = $("results-table");
  const cap = t.querySelector("caption"); t.replaceChildren(cap);
  const head = document.createElement("thead"), hr = document.createElement("tr");
  ["Model", "Log loss", "95% interval", "Accuracy", "Gap to rule (95% interval)"].forEach((h) => { const th = document.createElement("th"); th.scope = "col"; th.textContent = h; hr.appendChild(th); });
  head.appendChild(hr); t.insertBefore(head, cap.nextSibling);
  const body = document.createElement("tbody");
  DATA.results.forEach((r) => {
    const tr = document.createElement("tr"); if (/^FINAL/.test(r.name)) tr.className = "final";
    const MODELS = { logreg: "logistic regression", hgb: "gradient-boosted trees" };
    const name = /^FINAL/.test(r.name) ? "Final model: " + (MODELS[DATA.meta.model] || DATA.meta.model)
      : /^\(ref\)/.test(r.name) ? "Same model, fitted on the training seasons only"
      : /^A2/.test(r.name) ? "Guess by over" : /^A\b/.test(r.name) ? "Constant guess" : /^B\b/.test(r.name) ? "Run-rate rule" : r.name;
    [name, f3(r.log_loss), r.ci, Math.round(r.accuracy * 100) + "%", r.diff == null ? "-" : (r.diff > 0 ? "+" : "") + f3(r.diff) + " " + r.diff_ci].forEach((v) => { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); });
    body.appendChild(tr);
  });
  t.insertBefore(body, cap);
  drawCal(); drawByOver(); drawImp();
}
function frame(svg, xl, yl, xmax, ymax, ticksX, ticksY, fmtY) {
  const W = 380, H = 340, l = 46, r = 12, t = 14, b = 44;
  const grid = css("--grid");
  const X = (v) => l + (v / xmax) * (W - l - r), Y = (v) => t + (1 - v / ymax) * (H - t - b);
  ticksY.forEach((v) => { el("line", { x1: l, x2: W - r, y1: Y(v), y2: Y(v), stroke: grid }, svg); el("text", { x: l - 6, y: Y(v) + 4, "text-anchor": "end" }, svg, fmtY(v)); });
  ticksX.forEach((v) => el("text", { x: X(v), y: H - b + 18, "text-anchor": "middle" }, svg, v));
  el("text", { x: (l + W - r) / 2, y: H - 6, "text-anchor": "middle" }, svg, xl);
  el("text", { x: 12, y: (t + H - b) / 2, "text-anchor": "middle", transform: "rotate(-90 12 " + (t + H - b) / 2 + ")" }, svg, yl);
  return { X, Y, W, H, l, r, t, b };
}
function drawCal() {
  const svg = $("cal"); svg.replaceChildren();
  const f = frame(svg, "Predicted chance", "Share of chases won", 1, 1, [0, 0.25, 0.5, 0.75, 1], [0, 0.25, 0.5, 0.75, 1], (v) => Math.round(v * 100) + "%");
  el("line", { x1: f.X(0), y1: f.Y(0), x2: f.X(1), y2: f.Y(1), stroke: css("--ink-soft"), "stroke-dasharray": "5 4" }, svg);
  const rule = DATA.calibration.rule;
  rule.forEach((q) => el("rect", { x: f.X(q[0]) - 5, y: f.Y(q[1]) - 5, width: 10, height: 10, fill: "none", stroke: css("--ink-soft"), "stroke-width": 2 }, svg));
  const m = DATA.calibration.model;
  el("path", { d: m.map((q, i) => (i ? "L" : "M") + f.X(q[0]).toFixed(1) + " " + f.Y(q[1]).toFixed(1)).join(" "), fill: "none", stroke: css("--outfield"), "stroke-width": 2.5 }, svg);
  m.forEach((q) => el("circle", { cx: f.X(q[0]), cy: f.Y(q[1]), r: 4.5, fill: css("--outfield") }, svg));
  el("text", { x: f.X(0.55), y: f.Y(0.18), style: "fill:" + css("--outfield") + ";font-weight:600" }, svg, "Model");
  el("text", { x: f.X(0.55), y: f.Y(0.1), style: "fill:" + css("--ink-soft") }, svg, "Squares: run-rate rule");
  const s = DATA.meta.calibration_slope;
  $("cal-cap").textContent = "On the diagonal means a stated 70% wins about 70% of the time. The calibration slope is " + f2(s) + " (1 is ideal; " + (s < 0.9 ? "this means the model is too confident" : s > 1.1 ? "this means the model is a little cautious" : "this is close to ideal") + ").";
}
function drawByOver() {
  const svg = $("byover"); svg.replaceChildren();
  const d = DATA.by_over, ymax = Math.max(0.8, Math.ceil(Math.max(...d.map((x) => Math.max(x.rule, x.model, x.by_over))) * 10) / 10);
  const f = frame(svg, "Overs completed", "Log loss", 20, ymax, [0, 5, 10, 15, 20], [0, ymax / 4, ymax / 2, (3 * ymax) / 4, ymax], (v) => f2(v, 2));
  const series = [["by_over", css("--ink-soft"), "3 3", "By-over guess"], ["rule", css("--dusk"), "", "Run-rate rule"], ["model", css("--outfield"), "", "Model"]];
  series.forEach(([k, c, dash]) => el("path", { d: d.map((x, i) => (i ? "L" : "M") + f.X(x.over).toFixed(1) + " " + f.Y(x[k]).toFixed(1)).join(" "), fill: "none", stroke: c, "stroke-width": k === "model" ? 2.8 : 2, "stroke-dasharray": dash }, svg));
  series.forEach(([k, c, , name]) => { const last = d[d.length - 1], ref = k === "by_over" ? Math.max(...d.map((x) => x.by_over)) : last[k]; el("text", { x: f.X(last.over) - 2, y: f.Y(ref) - 8, "text-anchor": "end", style: "fill:" + c + ";font-weight:600" }, svg, name); });
}
function drawImp() {
  const svg = $("imp"); svg.replaceChildren();
  const d = DATA.importance.slice(0, 10), max = Math.max(...d.map((x) => x.value), 1e-6);
  const rowH = 30, left = 168;
  svg.setAttribute("viewBox", "0 0 380 " + (d.length * rowH + 20));
  d.forEach((x, i) => {
    const y = 10 + i * rowH, w = Math.max(0, (x.value / max) * (380 - left - 48));
    el("text", { x: left - 8, y: y + 17, "text-anchor": "end" }, svg, label(x.feature));
    el("rect", { x: left, y: y + 4, width: w, height: 16, rx: 3, fill: css("--outfield") }, svg);
    el("text", { x: left + w + 6, y: y + 17 }, svg, x.value.toFixed(3));
  });
}
