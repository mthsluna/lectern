"use strict";

/* ------------------------------------------------------------------ *
 * Lectern — a quiet study timer with a weekly report.
 *
 * Model
 *   lang             = language code chosen on first launch
 *   days[YYYY-MM-DD] = { study, breaks, pauses, sessions, closed }
 *   active           = { date, status: "running" | "paused", since,
 *                        study, breaks, pauses }  (null when idle)
 *   seen             = { [weekStartKey]: true }    reports already shown
 *
 * Time is always derived from timestamps, so closing the window while
 * the timer runs loses nothing: it keeps counting from `since`.
 * ------------------------------------------------------------------ */

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

/* ---------- language ---------- */

let lang = "en";
const langInfo = (code) => LANGS.find((l) => l.code === code) || LANGS[0];
const locale = () => langInfo(lang).locale;

function t(key, ...args) {
  const v = (STRINGS[lang] && STRINGS[lang][key]) ?? STRINGS.en[key];
  return typeof v === "function" ? v(...args) : v;
}

/* Best guess from the system, used only to word the picker's question. */
function systemLang() {
  for (const l of navigator.languages || [navigator.language || "en"]) {
    const code = l.toLowerCase().split("-")[0];
    if (STRINGS[code]) return code;
  }
  return "en";
}

function applyLanguage() {
  const info = langInfo(lang);
  document.documentElement.lang = info.code;
  document.documentElement.dir = info.rtl ? "rtl" : "ltr";
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  $("lang-btn").textContent = info.code.toUpperCase();
  applyTheme();
}

/* ---------- theme: system → light → dark ---------- */

const THEMES = ["system", "light", "dark"];

function applyTheme() {
  const theme = THEMES.includes(state.theme) ? state.theme : "system";
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  const btn = $("theme-btn");
  btn.dataset.mode = theme;
  btn.title = t(`theme_${theme}`);
  btn.setAttribute("aria-label", t(`theme_${theme}`));
}

function cycleTheme() {
  const i = THEMES.indexOf(state.theme || "system");
  state.theme = THEMES[(i + 1) % THEMES.length];
  save();
  applyTheme();
}

function showPicker() {
  const shown = state.lang || systemLang();
  const prev = lang;
  lang = shown;
  applyLanguage();
  $("picker-title").textContent = t("pickTitle");
  $("picker-sub").textContent = t("pickSub");
  lang = prev;

  const list = $("langs");
  list.innerHTML = "";
  for (const l of LANGS) {
    const b = document.createElement("button");
    b.className = "lang" + (l.code === shown ? " is-current" : "");
    b.lang = l.code;
    b.dir = l.rtl ? "rtl" : "ltr";
    b.textContent = l.name;
    b.addEventListener("click", () => chooseLanguage(l.code));
    list.appendChild(b);
  }
  $("app").hidden = true;
  $("picker").hidden = false;
}

function chooseLanguage(code) {
  const first = !state.lang;
  state.lang = lang = code;
  save();
  applyLanguage();
  $("picker").hidden = true;
  $("app").hidden = false;
  if (first) openStartView();
  else show(view);
}

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
const isSaturday = (k) => parseKey(k).getDay() === 6;

const fmt = (k, opts) => new Intl.DateTimeFormat(locale(), opts).format(parseKey(k));
const dayName = (k, style = "long") => fmt(k, { weekday: style });
const cap = (s) => s.charAt(0).toLocaleUpperCase(locale()) + s.slice(1);

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
  const f = new Intl.DateTimeFormat(locale(), { month: "short", day: "numeric", year: "numeric" });
  const a = parseKey(start), b = parseKey(addDays(start, 6));
  return f.formatRange ? f.formatRange(a, b) : `${f.format(a)} – ${f.format(b)}`;
}

/* ---------- storage ---------- */

let state = { version: 1, lang: null, theme: "system", goal: null, days: {}, active: null, seen: {} };
let draftSubject = "";

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
  return state.days[k] || (state.days[k] = { study: 0, breaks: 0, pauses: 0, sessions: 0, closed: false, subjects: {} });
}

function start() {
  const k = todayKey();
  if (state.days[k]) state.days[k].closed = false;
  const subject = draftSubject.trim().slice(0, 40);
  state.active = { date: k, status: "running", since: now(), study: 0, breaks: 0, pauses: 0, subject };
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
  d.subjects = d.subjects || {};
  const s = a.subject || "";
  d.subjects[s] = (d.subjects[s] || 0) + a.study;
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
  const out = { study: d.study, breaks: d.breaks, pauses: d.pauses, sessions: d.sessions, closed: d.closed,
    subjects: { ...(d.subjects || {}) } };
  const a = state.active;
  if (a && a.date === k) {
    const el = now() - a.since;
    const live = a.study + (a.status === "running" ? el : 0);
    out.study += live;
    out.breaks += a.breaks + (a.status === "paused" ? el : 0);
    out.pauses += a.pauses;
    out.sessions += 1;
    const s = a.subject || "";
    out.subjects[s] = (out.subjects[s] || 0) + live;
  }
  return out;
}

/* Consecutive days with at least a minute of study, ending today
   (or yesterday, so a streak is not "lost" before you sit down). */
function streak() {
  let k = todayKey();
  if (liveFor(k).study < 60000) k = addDays(k, -1);
  let n = 0;
  while (liveFor(k).study >= 60000) { n++; k = addDays(k, -1); }
  return n;
}

/* Every subject used before, most studied first (for suggestions). */
function knownSubjects() {
  const totals = {};
  for (const d of Object.values(state.days)) {
    for (const [s, ms] of Object.entries(d.subjects || {})) if (s) totals[s] = (totals[s] || 0) + ms;
  }
  return Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
}

/* Totals of every earlier week that has data, to spot a personal best. */
function previousWeekTotals(start) {
  const weeks = {};
  for (const [k, d] of Object.entries(state.days)) {
    const w = weekStart(k);
    if (w < start) weeks[w] = (weeks[w] || 0) + d.study;
  }
  return Object.values(weeks).filter((v) => v >= 60000);
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
  if (s === "idle") btn(t("start"), "btn-primary", start).title = "Space";
  if (s === "running") btn(t("pause"), "btn-primary", pause).title = "Space";
  if (s === "paused") btn(t("resume"), "btn-primary", resume).title = "Space";
  if (s === "running" || s === "paused") {
    const b = btn(t("stop"), "btn-ghost", armStop);
    b.id = "stop-btn";
    b.title = "S";
  }
  if (s === "closed") btn(t("startAnother"), "btn-link", start);

  /* the optional subject field only exists before a session starts */
  const idle = s === "idle" || s === "closed";
  $("subject-wrap").hidden = !idle;
  if (idle) {
    $("subject").value = draftSubject;
    $("subject-list").innerHTML = knownSubjects().slice(0, 12)
      .map((x) => `<option value="${x.replace(/"/g, "&quot;")}">`).join("");
  }
}

/* Stop takes two presses, so it never happens by accident. */
function armStop() {
  const b = $("stop-btn");
  if (!b) return;
  if (b.dataset.armed) { clearTimeout(confirmTimer); return stop(); }
  b.dataset.armed = "1";
  b.textContent = t("confirmStop");
  b.className = "btn btn-warn";
  confirmTimer = setTimeout(renderControls, 3000);
}

function renderTimer() {
  const s = currentState();
  document.body.dataset.state = s;
  const a = state.active;
  const k = a ? a.date : todayKey();
  $("timer").textContent = clock(liveFor(k).study);

  let text = t("ready");
  if (s === "running") text = a.subject ? `${t("studying")} · ${a.subject}` : t("studying");
  if (s === "paused") text = `${t("onBreak")} · ${clock(now() - a.since).replace(/^00:/, "")}`;
  if (s === "closed") text = t("done");
  if (a && a.date !== todayKey()) text += ` · ${t("startedYesterday")}`;
  $("status-text").textContent = text;
}

function renderWeekStrip() {
  const today = todayKey();
  const days = weekData(weekStart(today));
  const max = Math.max(3600000, ...days.map((d) => d.study));
  const strip = $("strip");
  strip.innerHTML = "";
  let total = 0;
  for (const d of days) {
    total += d.study;
    const el = document.createElement("div");
    el.className = "day" + (d.study > 0 ? " has" : "") + (d.key === today ? " is-today" : "");
    el.title = `${cap(dayName(d.key))} · ${hm(d.study)}`;
    el.innerHTML = `<div class="bar-wrap"><div class="bar" style="height:${Math.max(4, (d.study / max) * 100)}%"></div></div>
      <span class="d">${dayName(d.key, "narrow")}</span>`;
    strip.appendChild(el);
  }
  $("week-total").textContent = hm(total);

  /* weekly goal: a hairline of progress, nothing more */
  const goal = state.goal;
  $("week-goal").textContent = goal ? ` / ${goal}h` : "";
  $("goal-track").hidden = !goal;
  if (goal) {
    const pct = Math.min(1, total / (goal * 3600000));
    $("goal-fill").style.width = `${pct * 100}%`;
    $("goal-fill").classList.toggle("done", pct >= 1);
  }
  if ($("goal-edit").hidden) $("goal-btn").textContent = goal ? t("goal") : t("setGoal");

  const left = 6 - parseKey(today).getDay();
  const n = streak();
  $("week-hint").textContent = left === 0 ? t("reportReady") : t("reportIn", left);
  $("week-streak").textContent = n >= 2 ? ` · ${t("streak", n)}` : "";
}

function openGoalEditor() {
  $("goal-btn").hidden = true;
  $("goal-edit").hidden = false;
  const input = $("goal-input");
  input.value = state.goal || "";
  input.placeholder = "10";
  input.focus();
  input.select();
}
function closeGoalEditor(saveIt) {
  if ($("goal-edit").hidden) return;
  if (saveIt) {
    const v = Math.round(Number($("goal-input").value));
    state.goal = v >= 1 && v <= 100 ? v : null;   // empty or 0 removes the goal
    save();
  }
  $("goal-edit").hidden = true;
  $("goal-btn").hidden = false;
  renderWeekStrip();
}

function renderToday() {
  $("today-date").textContent = fmt(todayKey(), { weekday: "long", month: "long", day: "numeric" });
  renderTimer();
  renderControls();
  renderWeekStrip();
}

/* ---------- rendering: report ---------- */

let reportWeek = null;

function percentDiff(total, prev) {
  return Math.round(((total - prev) / prev) * 100);
}

function summarize(days, total, prevTotal, best) {
  const base = summarizeBase(days, total, prevTotal);
  return best ? base + t("space") + t("bestWeek") : base;
}

function summarizeBase(days, total, prevTotal) {
  const studied = days.filter((d) => d.study >= 60000);
  if (total < 60000) return t("quiet");
  const best = studied.reduce((a, b) => (b.study > a.study ? b : a));
  const n = studied.length;
  const lead = t("leads")[n >= 6 ? 0 : n >= 4 ? 1 : n >= 2 ? 2 : 3];
  const day = dayName(best.key);
  let s = lead + t("sep") + (n === 1 ? t("single", day, hm(best.study)) : t("many", n, day, hm(best.study)));
  if (prevTotal >= 60000) {
    const diff = percentDiff(total, prevTotal);
    const tail = Math.abs(diff) < 5 ? t("same") : diff > 0 ? t("more", diff) : t("less", -diff);
    s += t("space") + tail;
  }
  return s;
}

function renderReport() {
  const today = todayKey();
  const current = weekStart(today);
  const start = reportWeek;
  const days = weekData(start);
  const total = days.reduce((s, d) => s + d.study, 0);
  const prevTotal = weekData(addDays(start, -7)).reduce((s, d) => s + d.study, 0);

  $("report-range").textContent = rangeLabel(start);
  $("next-week").disabled = start >= current;

  const inProgress = start === current && !isSaturday(today);
  $("report-title").textContent = inProgress ? t("weekInProgress") : t("weeklyReport");
  $("report-total").textContent = hm(total);

  const delta = $("report-delta");
  delta.className = "sub";
  if (prevTotal >= 60000 && total >= 60000) {
    const diff = percentDiff(total, prevTotal);
    delta.textContent = t("vsLast", `${diff >= 0 ? "+" : "−"}${Math.abs(diff)}%`);
    delta.classList.add(diff >= 0 ? "up" : "down");
  } else {
    delta.textContent = t("studiedThisWeek");
  }
  const earlier = previousWeekTotals(start);
  const personalBest = earlier.length > 0 && total > Math.max(...earlier);
  $("report-summary").textContent = summarize(days, total, prevTotal, personalBest);

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
  labels.innerHTML = days.map((d) => `<span>${dayName(d.key, "short")}</span>`).join("");

  /* stats */
  const studied = days.filter((d) => d.study >= 60000);
  const breaks = days.reduce((s, d) => s + d.breaks, 0);
  const pauses = days.reduce((s, d) => s + d.pauses, 0);
  const sessions = days.reduce((s, d) => s + d.sessions, 0);
  const focus = total + breaks > 0 ? Math.round((total / (total + breaks)) * 100) : 0;
  const best = studied.length ? studied.reduce((a, b) => (b.study > a.study ? b : a)) : null;
  const rows = [
    [t("daysStudied"), `${studied.length}<small>${t("of7")}</small>`],
    [t("dailyAvg"), studied.length ? hm(total / studied.length) : "—"],
    [t("bestDay"), best ? `${cap(dayName(best.key))}<small>${hm(best.study)}</small>` : "—"],
    [t("focus"), total ? `${focus}%<small>${t("onTask")}</small>` : "—"],
    [t("breaks"), `${pauses}<small>${hm(breaks)}</small>`],
    state.goal
      ? [t("goal"), total >= state.goal * 3600000
          ? `${t("reached")}<small>${state.goal}h</small>`
          : `${Math.round((total / (state.goal * 3600000)) * 100)}%<small>${t("goalOf", state.goal)}</small>`]
      : [t("sessions"), `${sessions}`],
  ];
  $("stats").innerHTML = rows.map(([k, v]) => `<div class="stat"><dt>${k}</dt><dd>${v}</dd></div>`).join("");

  /* subjects: only when at least one session was labelled */
  const bySubject = {};
  for (const d of days) for (const [s, ms] of Object.entries(d.subjects || {})) bySubject[s] = (bySubject[s] || 0) + ms;
  const entries = Object.entries(bySubject).filter(([, ms]) => ms >= 60000).sort((a, b) => b[1] - a[1]);
  const labelled = entries.some(([s]) => s);
  $("subjects").hidden = !labelled;
  if (labelled) {
    const top = entries[0][1];
    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    $("subject-rows").innerHTML = entries.map(([s, ms]) => `<li${s ? "" : ' class="none"'}>
        <span class="s-name">${s ? esc(s) : t("unlabeled")}</span>
        <span class="s-bar"><span style="width:${(ms / top) * 100}%"></span></span>
        <span class="s-time">${hm(ms)}</span>
      </li>`).join("");
  }
}

/* ---------- views ---------- */

let view = "today";
function show(v, opts = {}) {
  view = v;
  document.querySelectorAll(".tab[data-view]").forEach((el) => el.classList.toggle("is-active", el.dataset.view === v));
  $("view-today").hidden = v !== "today";
  $("view-report").hidden = v !== "report";
  const notice = $("report-notice");
  notice.hidden = !opts.notice;
  if (opts.notice) notice.textContent = opts.notice;
  if (v === "report") {
    reportWeek = opts.week || reportWeek || defaultReportWeek();
    renderReport();
  } else {
    renderToday();
  }
}

/* On Saturday, the current week. Otherwise, the last finished week. */
function defaultReportWeek() {
  const today = todayKey();
  return isSaturday(today) ? weekStart(today) : addDays(weekStart(today), -7);
}

/* Decide, from the PC's date alone, whether a report should open by itself. */
function autoReport() {
  const today = todayKey();
  const thisWeek = weekStart(today);
  const lastWeek = addDays(thisWeek, -7);
  const hasData = (w) => weekData(w).some((d) => d.study > 0);

  if (isSaturday(today) && !state.seen[thisWeek]) {
    state.seen[thisWeek] = true;
    save();
    return { week: thisWeek, notice: t("saturday") };
  }
  if (!state.seen[lastWeek] && hasData(lastWeek)) {
    state.seen[lastWeek] = true;
    save();
    return { week: lastWeek, notice: t("missed") };
  }
  return null;
}

function openStartView() {
  let auto;
  if (DEMO) auto = params.get("view") === "report" ? { week: weekStart(todayKey()), notice: params.get("notice") ? t("saturday") : null } : null;
  else auto = autoReport();
  if (auto) show("report", auto);
  else show("today");
}

function commitAndRender() {
  save();
  if (view === "today") renderToday();
  else renderReport();
}

/* ---------- demo data (for screenshots, ?demo) ---------- */

function seedDemo() {
  const today = todayKey();
  const ws = weekStart(today);
  const h = 3600000, m = 60000;
  const plan = [
    [-7, 0], [-6, 2 * h + 10 * m], [-5, 3 * h + 5 * m], [-4, 0], [-3, 2 * h + 40 * m], [-2, 1 * h + 50 * m], [-1, 2 * h + 20 * m],
    [0, 1 * h + 15 * m], [1, 2 * h + 40 * m], [2, 4 * h + 10 * m], [3, 1 * h + 35 * m], [4, 3 * h + 20 * m], [5, 0], [6, 1 * h + 45 * m],
  ];
  for (const [off, study] of plan) {
    const k = addDays(ws, off);
    if (k > today) continue;
    if (k === today && params.get("state") !== "closed") continue;
    if (!study) continue;
    const pauses = Math.max(1, Math.round(study / (50 * m)));
    const subjects = ["Calculus", "Organic chemistry", "History"];
    const main = subjects[(off + 14) % 3];
    const side = subjects[(off + 15) % 3];
    const split = Math.round(study * 0.65);
    state.days[k] = { study, breaks: pauses * 7 * m, pauses, sessions: 1, closed: true,
      subjects: { [main]: split, [side]: study - split } };
  }
  state.goal = 15;
  const st = params.get("state");
  if (st === "running" || st === "paused") {
    state.active = {
      date: today, status: st, since: now() - (st === "paused" ? 4 * m + 12000 : 0),
      study: 1 * h + 24 * m + 7000, breaks: 6 * m, pauses: 1, subject: "Calculus",
    };
  }
  state.lang = params.has("pick") ? null : params.get("lang") || "en";
  state.seen = {};
}

/* ---------- boot ---------- */

(async function boot() {
  await load();
  settleStaleSession();

  document.querySelectorAll(".tab[data-view]").forEach((el) => el.addEventListener("click", () => show(el.dataset.view)));
  $("lang-btn").addEventListener("click", showPicker);
  $("theme-btn").addEventListener("click", cycleTheme);
  $("prev-week").addEventListener("click", () => { reportWeek = addDays(reportWeek, -7); $("report-notice").hidden = true; renderReport(); });
  $("next-week").addEventListener("click", () => { reportWeek = addDays(reportWeek, 7); $("report-notice").hidden = true; renderReport(); });

  /* subject field */
  $("subject").addEventListener("input", (e) => { draftSubject = e.target.value; });
  $("subject").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); e.target.blur(); start(); }
  });

  /* weekly goal editor */
  $("goal-btn").addEventListener("click", openGoalEditor);
  $("goal-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter") closeGoalEditor(true);
    if (e.key === "Escape") closeGoalEditor(false);
  });
  $("goal-input").addEventListener("blur", () => closeGoalEditor(true));

  /* keyboard: Space start/pause/resume, S stop (twice), ←/→ change week */
  document.addEventListener("keydown", (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if ((el && el.closest("input, textarea, button")) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (!$("picker").hidden) return;
    if (view === "today") {
      if (e.code === "Space") {
        e.preventDefault();
        const s = currentState();
        if (s === "idle" || s === "closed") start();
        else if (s === "running") pause();
        else resume();
      } else if (e.key.toLowerCase() === "s") {
        armStop();
      }
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const dir = (e.key === "ArrowRight") !== (document.documentElement.dir === "rtl") ? 1 : -1;
      (dir > 0 ? $("next-week") : $("prev-week")).click();
    }
  });

  if (!state.lang || !STRINGS[state.lang]) {
    state.lang = null;
    showPicker();
  } else {
    lang = state.lang;
    applyLanguage();
    $("app").hidden = false;
    openStartView();
  }

  /* tick: update the clock; re-render everything when the date changes */
  let lastDay = todayKey();
  setInterval(() => {
    if (!state.lang || !$("picker").hidden) return;
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
