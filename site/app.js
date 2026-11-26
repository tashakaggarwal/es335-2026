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
  $("results-intro").textContent = "Evaluated once on " + m.test_matches + " held-out " + seasons + " matches (" + m.test_rows.toLocaleString() + " over states): the 11-feature logistic regression achieves " + f3(fin.log_loss) + " log loss (" + f3(fin.brier) + " Brier, " + (fin.accuracy * 100).toFixed(1) + "% accuracy) vs. " + f3(rule.log_loss) + " log loss (" + f3(rule.brier) + " Brier, " + (rule.accuracy * 100).toFixed(1) + "% accuracy) for Rule B.";
  $("results-read").textContent = "Paired gain over Rule B: " + f3(Math.abs(fin.diff)) + " log loss (95% match-bootstrap CI " + fin.diff_ci + ", P(better) = 100%). Refitting on 2008–2024 vs. 2008–2023 improved test log loss from 0.3867 to " + f3(fin.log_loss) + ".";
  const lim = [
    "Small match count (" + m.test_matches + " test matches): effective sample size is matches, not overs, yielding wide bootstrap CIs.",
    "Era shift & mild under-confidence: higher 200+ chase success in 2025–2026 produces a calibration slope of 1.19 (intercept +0.61).",
    "Prediction vs. causation: feature weights reflect conditional associations, not causal interventions (preserving wickets passively inflates RRR).",
    "Unmodeled context & exclusions: no pitch/dew/weather data; DLS-revised (23), tied/no-result (25), and shortened (10) matches are excluded.",
    "Lineup features in small samples: groups D–G (39 features) increased variance on 70 validation matches, so the 11-feature model is used for formal evaluation while all 39 power the Live Predictor.",
  ];
  $("limits-list").replaceChildren(...lim.map((t) => { const li = document.createElement("li"); li.textContent = t; return li; }));
  const f = $("footer"); f.replaceChildren();
  const p = document.createElement("p");
  p.append("Built for ES 335 (Machine Learning) by " + (m.author || "Tashak Aggarwal") + " (Roll No. 25110321). Ball-by-ball data from ");
  const a = document.createElement("a"); a.href = "https://cricsheet.org/"; a.target = "_blank"; a.rel = "noopener"; a.textContent = "Cricsheet (CC BY 4.0)"; p.append(a, ". ");
  if (m.repo) {
    const r = document.createElement("a"); r.href = m.repo; r.target = "_blank"; r.rel = "noopener"; r.textContent = "GitHub Repository (Code, Notebooks, Splits & README)";
    p.append("Full source & reproducibility: ", r, ".");
  }
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
  document.querySelectorAll("[data-jump-match]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mid = btn.getAttribute("data-jump-match");
      if (MATCHES.some((m) => m.id === mid)) {
        pick(mid, true);
        $("chk-reveal").checked = true;
        drawWorm();
        drawState();
        const expSec = $("explorer");
        if (expSec) expSec.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });
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

function renderAttributionBars(parent, contributions, chaserColor, bowlerColor, titleText, maxItems = 5) {
  if (!contributions || !contributions.length) return;
  const top = contributions
    .filter((c) => Math.abs(c.delta) >= 0.015)
    .slice()
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, maxItems);
  if (!top.length) return;

  const box = document.createElement("div");
  box.className = "attrib-box";
  const head = document.createElement("div");
  head.className = "attrib-head";
  const t = document.createElement("span");
  t.className = "attrib-title";
  t.textContent = titleText || "Top log-odds drivers (exact linear Shapley)";
  const sub = document.createElement("span");
  sub.className = "attrib-sub";
  sub.textContent = "− bowling  |  chasing +";
  head.append(t, sub);
  box.appendChild(head);

  const maxAbs = Math.max(...top.map((c) => Math.abs(c.delta)), 0.25);
  top.forEach((c) => {
    const row = document.createElement("div");
    row.className = "attrib-row";

    const lbl = document.createElement("span");
    lbl.className = "attrib-lbl";
    lbl.textContent = label(c.feature);
    lbl.title = label(c.feature) + ": value " + f2(c.value) + " (z = " + (c.z >= 0 ? "+" : "") + f2(c.z) + ")";

    const track = document.createElement("div");
    track.className = "attrib-track";
    const zero = document.createElement("span");
    zero.className = "attrib-zero";
    track.appendChild(zero);

    const bar = document.createElement("span");
    const pctW = Math.min(50, (Math.abs(c.delta) / maxAbs) * 48);
    if (c.delta >= 0) {
      bar.className = "attrib-bar attrib-pos";
      bar.style.left = "50%";
      bar.style.width = pctW.toFixed(1) + "%";
      bar.style.background = chaserColor;
    } else {
      bar.className = "attrib-bar attrib-neg";
      bar.style.left = (50 - pctW).toFixed(1) + "%";
      bar.style.width = pctW.toFixed(1) + "%";
      bar.style.background = bowlerColor;
    }
    track.appendChild(bar);

    const val = document.createElement("span");
    val.className = "attrib-val";
    val.style.color = c.delta >= 0 ? chaserColor : bowlerColor;
    val.textContent = (c.delta >= 0 ? "+" : "−") + Math.abs(c.delta).toFixed(2);

    row.append(lbl, track, val);
    box.appendChild(row);
  });

  parent.appendChild(box);
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

  // Exact real-time feature attribution ("Why X%?")
  if (window.IPLInference && DATA && DATA.whatif) {
    const fm = window.IPLInference.buildExplorerFeatureMap(cur, o, DATA.whatif.dls_params, DATA.whatif.default_recent_par || 175);
    const out = window.IPLInference.evalLinearModel(fm, DATA.whatif);
    renderAttributionBars(s, out.contributions, cCol, bCol, "Why " + pct(p) + "%? Top drivers", 5);
  }

  if (reveal) add("div", "result", cur.chaser + (cur.won ? " won the chase." : " lost the chase.") + (cur.won === (p >= 0.5) ? " The model was leaning the right way at this point." : " The model was leaning the wrong way at this point."));
}

/* ---------- live match predictor (full 39-feature model, raw inputs only) ---------- */
const LIVE_STORAGE_KEY = "es335_live_match_v4";
let LIVE = null;

function evalFullModelDetailed(featMap, useLive39 = false) {
  const M = (useLive39 && DATA.whatif.live_model) ? DATA.whatif.live_model : DATA.whatif;
  if (window.IPLInference) {
    return window.IPLInference.evalLinearModel(featMap, M);
  }
  let logit = M.intercept;
  const contributions = M.features.map((f, i) => {
    const x = f in featMap && !Number.isNaN(featMap[f]) ? featMap[f] : M.mean[i];
    const z = (x - M.mean[i]) / M.scale[i];
    const delta = M.coef[i] * z;
    logit += delta;
    return { feature: f, value: x, z, coef: M.coef[i], delta };
  });
  return { p: 1 / (1 + Math.exp(-logit)), logit, contributions };
}

function evalFullModel(featMap, useLive39 = false) {
  return evalFullModelDetailed(featMap, useLive39).p;
}

function computeDLSResources(ballsLeft, wicketsLost) {
  const dls = (DATA && DATA.whatif && DATA.whatif.dls_params) || null;
  if (window.IPLInference) {
    return window.IPLInference.computeDLSResources(ballsLeft, wicketsLost, dls);
  }
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
  const bowlXi = liveState.bowl_xi || [];
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
  const r1 = overEntry.bat1_runs != null ? Number(overEntry.bat1_runs) : Math.round((b1 * sr1) / 100);
  const r2 = overEntry.bat2_runs != null ? Number(overEntry.bat2_runs) : Math.round((b2 * sr2) / 100);
  const bat_runs_sum = Math.min(runs, Math.round(r1 + r2));
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
  const oversByBowler = overEntry.oversByBowler || new Array(12).fill(0);
  const maxBowlIdx = (overEntry.imp_bowl || overEntry.bowler === 11 || (oversByBowler[11] || 0) > 0) ? 12 : 11;
  const activeBowlers = [];
  for (let idx = 0; idx < maxBowlIdx; idx++) {
    if (bowlXi[idx]) {
      const bSlot = bowlXi[idx];
      const bowled = oversByBowler[idx] || 0;
      const quotaLeft = Math.max(0, 4 - bowled);
      activeBowlers.push({
        idx,
        name: bSlot.name,
        econ: Number(bSlot.econ) || 8.3,
        wkt_rate: Number(bSlot.wkt_rate) || 0.052,
        balls: Number(bSlot.balls) || 0,
        bowled,
        quotaLeft,
      });
    }
  }
  const fallbackEcon = (DATA.whatif && DATA.whatif.league_prior_econ) || ctx.bowl_rem_econ;
  const fallbackWkt = (DATA.whatif && DATA.whatif.league_prior_wkt) || ctx.bowl_rem_wkt_rate;
  const bowlCalc = window.IPLInference
    ? window.IPLInference.computeRemainingBowling(activeBowlers, remOvers, fallbackEcon, fallbackWkt)
    : { bowl_rem_econ: fallbackEcon, bowl_rem_wkt_rate: fallbackWkt, best_bowler_overs_left: Math.min(8, Math.round(remOvers * 0.42 * 10) / 10) };
  const { bowl_rem_econ, bowl_rem_wkt_rate, best_bowler_overs_left } = bowlCalc;

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

  const detailed = evalFullModelDetailed(feats, true);
  const p = detailed.p;
  const pB = rrd <= 0 ? pWin : pLose;
  return { p, pB, contributions: detailed.contributions, rrr: rawRrr, crr, rrd, need, balls, resources, dls_resources, par_score_diff, runs_needed_frac, runs_needed_per_wicket, is_powerplay, is_death, powerplay_balls_left, runs_last_3, wkts_last_3, bounds_last_3, accel, bat_sr_mean, bat_bpd_mean, bat_balls_sum, bat_balls_max, bat_runs_sum, settled_sr_interaction, rem_bat_n, rem_bat_quality, rem_bat_sr, bowl_rem_econ, bowl_rem_wkt_rate, best_bowler_overs_left, ctx, decided: null };
}

function defaultTeamXI(teamName) {
  const rosters = (DATA.whatif && DATA.whatif.rosters) || {};
  const batters = (DATA.whatif && DATA.whatif.batters) || {};
  const battersBpd = (DATA.whatif && DATA.whatif.batters_bpd) || {};
  const battersAvg = (DATA.whatif && DATA.whatif.batters_avg) || {};
  const list = rosters[teamName] || [];
  const xi = [];
  for (let i = 0; i < 12; i++) {
    const name = list[i] || ("Batter " + (i + 1));
    const sr = name in batters ? batters[name] : 125.0;
    const bpd = name in battersBpd ? battersBpd[name] : 18.0;
    const avg = name in battersAvg ? battersAvg[name] : 22.5;
    xi.push({ name, sr, bpd, avg });
  }
  return xi;
}

function defaultBowlingXI(teamName) {
  const bowlRosters = (DATA.whatif && DATA.whatif.bowl_rosters) || {};
  const rosters = (DATA.whatif && DATA.whatif.rosters) || {};
  const bowlersEcon = (DATA.whatif && DATA.whatif.bowlers_econ) || {};
  const bowlersWkt = (DATA.whatif && DATA.whatif.bowlers_wkt) || {};
  const bowlersBalls = (DATA.whatif && DATA.whatif.bowlers_balls) || {};
  const list = bowlRosters[teamName] || rosters[teamName] || [];
  const bxi = [];
  for (let i = 0; i < 12; i++) {
    const name = list[i] || ("Bowler " + (i + 1));
    const econ = name in bowlersEcon ? bowlersEcon[name] : 8.3;
    const wkt_rate = name in bowlersWkt ? bowlersWkt[name] : 0.052;
    const balls = name in bowlersBalls ? bowlersBalls[name] : 0;
    bxi.push({ name, econ, wkt_rate, balls });
  }
  return bxi;
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
  const runsByBatter = new Array(12).fill(0);
  const oversByBowler = new Array(12).fill(0);
  const updated = [];
  for (const o of LIVE.overs) {
    cumRuns += o.ov_runs;
    cumWkts = clamp(cumWkts + o.ov_wkts, 0, 10);
    const sr1 = (LIVE.xi[o.bat1] && Number(LIVE.xi[o.bat1].sr)) || 125.0;
    const sr2 = (LIVE.xi[o.bat2] && Number(LIVE.xi[o.bat2].sr)) || 125.0;
    const w1 = sr1 / Math.max(1, sr1 + sr2);
    if (o.ov_wkts === 0) {
      bslw += 6;
      ballsByBatter[o.bat1] = (ballsByBatter[o.bat1] || 0) + 3;
      ballsByBatter[o.bat2] = (ballsByBatter[o.bat2] || 0) + 3;
      runsByBatter[o.bat1] = (runsByBatter[o.bat1] || 0) + o.ov_runs * w1;
      runsByBatter[o.bat2] = (runsByBatter[o.bat2] || 0) + o.ov_runs * (1 - w1);
    } else {
      bslw = 3;
      ballsByBatter[o.bat1] = (ballsByBatter[o.bat1] || 0) + (o.ov_wkts === 1 ? 4 : 2);
      ballsByBatter[o.bat2] = (ballsByBatter[o.bat2] || 0) + 2;
      runsByBatter[o.bat1] = (runsByBatter[o.bat1] || 0) + o.ov_runs * 0.65;
      runsByBatter[o.bat2] = (runsByBatter[o.bat2] || 0) + o.ov_runs * 0.35;
    }
    const bowlerIdx = clamp(Number(o.bowler) || 0, 0, 11);
    oversByBowler[bowlerIdx] = (oversByBowler[bowlerIdx] || 0) + 1;
    const entry = {
      ...o,
      bowler: bowlerIdx,
      runs: cumRuns,
      wkts: cumWkts,
      bslw,
      bat1_balls: ballsByBatter[o.bat1] || 0,
      bat2_balls: ballsByBatter[o.bat2] || 0,
      bat1_runs: runsByBatter[o.bat1] || 0,
      bat2_runs: runsByBatter[o.bat2] || 0,
      oversByBowler: oversByBowler.slice(),
      imp_chase: (o.imp_chase || o.bat1 === 11 || o.bat2 === 11) ? 1 : 0,
      imp_bowl: (o.imp_bowl || bowlerIdx === 11) ? 1 : 0,
    };
    const res = computeOverPrediction(updated, entry, LIVE);
    Object.assign(entry, res);
    updated.push(entry);
  }
  LIVE.overs = updated;
  LIVE._ballsByBatter = ballsByBatter;
  LIVE._runsByBatter = runsByBatter;
  LIVE._oversByBowler = oversByBowler;
  LIVE._bslw = bslw;
  syncCreaseDropdowns();
  saveLiveState();
}

function syncContextControls() {
  $("live-chaser").value = LIVE.chaser;
  $("live-bowler").value = LIVE.bowler;
  $("live-venue").value = LIVE.venue;
  $("live-target").value = LIVE.target;
}

function initLive() {
  const rosters = (DATA.whatif && DATA.whatif.rosters) || {};
  const venues = (DATA.whatif && DATA.whatif.venues) || {};
  const homeVenues = (DATA.whatif && DATA.whatif.team_home_venues) || {};
  const teams = Object.keys(rosters).sort();
  const venueNames = Object.keys(venues).sort();

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
  if (loaded && loaded.xi && Array.isArray(loaded.xi) && loaded.xi.length === 12 && loaded.bowl_xi && Array.isArray(loaded.bowl_xi) && loaded.bowl_xi.length === 12 && loaded.venue) {
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
      bowl_xi: defaultBowlingXI(defB),
      overs: [],
    };
  }

  syncContextControls();
  renderXIGrid();
  recomputeAllLiveOvers();
  prepareNextOverForm();
  refreshLiveUI();

  selC.addEventListener("change", () => {
    LIVE.chaser = selC.value;
    LIVE.xi = defaultTeamXI(LIVE.chaser);
    renderXIGrid();
    recomputeAllLiveOvers();
    refreshLiveUI();
  });
  selB.addEventListener("change", () => {
    LIVE.bowler = selB.value;
    LIVE.bowl_xi = defaultBowlingXI(LIVE.bowler);
    renderXIGrid();
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
    LIVE.bowl_xi = defaultBowlingXI(LIVE.bowler);
    renderXIGrid();
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
  ["lo-runs", "lo-wkts", "lo-bounds", "lo-bat1", "lo-bat2", "lo-bowler", "lo-imp-chase", "lo-imp-bowl"].forEach((id) => {
    const elNode = $(id);
    if (elNode) elNode.addEventListener("input", updateLiveFormPreview);
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
  const battersBpd = (DATA.whatif && DATA.whatif.batters_bpd) || {};
  const battersAvg = (DATA.whatif && DATA.whatif.batters_avg) || {};
  const bowlersEcon = (DATA.whatif && DATA.whatif.bowlers_econ) || {};
  const bowlersWkt = (DATA.whatif && DATA.whatif.bowlers_wkt) || {};
  const bowlersBalls = (DATA.whatif && DATA.whatif.bowlers_balls) || {};
  const teamSquads = (DATA.whatif && DATA.whatif.team_squads) || {};
  const [cCol, bCol] = getMatchColors(LIVE.chaser, LIVE.bowler);

  const cLbl = $("xi-chaser-label"), bLbl = $("xi-bowler-label");
  if (cLbl) {
    cLbl.textContent = LIVE.chaser + " — Batting Playing 11";
    cLbl.style.color = cCol;
  }
  if (bLbl) {
    bLbl.textContent = LIVE.bowler + " — Bowling Playing 11";
    bLbl.style.color = bCol;
  }

  const chaserPool = (teamSquads[LIVE.chaser] || LIVE.xi.map((x) => x.name)).slice();
  const grid = $("live-xi-grid");
  grid.replaceChildren();
  LIVE.xi.forEach((slot, idx) => {
    const row = document.createElement("div");
    row.className = "xi-slot";
    const num = document.createElement("span");
    num.className = "slot-num";
    num.textContent = idx < 11 ? "#" + (idx + 1) : "IMP";
    num.title = idx < 11 ? "Batting position " + (idx + 1) : "12th man / Impact Player substitute";

    const sel = document.createElement("select");
    sel.setAttribute("aria-label", (idx < 11 ? "Chasing Batter " + (idx + 1) : "Chasing Impact Player"));
    const opts = chaserPool.includes(slot.name) ? chaserPool : [slot.name, ...chaserPool];
    opts.forEach((pName) => {
      const o = document.createElement("option");
      o.value = pName;
      o.textContent = pName;
      sel.appendChild(o);
    });
    sel.value = slot.name;

    const srTag = document.createElement("span");
    srTag.className = "sr-tag";
    srTag.textContent = "SR " + Number(slot.sr).toFixed(1);

    sel.addEventListener("change", () => {
      slot.name = sel.value;
      slot.sr = slot.name in batters ? batters[slot.name] : 125.0;
      slot.bpd = slot.name in battersBpd ? battersBpd[slot.name] : 18.0;
      slot.avg = slot.name in battersAvg ? battersAvg[slot.name] : 22.5;
      srTag.textContent = "SR " + Number(slot.sr).toFixed(1);
      recomputeAllLiveOvers();
      refreshLiveUI();
    });

    row.append(num, sel, srTag);
    grid.appendChild(row);
  });

  const bowlerPool = (teamSquads[LIVE.bowler] || (LIVE.bowl_xi || []).map((x) => x.name)).slice();
  const bGrid = $("live-bowl-xi-grid");
  if (bGrid) {
    bGrid.replaceChildren();
    if (!LIVE.bowl_xi || LIVE.bowl_xi.length !== 12) {
      LIVE.bowl_xi = defaultBowlingXI(LIVE.bowler);
    }
    LIVE.bowl_xi.forEach((slot, idx) => {
      const row = document.createElement("div");
      row.className = "xi-slot";
      const num = document.createElement("span");
      num.className = "slot-num";
      num.textContent = idx < 11 ? "#" + (idx + 1) : "IMP";
      num.title = idx < 11 ? "Bowling squad slot " + (idx + 1) : "12th man / Impact Player substitute";

      const sel = document.createElement("select");
      sel.setAttribute("aria-label", (idx < 11 ? "Bowling Player " + (idx + 1) : "Bowling Impact Player"));
      const opts = bowlerPool.includes(slot.name) ? bowlerPool : [slot.name, ...bowlerPool];
      opts.forEach((pName) => {
        const o = document.createElement("option");
        o.value = pName;
        o.textContent = pName;
        sel.appendChild(o);
      });
      sel.value = slot.name;

      const econTag = document.createElement("span");
      econTag.className = "sr-tag";
      econTag.textContent = "Econ " + Number(slot.econ).toFixed(2);

      sel.addEventListener("change", () => {
        slot.name = sel.value;
        slot.econ = slot.name in bowlersEcon ? bowlersEcon[slot.name] : 8.3;
        slot.wkt_rate = slot.name in bowlersWkt ? bowlersWkt[slot.name] : 0.052;
        slot.balls = slot.name in bowlersBalls ? bowlersBalls[slot.name] : 0;
        econTag.textContent = "Econ " + Number(slot.econ).toFixed(2);
        recomputeAllLiveOvers();
        refreshLiveUI();
      });

      row.append(num, sel, econTag);
      bGrid.appendChild(row);
    });
  }
}

function syncCreaseDropdowns() {
  const b1 = $("lo-bat1"), b2 = $("lo-bat2"), bw = $("lo-bowler");
  const v1 = b1 && b1.value !== "" ? +b1.value : 0;
  const v2 = b2 && b2.value !== "" ? +b2.value : 1;
  const vw = bw && bw.value !== "" ? +bw.value : 0;
  [b1, b2].forEach((sel) => {
    if (!sel) return;
    sel.replaceChildren();
    LIVE.xi.forEach((slot, idx) => {
      const o = document.createElement("option");
      o.value = idx;
      o.textContent = (idx < 11 ? "#" + (idx + 1) : "IMP") + " " + slot.name + " (SR " + Number(slot.sr).toFixed(0) + ")";
      sel.appendChild(o);
    });
  });
  if (b1) b1.value = clamp(v1, 0, 11);
  if (b2) b2.value = clamp(v2, 0, 11);

  if (bw && LIVE.bowl_xi) {
    const oversByBowler = LIVE._oversByBowler || new Array(12).fill(0);
    bw.replaceChildren();
    LIVE.bowl_xi.forEach((slot, idx) => {
      const bowled = oversByBowler[idx] || 0;
      const o = document.createElement("option");
      o.value = idx;
      const quotaNote = bowled >= 4 ? "4/4 ov — quota done" : bowled + "/4 ov";
      o.textContent = (idx < 11 ? "#" + (idx + 1) : "IMP") + " " + slot.name + " (" + quotaNote + ", Econ " + Number(slot.econ).toFixed(2) + ")";
      bw.appendChild(o);
    });
    bw.value = clamp(vw, 0, 11);
  }
}

function prepareNextOverForm() {
  const nextOv = LIVE.overs.length + 1;
  const oversByBowler = LIVE._oversByBowler || new Array(12).fill(0);
  if (nextOv === 1) {
    $("lo-runs").value = 8;
    $("lo-wkts").value = 0;
    $("lo-bounds").value = 1;
    $("lo-bat1").value = 0;
    $("lo-bat2").value = 1;
    if ($("lo-bowler")) $("lo-bowler").value = 0;
    $("lo-imp-chase").checked = false;
    $("lo-imp-bowl").checked = false;
  } else {
    const prev = LIVE.overs[LIVE.overs.length - 1];
    $("lo-runs").value = 8;
    $("lo-wkts").value = 0;
    $("lo-bounds").value = 1;
    $("lo-bat1").value = prev.bat1;
    $("lo-bat2").value = prev.bat2;
    if ($("lo-bowler")) {
      let nextBowler = (prev.bowler + 1) % 5;
      for (let step = 0; step < 12; step++) {
        const cand = (prev.bowler + 1 + step) % 11;
        if (cand !== prev.bowler && (oversByBowler[cand] || 0) < 4) {
          nextBowler = cand;
          break;
        }
      }
      $("lo-bowler").value = nextBowler;
    }
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
  const bowler = $("lo-bowler") ? clamp(+$("lo-bowler").value || 0, 0, 11) : 0;
  const imp_chase = ($("lo-imp-chase").checked || bat1 === 11 || bat2 === 11) ? 1 : 0;
  const imp_bowl = ($("lo-imp-bowl").checked || bowler === 11) ? 1 : 0;

  const baseBalls = (LIVE._ballsByBatter || new Array(12).fill(0)).slice();
  const baseRuns = (LIVE._runsByBatter || new Array(12).fill(0)).slice();
  const baseBowled = (LIVE._oversByBowler || new Array(12).fill(0)).slice();
  const sr1 = (LIVE.xi[bat1] && Number(LIVE.xi[bat1].sr)) || 125.0;
  const sr2 = (LIVE.xi[bat2] && Number(LIVE.xi[bat2].sr)) || 125.0;
  const w1 = sr1 / Math.max(1, sr1 + sr2);
  let bslw;
  if (ov_wkts === 0) {
    bslw = prev.bslw + 6;
    baseBalls[bat1] = (baseBalls[bat1] || 0) + 3;
    baseBalls[bat2] = (baseBalls[bat2] || 0) + 3;
    baseRuns[bat1] = (baseRuns[bat1] || 0) + ov_runs * w1;
    baseRuns[bat2] = (baseRuns[bat2] || 0) + ov_runs * (1 - w1);
  } else {
    bslw = 3;
    baseBalls[bat1] = (baseBalls[bat1] || 0) + (ov_wkts === 1 ? 4 : 2);
    baseBalls[bat2] = (baseBalls[bat2] || 0) + 2;
    baseRuns[bat1] = (baseRuns[bat1] || 0) + ov_runs * 0.65;
    baseRuns[bat2] = (baseRuns[bat2] || 0) + ov_runs * 0.35;
  }
  baseBowled[bowler] = (baseBowled[bowler] || 0) + 1;

  const entry = {
    over: nextOv, ov_runs, ov_wkts, ov_bounds,
    runs: prev.runs + ov_runs, wkts: prev.wkts + ov_wkts, bslw,
    bat1, bat2, bowler,
    bat1_balls: baseBalls[bat1], bat2_balls: baseBalls[bat2],
    bat1_runs: baseRuns[bat1], bat2_runs: baseRuns[bat2],
    oversByBowler: baseBowled,
    imp_chase, imp_bowl,
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
  const cLbl = $("xi-chaser-label"), bLbl = $("xi-bowler-label");
  if (cLbl) cLbl.style.color = cCol;
  if (bLbl) bLbl.style.color = bCol;

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
  const bwIdx = o.bowler != null ? o.bowler : 0;
  const bwSlot = (LIVE.bowl_xi && LIVE.bowl_xi[bwIdx]) || { name: "Bowler 1", econ: 8.3 };
  const bwOvers = (o.oversByBowler && o.oversByBowler[bwIdx]) || 1;

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

  if (o.contributions && o.contributions.length && !o.decided) {
    renderAttributionBars(s, o.contributions, cCol, bCol, "Why " + pct(o.p) + "%? Top drivers", 6);
  }

  add("h3", "live-stats-heading", "Computed statistics");
  const groupsWrap = document.createElement("div");
  groupsWrap.className = "live-stat-groups";

  const makeGroup = (title, items) => {
    const card = document.createElement("div");
    card.className = "live-stat-card";
    const h = document.createElement("div");
    h.className = "live-stat-head";
    h.textContent = title;
    card.appendChild(h);
    const dl = document.createElement("dl");
    dl.className = "live-stat-dl";
    items.forEach(([k, parts]) => {
      const rowDiv = document.createElement("div");
      rowDiv.className = "live-stat-row";
      const dt = document.createElement("dt");
      dt.textContent = k;
      const dd = document.createElement("dd");
      const arr = Array.isArray(parts) ? parts : [parts];
      arr.forEach((pText, idx) => {
        if (idx > 0) {
          const sep = document.createElement("span");
          sep.className = "stat-dot";
          sep.textContent = "·";
          dd.appendChild(sep);
        }
        const span = document.createElement("span");
        span.className = idx === 0 ? "stat-main" : "stat-sub";
        span.textContent = pText;
        dd.appendChild(span);
      });
      rowDiv.append(dt, dd);
      dl.appendChild(rowDiv);
    });
    card.appendChild(dl);
    groupsWrap.appendChild(card);
  };

  const parDiffStr = (o.par_score_diff >= 0 ? "+" : "") + f2(o.par_score_diff, 1);
  const vParDiffStr = (ctx.target_vs_venue_par >= 0 ? "+" : "") + f2(ctx.target_vs_venue_par, 1);
  const phaseLabel = o.is_powerplay ? ("Powerplay (" + o.powerplay_balls_left + "b left)") : o.is_death ? "Death overs (15–20)" : "Middle overs (7–14)";

  makeGroup("Chase Rates & DLS State", [
    ["Needs", [o.need + " off " + o.balls + " balls", Math.round(o.runs_needed_frac * 100) + "% of target"]],
    ["Current / req. rate", [f2(o.crr) + " / " + f2(o.rrr), "gap " + (o.rrd >= 0 ? "+" : "") + f2(o.rrd)]],
    ["DLS resources & par", [f2(o.dls_resources, 1) + "% left", parDiffStr + " vs DLS par", f2(o.runs_needed_per_wicket, 1) + " R/wkt"]],
    ["Run-rate rule", [o.pB > 0.5 ? "Ahead/on rate (" + pct(o.pB) + "%)" : "Behind rate (" + pct(o.pB) + "%)"]],
  ]);

  makeGroup("Phase, Momentum & Partnership", [
    ["Match phase", [phaseLabel]],
    ["Last 3 overs", [o.runs_last_3 + "R, " + o.wkts_last_3 + "W, " + o.bounds_last_3 + "×4/6", "accel " + (o.accel >= 0 ? "+" : "") + f2(o.accel)]],
    ["Partnership", [o.bslw + "b since wkt", o.bat_runs_sum + "R by pair at crease"]],
  ]);

  makeGroup("Batting Crease & Dugout", [
    ["At the crease", [b1.name + " (" + o.bat1_balls + "b, SR " + f2(b1.sr, 1) + ")", b2.name + " (" + o.bat2_balls + "b, SR " + f2(b2.sr, 1) + ")"]],
    ["Batter metrics", ["Mean SR " + f2(o.bat_sr_mean, 1), "BPD " + f2(o.bat_bpd_mean, 1), "Settled×SR " + f2(o.settled_sr_interaction, 1)]],
    ["Dugout depth", [o.rem_bat_n + " batters left", "Top-3 avg sum " + f2(o.rem_bat_quality, 1) + " (SR " + f2(o.rem_bat_sr, 1) + ")"]],
  ]);

  makeGroup("Bowling, Venue & Team Form", [
    ["Bowler (Over " + o.over + ")", [bwSlot.name, bwOvers + "/4 ov, Econ " + f2(bwSlot.econ, 2)]],
    ["Bowling attack", ["Rem. econ " + f2(o.bowl_rem_econ, 2), "Top-2 overs left " + f2(o.best_bowler_overs_left, 1)]],
    ["Venue record", [LIVE.venue.split(",")[0], "chase win " + f2(ctx.venue_rate * 100, 1) + "%"]],
    ["Home edge", [homeLabel, (ctx.home_edge >= 0 ? "+" : "") + f2(ctx.home_edge, 3)]],
    ["Target vs par", [vParDiffStr + " vs venue par (" + f2(ctx.venue_par, 1) + ")", diffStr + " vs season avg"]],
    ["Team form (last 5)", ["Chaser " + f2(ctx.chaser_form, 2) + " (" + ctx.chaser_wins + "/5)", "Bowler " + f2(ctx.bowler_form, 2) + " (" + ctx.bowler_wins + "/5)"]],
  ]);

  s.appendChild(groupsWrap);
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
    const bwIdx = o.bowler != null ? o.bowler : 0;
    const bwName = (LIVE.bowl_xi && LIVE.bowl_xi[bwIdx] && LIVE.bowl_xi[bwIdx].name) || ("#" + (bwIdx + 1));
    const bwOv = (o.oversByBowler && o.oversByBowler[bwIdx]) || 1;
    const cells = [
      "Over " + o.over,
      bwName + " (" + bwOv + "/4)",
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
      if (idx === 8) {
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
  const defaultParVal = Math.round((WI && WI.default_recent_par) || (DATA.meta && DATA.meta.mean_target_fit) || 195);
  $("wi-note").textContent = WI.same_as_final_model
    ? "This is the final 11-feature model. Venue par is anchored at the recent 30-match IPL par (" + defaultParVal + " runs). Use the Live Predictor above to evaluate all 39 features."
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
  const detailed = evalFullModelDetailed(v, false);
  return { p: detailed.p, contributions: detailed.contributions, need, balls, rrr: need / balls * 6, crr, ahead: crr >= need / balls * 6 };
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
  if (r.contributions && r.contributions.length) {
    renderAttributionBars(s, r.contributions, css("--outfield"), css("--ball"), "Why " + pct(r.p) + "%? Top drivers", 5);
  }
}

/* ---------- results ---------- */
function drawResults() {
  if (!DATA) return;
  const t = $("results-table");
  const cap = t.querySelector("caption"); t.replaceChildren(cap);
  const head = document.createElement("thead"), hr = document.createElement("tr");
  ["Model", "Log loss", "95% interval", "Brier score", "Accuracy", "Gap to rule (95% interval)"].forEach((h) => { const th = document.createElement("th"); th.scope = "col"; th.textContent = h; hr.appendChild(th); });
  head.appendChild(hr); t.insertBefore(head, cap.nextSibling);
  const body = document.createElement("tbody");
  DATA.results.forEach((r) => {
    const tr = document.createElement("tr"); if (/^FINAL/.test(r.name)) tr.className = "final";
    const MODELS = { logreg: "logistic regression (11 feats, B +derived)", hgb: "gradient-boosted trees" };
    const name = /^FINAL/.test(r.name) ? "Final model: " + (MODELS[DATA.meta.model] || DATA.meta.model)
      : /^\(ref\)/.test(r.name) ? "Ref: same model, fitted on 2008–2023 train only"
      : /^A2/.test(r.name) ? "A2: Empirical win rate by over" : /^A\b/.test(r.name) ? "A: Constant guess (train+val win rate)" : /^B\b/.test(r.name) ? "B: Run-rate rule (CRR >= RRR)" : r.name;
    [name, f3(r.log_loss), r.ci, r.brier != null ? r.brier.toFixed(4) : "-", (r.accuracy * 100).toFixed(2) + "%", r.diff == null ? "-" : (r.diff > 0 ? "+" : "") + f3(r.diff) + " " + r.diff_ci].forEach((v) => { const td = document.createElement("td"); td.textContent = v; tr.appendChild(td); });
    body.appendChild(tr);
  });
  t.insertBefore(body, cap);
  drawBallBenchmark();
  drawCal(); drawByOver(); drawImp();
}
function drawBallBenchmark() {
  const t = $("ball-results-table");
  if (!t || !DATA || !DATA.ball_benchmark || !DATA.ball_benchmark.models) return;
  const bb = DATA.ball_benchmark;
  const metaEl = $("ball-bench-meta");
  if (metaEl) {
    metaEl.textContent = "Ball-by-Ball Granularity Benchmark (" + bb.total_rows.toLocaleString() + " legal deliveries; " + bb.test_rows.toLocaleString() + " test deliveries across " + bb.test_matches + " matches)";
  }
  const cap = t.querySelector("caption");
  t.replaceChildren(cap);
  const head = document.createElement("thead"), hr = document.createElement("tr");
  ["Model (Ball-by-Ball)", "Log Loss", "95% Match CI", "Brier Score", "Accuracy", "Diff vs Rule B (95% CI)"].forEach((h) => {
    const th = document.createElement("th"); th.scope = "col"; th.textContent = h; hr.appendChild(th);
  });
  head.appendChild(hr);
  t.insertBefore(head, cap.nextSibling);
  const body = document.createElement("tbody");
  const bestLL = Math.min(...bb.models.map((m) => m.log_loss));
  bb.models.forEach((r) => {
    const tr = document.createElement("tr");
    if (Math.abs(r.log_loss - bestLL) < 1e-6) tr.className = "final";
    [
      r.name,
      f3(r.log_loss),
      r.ci,
      r.brier != null ? r.brier.toFixed(4) : "-",
      (r.accuracy * 100).toFixed(2) + "%",
      r.diff == null ? "-" : (r.diff > 0 ? "+" : "") + f3(r.diff) + " " + r.diff_ci,
    ].forEach((v) => {
      const td = document.createElement("td"); td.textContent = v; tr.appendChild(td);
    });
    body.appendChild(tr);
  });
  t.insertBefore(body, cap);
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
