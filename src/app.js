"use strict";

/* ------------------------------------------------------------------ *
 * Lectern — a quiet study timer with a weekly report.
 *
 * Model
 *   days[YYYY-MM-DD] = { study, breaks, pauses, sessions, closed }
 *   active           = { date, status: "running" | "paused", since,
 *                        study, breaks, pauses }  (null when idle)
 *   seen             = { [weekStartKey]: true }    reports already shown
 *
 * Time is always derived from timestamps, so closing the window while
 * the timer runs loses nothing: it keeps counting from `since`.
 * ------------------------------------------------------------------ */

const DAY_MS = 86400000;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July",
  "August", "September", "October", "November", "December"];

const params = new URLSearchParams(location.search);
const DEMO = params.has("demo");
const tauri = window.__TAURI__ && window.__TAURI__.core;

/* Clock — `?today=YYYY-MM-DD` shifts the clock (demo / screenshots only). */
let clockOffset = 0;
if (DEMO && params.get("today")) {
  const target = parseKey(params.get("today"));
  const n = new Date();
  target.setHours(n.getHours(), n.getMinutes(), n.getSeconds());
  clockOffset = target - n;
}
const now = () => Date.now() + clockOffset;

/* ---------- dates ---------- */

function keyOf(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"),
    day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function parseKey(k) {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function addDays(k, n) {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return keyOf(d);
}
const todayKey = () => keyOf(new Date(now()));
const weekStart = (k) => addDays(k, -parseKey(k).getDay()); // Sunday

/* ---------- formatting ---------- */

function clock(ms) {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
}
function hm(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
function shortHours(ms) {
  if (ms < 60000) return "";
  const h = ms / 3600000;
  return h < 1 ? `${Math.round(ms / 60000)}m` : `${h.toFixed(1).replace(/\.0$/, "")}h`;
}
function rangeLabel(start) {
  const a = parseKey(start), b = parseKey(addDays(start, 6));
  const left = `${MONTHS[a.getMonth()]} ${a.getDate()}`;
  const right = a.getMonth() === b.getMonth() ? `${b.getDate()}` : `${MONTHS[b.getMonth()]} ${b.getDate()}`;
  return `${left} – ${right}, ${b.getFullYear()}`;
}

/* ---------- storage ---------- */

let state = { version: 1, days: {}, active: null, seen: {} };

async function load() {
  if (DEMO) return seedDemo();
  try {
    const raw = tauri ? await tauri.invoke("load_data") : localStorage.getItem("lectern");
    if (raw) state = Object.assign(state, JSON.parse(raw));
  } catch (e) {
    console.error("Could not load data", e);
  }
}
async function save() {
  if (DEMO) return;
  const raw = JSON.stringify(state);
  try {
    if (tauri) await tauri.invoke("save_data", { data: raw });
    else localStorage.setItem("lectern", raw);
  } catch (e) {
    console.error("Could not save data", e);
  }
}

/* ---------- timer actions ---------- */

function dayRec(k) {
  return state.days[k] || (state.days[k] = { study: 0, breaks: 0, pauses: 0, sessions: 0, closed: false });
}

function start() {
  const k = todayKey();
  if (state.days[k]) state.days[k].closed = false;
  state.active = { date: k, status: "running", since: now(), study: 0, breaks: 0, pauses: 0 };
  commitAndRender();
}
function pause() {
  const a = state.active;
  a.study += now() - a.since;
  a.pauses += 1;
  a.status = "paused";
  a.since = now();
  commitAndRender();
}
function resume() {
  const a = state.active;
  a.breaks += now() - a.since;
  a.status = "running";
  a.since = now();
  commitAndRender();
}
function stop() {
  const a = state.active;
  if (a.status === "running") a.study += now() - a.since;
  closeActive(a);
  commitAndRender();
}
function closeActive(a) {
  const d = dayRec(a.date);
  d.study += a.study;
  d.breaks += a.breaks;
  d.pauses += a.pauses;
  d.sessions += 1;
  d.closed = true;
  state.active = null;
}

/* A break left open past midnight ends the day at the moment of the pause. */
function settleStaleSession() {
  const a = state.active;
  if (a && a.status === "paused" && a.date < todayKey()) {
    closeActive(a);
    save();
  }
}

/* Live totals for a given day, including the running session. */
function liveFor(k) {
  const d = state.days[k] || { study: 0, breaks: 0, pauses: 0, sessions: 0, closed: false };
  const out = { study: d.study, breaks: d.breaks, pauses: d.pauses, sessions: d.sessions, closed: d.closed };
  const a = state.active;
  if (a && a.date === k) {
    const t = now() - a.since;
    out.study += a.study + (a.status === "running" ? t : 0);
    out.breaks += a.breaks + (a.status === "paused" ? t : 0);
    out.pauses += a.pauses;
    out.sessions += 1;
  }
  return out;
}

function weekData(start) {
  const days = [];
  for (let i = 0; i < 7; i++) {
    const k = addDays(start, i);
    days.push({ key: k, ...liveFor(k) });
  }
  return days;
}

/* ---------- rendering: today ---------- */

const $ = (id) => document.getElementById(id);
let confirmTimer = null;

function currentState() {
  const a = state.active;
  if (a) return a.status;
  const d = state.days[todayKey()];
  return d && d.closed ? "closed" : "idle";
}

function renderControls() {
  const s = currentState();
  const c = $("controls");
  c.innerHTML = "";
  const btn = (label, cls, fn) => {
    const b = document.createElement("button");
    b.className = `btn ${cls}`;
    b.textContent = label;
    b.addEventListener("click", fn);
    c.appendChild(b);
    return b;
  };
  if (s === "idle") btn("Start studying", "btn-primary", start);
  if (s === "running") btn("Pause", "btn-primary", pause);
  if (s === "paused") btn("Resume", "btn-primary", resume);
  if (s === "running" || s === "paused") {
    const b = btn("Stop", "btn-ghost", () => {
      if (b.dataset.armed) { clearTimeout(confirmTimer); return stop(); }
      b.dataset.armed = "1";
      b.textContent = "End the day?";
      b.className = "btn btn-warn";
      confirmTimer = setTimeout(renderControls, 3000);
    });
  }
  if (s === "closed") btn("Start another session", "btn-link", start);
}

function renderTimer() {
  const s = currentState();
  document.body.dataset.state = s;
  const a = state.active;
  const k = a ? a.date : todayKey();
  const live = liveFor(k);
  $("timer").textContent = clock(live.study);

  let text = "Ready when you are";
  if (s === "running") text = "Studying";
  if (s === "paused") text = `On a break · ${clock(now() - a.since).replace(/^00:/, "")}`;
  if (s === "closed") text = "Done for today";
  if (a && a.date !== todayKey()) text += " · started yesterday";
  $("status-text").textContent = text;
}

function renderWeekStrip() {
  const t = todayKey();
  const days = weekData(weekStart(t));
  const max = Math.max(3600000, ...days.map((d) => d.study));
  const strip = $("strip");
  strip.innerHTML = "";
  let total = 0;
  for (const d of days) {
    total += d.study;
    const el = document.createElement("div");
    el.className = "day" + (d.study > 0 ? " has" : "") + (d.key === t ? " is-today" : "");
    el.title = `${DAYS[parseKey(d.key).getDay()]} · ${hm(d.study)}`;
    el.innerHTML = `<div class="bar-wrap"><div class="bar" style="height:${Math.max(4, (d.study / max) * 100)}%"></div></div>
      <span class="d">${DAYS[parseKey(d.key).getDay()][0]}</span>`;
    strip.appendChild(el);
  }
  $("week-total").textContent = hm(total);

  const dow = parseKey(t).getDay();
  const left = 6 - dow;
  $("week-hint").textContent = left === 0
    ? "Your weekly report is ready."
    : `Your report arrives on Saturday, in ${left} day${left > 1 ? "s" : ""}.`;
}

function renderToday() {
  const d = parseKey(todayKey());
  $("today-date").textContent = `${DAYS[d.getDay()]}, ${MONTHS_LONG[d.getMonth()]} ${d.getDate()}`;
  renderTimer();
  renderControls();
  renderWeekStrip();
}

/* ---------- rendering: report ---------- */

let reportWeek = null;

function summarize(days, total, prevTotal) {
  const studied = days.filter((d) => d.study >= 60000);
  if (total < 60000) return "A quiet week. Nothing was recorded, and next week is a clean page.";
  const best = studied.reduce((a, b) => (b.study > a.study ? b : a));
  const n = studied.length;
  const lead = n >= 6 ? "Remarkably consistent" : n >= 4 ? "A steady week" : n >= 2 ? "A lighter week" : "A single sitting";
  const bestName = DAYS[parseKey(best.key).getDay()];
  let s = n === 1
    ? `${lead}. All of it happened on ${bestName}, ${hm(best.study)} in one day.`
    : `${lead}. You studied ${n} of 7 days, and ${bestName} was the longest at ${hm(best.study)}.`;
  if (prevTotal >= 60000) {
    const diff = Math.round(((total - prevTotal) / prevTotal) * 100);
    if (Math.abs(diff) < 5) s += " Almost exactly the same as last week.";
    else if (diff > 0) s += ` That is ${diff}% more than last week.`;
    else s += ` That is ${-diff}% less than last week.`;
  }
  return s;
}

function renderReport() {
  const t = todayKey();
  const current = weekStart(t);
  const start = reportWeek;
  const days = weekData(start);
  const prev = weekData(addDays(start, -7));
  const total = days.reduce((s, d) => s + d.study, 0);
  const prevTotal = prev.reduce((s, d) => s + d.study, 0);

  $("report-range").textContent = rangeLabel(start);
  $("next-week").disabled = start >= current;

  const inProgress = start === current && parseKey(t).getDay() !== 6;
  $("report-title").textContent = inProgress ? "Week in progress" : "Weekly report";
  $("report-total").textContent = hm(total);

  const delta = $("report-delta");
  delta.className = "sub";
  if (prevTotal >= 60000 && total >= 60000) {
    const diff = Math.round(((total - prevTotal) / prevTotal) * 100);
    delta.textContent = `${diff >= 0 ? "+" : ""}${diff}% vs last week`;
    delta.classList.add(diff >= 0 ? "up" : "down");
  } else {
    delta.textContent = "studied this week";
  }
  $("report-summary").textContent = summarize(days, total, prevTotal);

  /* chart */
  const max = Math.max(3600000, ...days.map((d) => d.study));
  const bestKey = total > 0 ? days.reduce((a, b) => (b.study > a.study ? b : a)).key : null;
  const chart = $("chart");
  chart.innerHTML = days.map((d) => {
    const cls = d.study < 60000 ? "empty" : d.key === bestKey ? "best" : "";
    return `<div class="col ${cls}">
      <span class="v">${shortHours(d.study)}</span>
      <div class="bar-wrap"><div class="bar" style="height:${Math.max(2, (d.study / max) * 100)}%"></div></div>
    </div>`;
  }).join("");
  let labels = chart.nextElementSibling;
  if (!labels || !labels.classList.contains("chart-days")) {
    labels = document.createElement("div");
    labels.className = "chart-days";
    chart.after(labels);
  }
  labels.innerHTML = days.map((d) => `<span>${DAYS[parseKey(d.key).getDay()].slice(0, 3)}</span>`).join("");

  /* stats */
  const studied = days.filter((d) => d.study >= 60000);
  const breaks = days.reduce((s, d) => s + d.breaks, 0);
  const pauses = days.reduce((s, d) => s + d.pauses, 0);
  const sessions = days.reduce((s, d) => s + d.sessions, 0);
  const focus = total + breaks > 0 ? Math.round((total / (total + breaks)) * 100) : 0;
  const best = studied.length ? studied.reduce((a, b) => (b.study > a.study ? b : a)) : null;
  const rows = [
    ["Days studied", `${studied.length}<small>of 7</small>`],
    ["Daily average", studied.length ? hm(total / studied.length) : "—"],
    ["Best day", best ? `${DAYS[parseKey(best.key).getDay()]}<small>${hm(best.study)}</small>` : "—"],
    ["Focus", total ? `${focus}%<small>of time on task</small>` : "—"],
    ["Breaks", `${pauses}<small>${hm(breaks)}</small>`],
    ["Sessions", `${sessions}`],
  ];
  $("stats").innerHTML = rows.map(([k, v]) => `<div class="stat"><dt>${k}</dt><dd>${v}</dd></div>`).join("");
}

/* ---------- views ---------- */

let view = "today";
function show(v, opts = {}) {
  view = v;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.view === v));
  $("view-today").hidden = v !== "today";
  $("view-report").hidden = v !== "report";
  const notice = $("report-notice");
  notice.hidden = !opts.notice;
  if (opts.notice) notice.textContent = opts.notice;
  if (v === "report") {
    reportWeek = opts.week || defaultReportWeek();
    renderReport();
  } else {
    renderToday();
  }
}

/* On Saturday, the current week. Otherwise, the last finished week. */
function defaultReportWeek() {
  const t = todayKey();
  return parseKey(t).getDay() === 6 ? weekStart(t) : addDays(weekStart(t), -7);
}

/* Decide, from the PC's date alone, whether a report should open by itself. */
function autoReport() {
  const t = todayKey();
  const thisWeek = weekStart(t);
  const lastWeek = addDays(thisWeek, -7);
  const hasData = (w) => weekData(w).some((d) => d.study > 0);

  if (parseKey(t).getDay() === 6 && !state.seen[thisWeek]) {
    state.seen[thisWeek] = true;
    save();
    return { week: thisWeek, notice: "It's Saturday. Here is how your week went." };
  }
  if (!state.seen[lastWeek] && hasData(lastWeek)) {
    state.seen[lastWeek] = true;
    save();
    return { week: lastWeek, notice: "You missed Saturday, so here is last week's report." };
  }
  return null;
}

function commitAndRender() {
  save();
  if (view === "today") renderToday();
  else renderReport();
}

/* ---------- demo data (for screenshots, ?demo) ---------- */

function seedDemo() {
  const t = todayKey();
  const ws = weekStart(t);
  const h = 3600000, m = 60000;
  const plan = [
    [-7, 0], [-6, 2 * h + 10 * m], [-5, 3 * h + 5 * m], [-4, 0], [-3, 2 * h + 40 * m], [-2, 1 * h + 50 * m], [-1, 2 * h + 20 * m],
    [0, 1 * h + 15 * m], [1, 2 * h + 40 * m], [2, 4 * h + 10 * m], [3, 1 * h + 35 * m], [4, 3 * h + 20 * m], [5, 0], [6, 1 * h + 45 * m],
  ];
  for (const [off, study] of plan) {
    const k = addDays(ws, off);
    if (k > t) continue;
    if (k === t && params.get("state") !== "closed") continue;
    if (!study) continue;
    const pauses = Math.max(1, Math.round(study / (50 * m)));
    state.days[k] = { study, breaks: pauses * 7 * m, pauses, sessions: 1, closed: true };
  }
  const st = params.get("state");
  if (st === "running" || st === "paused") {
    state.active = {
      date: t, status: st, since: now() - (st === "paused" ? 4 * m + 12000 : 0),
      study: 1 * h + 24 * m + 7000, breaks: 6 * m, pauses: 1,
    };
  }
  state.seen = {};
}

/* ---------- boot ---------- */

(async function boot() {
  await load();
  settleStaleSession();

  document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => show(t.dataset.view)));
  $("prev-week").addEventListener("click", () => { reportWeek = addDays(reportWeek, -7); $("report-notice").hidden = true; renderReport(); });
  $("next-week").addEventListener("click", () => { reportWeek = addDays(reportWeek, 7); $("report-notice").hidden = true; renderReport(); });

  const auto = DEMO ? (params.get("view") === "report" ? { week: weekStart(todayKey()), notice: params.get("notice") || null } : null) : autoReport();
  if (auto) show("report", auto);
  else show("today");

  /* tick: update the clock; re-render everything when the date changes */
  let lastDay = todayKey();
  setInterval(() => {
    if (todayKey() !== lastDay) {
      lastDay = todayKey();
      settleStaleSession();
      const a = autoReport();
      if (a) return show("report", a);
      return view === "today" ? renderToday() : renderReport();
    }
    if (view === "today") {
      renderTimer();
      if (state.active && state.active.status === "running") renderWeekStrip();
    } else if (state.active) {
      renderReport();
    }
  }, 500);
})();
