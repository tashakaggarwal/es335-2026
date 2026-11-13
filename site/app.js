"use strict";

const NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);
const LABELS = {
  runs_so_far: "Runs scored", target: "Target", wickets_lost: "Wickets lost", balls_left: "Balls left",
  current_run_rate: "Current run rate", required_run_rate: "Required run rate", run_rate_diff: "Run-rate gap",
  runs_needed_frac: "Share of target needed", resources: "Balls left x wickets",
  runs_needed_per_wicket: "Runs needed per wicket", runs_last_3: "Runs, last 3 overs",
  wkts_last_3: "Wickets, last 3 overs", boundaries_last_3: "Boundaries, last 3 overs", acceleration: "Recent acceleration",
  balls_since_last_wicket: "Balls since last wicket", bat_sr_mean: "Batters' strike rate", bat_balls_sum: "Balls faced by batters",
  bat_balls_max: "Most balls faced by a batter", chasing_impact_used: "Chasing side used impact player",
  bowling_impact_used: "Bowling side used impact player", target_vs_season_avg: "Target vs season average",
  venue_chase_rate: "Venue chase record", chasing_team_home: "Chasing side at home", bowling_team_home: "Bowling side at home",
  home_edge: "Home record edge", chaser_form: "Chasing side form", bowler_form: "Bowling side form",
};
const label = (f) => LABELS[f] || f.replace(/_/g, " ");

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

let DATA, MATCHES, cur = null, overIdx = 0;

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
  fillText(); buildSelect(); wireExplorer(); initWhatIf(); drawResults();
  const swing = (m) => Math.max(...m.overs.map((o) => o[3])) - Math.min(...m.overs.map((o) => o[3]));
  const best = MATCHES.reduce((a, b) => (swing(b) > swing(a) ? b : a));
  pick(best.id, true);
  window.addEventListener("resize", () => { drawResults(); });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { drawResults(); drawWorm(); });
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
function teamShort(t) { return t; }
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
    const swing = (m) => Math.max(...m.overs.map((o) => o[3])) - Math.min(...m.overs.map((o) => o[3]));
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
function pick(id, reset) {
  cur = MATCHES.find((m) => m.id === id);
  $("match-select").value = id;
  const sl = $("over-slider"); sl.max = cur.overs.length;
  overIdx = reset || overIdx >= cur.overs.length ? Math.min(8, cur.overs.length - 1) : overIdx;
  sl.value = overIdx + 1;
  $("chk-reveal").checked = false;
  $("match-title").textContent = cur.chaser + " chasing " + cur.target + " against " + cur.bowler;
  $("match-sub").textContent = [cur.venue, niceDate(cur.date)].filter(Boolean).join(", ");
  drawWorm(); drawState();
}

const G = { W: 760, H: 360, l: 50, r: 16, t: 16, b: 44 };
const xs = (o) => G.l + (o / 20) * (G.W - G.l - G.r);
const xInv = (x) => ((x - G.l) / (G.W - G.l - G.r)) * 20;
const ys = (p) => G.t + (1 - p) * (G.H - G.t - G.b);

function drawWorm() {
  if (!cur) return;
  const svg = $("worm"); svg.replaceChildren();
  const green = css("--outfield"), blue = css("--dusk"), ink = css("--ink"), grid = css("--grid"), ball = css("--ball"), soft = css("--ink-soft");
  const reveal = $("chk-reveal").checked, showRule = $("chk-rule").checked;
  const n = cur.overs.length, upto = overIdx + 1;
  const defs = el("defs", {}, svg);
  const up = el("clipPath", { id: "clip-up" }, defs); el("rect", { x: 0, y: 0, width: G.W, height: ys(0.5) }, up);
  const dn = el("clipPath", { id: "clip-dn" }, defs); el("rect", { x: 0, y: ys(0.5), width: G.W, height: G.H }, dn);
  [0, 0.25, 0.5, 0.75, 1].forEach((p) => {
    el("line", { x1: G.l, x2: G.W - G.r, y1: ys(p), y2: ys(p), stroke: p === 0.5 ? soft : grid, "stroke-width": p === 0.5 ? 1.2 : 1, "stroke-dasharray": p === 0.5 ? "5 4" : "" }, svg);
    el("text", { x: G.l - 8, y: ys(p) + 4, "text-anchor": "end" }, svg, Math.round(p * 100) + "%");
  });
  [0, 5, 10, 15, 20].forEach((o) => el("text", { x: xs(o), y: G.H - G.b + 20, "text-anchor": "middle" }, svg, o));
  el("text", { x: (G.l + G.W - G.r) / 2, y: G.H - 4, "text-anchor": "middle" }, svg, "overs completed");
  el("text", { x: G.l + 8, y: G.t + 16, fill: green, style: "fill:" + green + ";font-weight:600" }, svg, cur.chaser + " ahead");
  el("text", { x: G.l + 8, y: G.H - G.b - 8, style: "fill:" + blue + ";font-weight:600" }, svg, cur.bowler + " ahead");

  const pts = (arr, k) => arr.map((o, i) => [xs(o[0]), ys(o[k])]);
  const line = (P) => P.map((q, i) => (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1)).join(" ");
  const step = (P) => P.map((q, i) => (i ? "H" + q[0].toFixed(1) + " V" + q[1].toFixed(1) : "M" + q[0].toFixed(1) + " " + q[1].toFixed(1))).join(" ");
  const seen = cur.overs.slice(0, upto);

  if (showRule) {
    const rp = pts(seen, 4);
    el("path", { d: step(rp), fill: "none", stroke: soft, "stroke-width": 1.5, "stroke-dasharray": "3 3", opacity: 0.9 }, svg);
  }
  if (reveal && upto < n) {
    el("path", { d: line(pts(cur.overs, 3)), fill: "none", stroke: ink, "stroke-width": 2, "stroke-dasharray": "2 5", opacity: 0.5 }, svg);
  }
  const P = pts(seen, 3), y50 = ys(0.5);
  const area = line(P) + " L" + P[P.length - 1][0].toFixed(1) + " " + y50 + " L" + P[0][0].toFixed(1) + " " + y50 + " Z";
  el("path", { d: area, fill: green, opacity: 0.32, "clip-path": "url(#clip-up)" }, svg);
  el("path", { d: area, fill: blue, opacity: 0.32, "clip-path": "url(#clip-dn)" }, svg);
  el("path", { d: line(P), fill: "none", stroke: ink, "stroke-width": 2.6, "stroke-linejoin": "round" }, svg);
  P.forEach((q) => el("circle", { cx: q[0], cy: q[1], r: 3, fill: ink }, svg));

  let prev = 0;
  seen.forEach((o) => {
    for (let k = 0; k < o[2] - prev; k++) el("line", { x1: xs(o[0]) - 4 + k * 5, x2: xs(o[0]) - 4 + k * 5, y1: G.H - G.b - 9, y2: G.H - G.b + 1, stroke: ball, "stroke-width": 2.5, "stroke-linecap": "round" }, svg);
    prev = o[2];
  });
  const c = P[P.length - 1];
  el("line", { x1: c[0], x2: c[0], y1: G.t, y2: G.H - G.b, stroke: ball, "stroke-width": 1.2, opacity: 0.6 }, svg);
  el("circle", { cx: c[0], cy: c[1], r: 6.5, fill: ball, stroke: css("--paper"), "stroke-width": 2 }, svg);
  svg.setAttribute("aria-label", "Win probability for " + cur.chaser + " after each over, shown up to over " + upto + ".");
}

function drawState() {
  if (!cur) return;
  const o = cur.overs[overIdx], [ov, runs, wk, p, pB] = o;
  const need = cur.target - runs, balls = 120 - 6 * ov, rrr = balls > 0 ? (need / balls) * 6 : 0, crr = runs / ov;
  $("slider-label").textContent = "After over " + ov;
  const reveal = $("chk-reveal").checked;
  const s = $("state"); s.replaceChildren();
  const add = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = html; s.appendChild(e); return e; };
  add("div", "over", "After " + ov + " of 20 overs: " + runs + "/" + wk);
  const big = add("div", "big", ""); big.append(pct(p)); const sm = document.createElement("small"); sm.textContent = "%"; big.append(sm);
  add("div", "big-cap", cur.chaser + " win chance (model)");
  const sp = document.createElement("div"); sp.className = "split"; sp.setAttribute("role", "img"); sp.setAttribute("aria-label", pct(p) + " percent for the chasing team");
  const i = document.createElement("i"); i.style.width = (p * 100).toFixed(1) + "%"; sp.appendChild(i); s.appendChild(sp);
  const dl = document.createElement("dl");
  const row = (k, v) => { const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; dl.append(dt, dd); };
  row("Needs", need + " off " + balls + " balls");
  row("Required rate", f2(rrr) + " an over");
  row("Scoring at", f2(crr) + " an over");
  row("Run-rate rule", pB > 0.5 ? "chasing side is on or ahead of the rate" : "chasing side is behind the rate");
  s.appendChild(dl);
  if (reveal) add("div", "result", cur.chaser + (cur.won ? " won the chase." : " lost the chase.") + (cur.won === (p >= 0.5) ? " The model was leaning the right way at this point." : " The model was leaning the wrong way at this point."));
}

/* ---------- what if ---------- */
let WI;
function initWhatIf() {
  WI = DATA.whatif;
  const [tmin, tmax] = WI.target_range;
  const t = $("wi-target"); t.min = Math.max(60, tmin); t.max = tmax; t.value = Math.round(DATA.meta.mean_target_fit || 175);
  ["wi-target", "wi-over", "wi-runs", "wi-wkts"].forEach((id) => $(id).addEventListener("input", drawWhatIf));
  $("wi-note").textContent = WI.same_as_final_model
    ? "This is the final model. Inputs you cannot set here (" + (WI.held_at_average.length ? WI.held_at_average.map(label).join(", ").toLowerCase() : "none") + ") are held at their training average."
    : "This panel uses a simpler logistic regression on the ten core features, not the final model, so numbers can differ a little from the explorer.";
  drawWhatIf();
}
function wiProb(target, over, runs, wk) {
  const balls = 120 - 6 * over, need = target - runs, hand = 10 - wk;
  const rrr = Math.min(36, (need / balls) * 6), crr = runs / over;
  const v = {
    runs_so_far: runs, target, wickets_lost: wk, balls_left: balls, current_run_rate: crr, required_run_rate: rrr,
    run_rate_diff: rrr - crr, runs_needed_frac: need / target, resources: balls * hand, runs_needed_per_wicket: need / hand,
  };
  let z = WI.intercept;
  WI.features.forEach((f, i) => { const x = f in v ? v[f] : WI.mean[i]; z += WI.coef[i] * ((x - WI.mean[i]) / WI.scale[i]); });
  return { p: 1 / (1 + Math.exp(-z)), need, balls, rrr: need / balls * 6, crr, ahead: crr >= need / balls * 6 };
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
  const big = add("div", "big", ""); big.append(pct(r.p)); const sm = document.createElement("small"); sm.textContent = "%"; big.append(sm);
  add("div", "big-cap", "chance the chasing team wins");
  const sp = document.createElement("div"); sp.className = "split"; const i = document.createElement("i"); i.style.width = (r.p * 100).toFixed(1) + "%"; sp.appendChild(i); s.appendChild(sp);
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
