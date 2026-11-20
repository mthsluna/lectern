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
  document.querySelectorAll("[data-i18n-label]").forEach((el) => { el.setAttribute("aria-label", t(el.dataset.i18nLabel)); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  $("lang-btn").textContent = info.code.toUpperCase();
  applyTheme();
  if (pendingUpdate) renderUpdate($("update").dataset.phase || "offer");
}

/* ---------- theme: sun or moon, one click ---------- */

/* "system" is only the starting point; the first click picks a side. */
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const effectiveTheme = () =>
  state.theme === "light" || state.theme === "dark" ? state.theme : darkQuery.matches ? "dark" : "light";

function applyTheme() {
  if (state.theme === "light" || state.theme === "dark") document.documentElement.dataset.theme = state.theme;
  else delete document.documentElement.dataset.theme;
  const current = effectiveTheme();
  const btn = $("theme-btn");
  btn.dataset.mode = current;
  // the label names what a click will do
  const next = current === "dark" ? "light" : "dark";
  btn.title = t(`theme_${next}`);
  btn.setAttribute("aria-label", t(`theme_${next}`));
}

function toggleTheme() {
  state.theme = effectiveTheme() === "dark" ? "light" : "dark";
  save();
  applyTheme();

  // sunset into moonrise, or moonset into sunrise
  const btn = $("theme-btn");
  btn.classList.remove("to-dark", "to-light");
  void btn.offsetWidth;                       // restart if clicked mid-animation
  btn.classList.add(state.theme === "dark" ? "to-dark" : "to-light");
  clearTimeout(toggleTheme.timer);
  toggleTheme.timer = setTimeout(() => btn.classList.remove("to-dark", "to-light"), 1100);
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
/* "18 – 24 de outubro" + "2026": the days lead, the year steps back.
   Weeks that span two months use short month names to stay on one line. */
function rangeLabel(start) {
  const a = parseKey(start), b = parseKey(addDays(start, 6));
  const month = a.getMonth() === b.getMonth() ? "long" : "short";
  const f = new Intl.DateTimeFormat(locale(), { day: "numeric", month });
  const main = f.formatRange ? f.formatRange(a, b) : `${f.format(a)} – ${f.format(b)}`;
  const y1 = a.getFullYear(), y2 = b.getFullYear();
  return { main, year: y1 === y2 ? String(y1) : `${y1} – ${y2}` };
}

/* ---------- storage ---------- */

/* Classic Pomodoro: 25 minutes of focus, 5 of rest, 15 after every fourth. */
const POMO_DEFAULTS = { on: false, focus: 25, short: 5, long: 15, every: 4, rest: "celesta", back: "shine", volume: 0.8 };
const SOUNDS = ["reminder","shine","bell","celesta","marimba","kalimba","musicbox","ding"];
let state = { version: 1, lang: null, theme: "system", goal: null, days: {}, active: null, seen: {}, pomo: { ...POMO_DEFAULTS } };
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

/* ---------- sessions that cross midnight ----------
 *
 * A session keeps its own per-day ledger, active.days[YYYY-MM-DD] =
 * { study, breaks, pauses }. Every stretch of studying or pausing is cut at
 * local midnight, so 22:00 to 03:00 counts 2 h on the first day and 3 h on
 * the next, in the chart, the streak, the goal and the subjects alike.
 */

/* Splits [t0, t1) at local midnights: [{ key, ms }, ...] */
function splitByDay(t0, t1) {
  const parts = [];
  let t = t0;
  while (t < t1) {
    const d = new Date(t);
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    const end = Math.min(next, t1);
    parts.push({ key: keyOf(d), ms: end - t });
    t = end;
  }
  return parts;
}

function ledger(a, k) {
  return a.days[k] || (a.days[k] = { study: 0, breaks: 0, pauses: 0 });
}

/* Books the stretch since the last change as study or break time. */
function bank(a, field) {
  for (const { key, ms } of splitByDay(a.since, now())) ledger(a, key)[field] += ms;
  a.since = now();
}

/* Sessions saved by Lectern 1.8 and earlier kept one total; give it a ledger. */
function migrateActive(a) {
  if (!a || a.days) return;
  a.days = { [a.date]: { study: a.study || 0, breaks: a.breaks || 0, pauses: a.pauses || 0 } };
  delete a.study; delete a.breaks; delete a.pauses;
}

function start() {
  const k = todayKey();
  if (state.days[k]) state.days[k].closed = false;
  const subject = draftSubject.trim().slice(0, 40);
  state.active = { date: k, status: "running", since: now(), subject, days: {} };
  if (state.pomo.on) {
    const len = state.pomo.focus * 60000;
    state.active.pomo = { phase: "focus", count: 0, len, left: len, ends: now() + len };
  }
  commitAndRender();
}
function pause() {
  const a = state.active;
  bank(a, "study");
  ledger(a, todayKey()).pauses += 1;
  a.status = "paused";
  if (a.pomo && a.pomo.ends) { a.pomo.left = Math.max(0, a.pomo.ends - now()); a.pomo.ends = null; }
  commitAndRender();
}
function resume() {
  const a = state.active;
  bank(a, "breaks");
  a.status = "running";
  if (a.pomo) {
    if (a.pomo.phase !== "focus") {
      // skipping the rest of a break starts the next focus block
      a.pomo.phase = "focus";
      a.pomo.len = a.pomo.left = state.pomo.focus * 60000;
    }
    a.pomo.ends = now() + a.pomo.left;
  }
  commitAndRender();
}

/* ---------- Pomodoro ----------
 * Focus blocks are study time and breaks are break time, so the report,
 * the streak and the goal count a Pomodoro day like any other.
 */

let pomoTimer = null;

function pomoLeft(a) {
  const p = a && a.pomo;
  if (!p) return state.pomo.focus * 60000;
  return p.ends ? Math.max(0, p.ends - now()) : p.left;
}

function pomoSchedule() {
  clearTimeout(pomoTimer);
  const p = state.active && state.active.pomo;
  if (p && p.ends) pomoTimer = setTimeout(pomoTick, Math.max(0, p.ends - now()) + 30);
}

function pomoTick() {
  const a = state.active;
  const p = a && a.pomo;
  if (!p || !p.ends || now() < p.ends) return;
  if (p.phase === "focus") {
    p.count += 1;
    const long = p.count % state.pomo.every === 0;
    bank(a, "study");
    ledger(a, todayKey()).pauses += 1;
    a.status = "paused";
    p.phase = long ? "long" : "short";
    p.len = p.left = (long ? state.pomo.long : state.pomo.short) * 60000;
    p.ends = now() + p.len;
    playSound(state.pomo.rest);
  } else {
    bank(a, "breaks");
    a.status = "running";
    p.phase = "focus";
    p.len = p.left = state.pomo.focus * 60000;
    p.ends = now() + p.len;
    playSound(state.pomo.back);
  }
  if (view === "today") replay($("timer"), "kick");
  commitAndRender();
}

let audio = null;
function playSound(name, volume = state.pomo.volume) {
  if (!name || name === "none" || !SOUNDS.includes(name)) return;
  try {
    if (audio) audio.pause();
    audio = new Audio(`sounds/${name}.mp3`);
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.play().catch(() => {});
  } catch (e) { /* no sound is never an error */ }
}

function setMode(on) {
  if (state.active) {                              // a session keeps the mode it began with
    const m = $("mode");
    m.title = t("pomoLocked");
    replay(m, "nudge");
    return;
  }
  if (state.pomo.on === on) return;
  state.pomo.on = on;
  if (!on) closePomoPanel();
  save();
  renderMode(true);
  renderTimer();
}

function renderMode(animate = false) {
  const on = state.pomo.on;
  const m = $("mode");
  m.dataset.mode = on ? "pomo" : "free";
  m.classList.toggle("locked", Boolean(state.active));
  if (!state.active) m.title = "";
  m.querySelectorAll(".mode-opt").forEach((b) => b.setAttribute("aria-checked", String((b.dataset.mode === "pomo") === on)));
  const gear = $("pomo-gear");
  const wasHidden = gear.hidden;
  gear.hidden = !on;
  if (on && wasHidden && animate) replay(gear, "pop");
}

/* settings popover */
let soundEvent = "rest";
const STEPS = [
  { key: "focus", label: "focusLen", unit: "minUnit", min: 5, max: 120, step: 5 },
  { key: "short", label: "shortLen", unit: "minUnit", min: 1, max: 30, step: 1 },
  { key: "long", label: "longLen", unit: "minUnit", min: 5, max: 60, step: 5 },
  { key: "every", label: "longEvery", unit: "roundsUnit", min: 2, max: 8, step: 1 },
];

function renderPomoPanel() {
  $("pomo-rows").innerHTML = STEPS.map((s) => `<div class="pp-row" data-key="${s.key}">
      <span class="pp-label">${t(s.label)}</span>
      <span class="pp-step">
        <button data-d="-1" aria-label="−"${state.pomo[s.key] <= s.min ? " disabled" : ""}><svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M2.5 6h7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>
        <span class="pp-val"><b>${state.pomo[s.key]}</b> ${t(s.unit)}</span>
        <button data-d="1" aria-label="+"${state.pomo[s.key] >= s.max ? " disabled" : ""}><svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true"><path d="M2.5 6h7M6 2.5v7" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></button>
      </span>
    </div>`).join("");
  $("pomo-sound-tabs").querySelectorAll("button").forEach((b) => b.classList.toggle("is-on", b.dataset.event === soundEvent));
  const chosen = state.pomo[soundEvent];
  $("pomo-sounds").innerHTML = [...SOUNDS, "none"].map((n) => `<button class="pp-snd${n === chosen ? " is-on" : ""}" data-sound="${n}">`
    + (n === "none"
      ? `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 6.5v3h2.3l3 2.4V4.1l-3 2.4Z" fill="currentColor"/><path d="m10.6 6.2 3 3.6m0-3.6-3 3.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>`
      : `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M5.5 3.8v8.4L12 8Z" fill="currentColor"/></svg>`)
    + `<span>${t("snd_" + n)}</span></button>`).join("");
  $("pomo-volume").value = Math.round(state.pomo.volume * 100);
}

function togglePomoPanel() {
  if (!$("pomo-panel").hidden && !$("pomo-panel").classList.contains("closing")) return closePomoPanel();
  clearTimeout(closePomoPanel.timer);
  const p = $("pomo-panel");
  p.classList.remove("closing");
  renderPomoPanel();
  p.hidden = false;
  $("pomo-gear").setAttribute("aria-expanded", "true");
}
function closePomoPanel() {
  const p = $("pomo-panel");
  if (p.hidden || p.classList.contains("closing")) return;
  $("pomo-gear").setAttribute("aria-expanded", "false");
  p.classList.add("closing");
  clearTimeout(closePomoPanel.timer);
  closePomoPanel.timer = setTimeout(() => { p.hidden = true; p.classList.remove("closing"); }, 170);
}
function stop() {
  const a = state.active;
  if (a.status === "running") bank(a, "study");
  closeActive(a);
  commitAndRender();
}

/* Moves the session's ledger into the days. The session counts once, on the
   day it began, and that day is the one marked as done. */
function closeActive(a) {
  const s = a.subject || "";
  for (const [k, part] of Object.entries(a.days)) {
    const d = dayRec(k);
    d.study += part.study;
    d.breaks += part.breaks;
    d.pauses += part.pauses;
    d.subjects = d.subjects || {};
    if (part.study > 0) d.subjects[s] = (d.subjects[s] || 0) + part.study;
  }
  const first = dayRec(a.date);
  first.sessions += 1;
  first.closed = true;
  state.active = null;
}

/* A break left open past midnight ends the session at the moment of the
   pause: the hours spent asleep are not a break. */
function settleStaleSession() {
  const a = state.active;
  if (a && a.status === "paused" && !(a.pomo && a.pomo.phase !== "focus") && keyOf(new Date(a.since)) < todayKey()) {
    closeActive(a);
    save();
  }
}

/* Live totals for a given day, including the part of the running session
   that falls on it. */
function liveFor(k) {
  const d = state.days[k] || { study: 0, breaks: 0, pauses: 0, sessions: 0, closed: false };
  const out = { study: d.study, breaks: d.breaks, pauses: d.pauses, sessions: d.sessions, closed: d.closed,
    subjects: { ...(d.subjects || {}) } };
  const a = state.active;
  if (!a) return out;

  const part = a.days[k] || { study: 0, breaks: 0, pauses: 0 };
  let study = part.study, breaks = part.breaks;
  for (const { key, ms } of splitByDay(a.since, now())) {
    if (key !== k) continue;
    if (a.status === "running") study += ms; else breaks += ms;
  }
  if (study === 0 && breaks === 0 && part.pauses === 0 && a.date !== k) return out;

  out.study += study;
  out.breaks += breaks;
  out.pauses += part.pauses;
  if (a.date === k) out.sessions += 1;
  if (study > 0) {
    const s = a.subject || "";
    out.subjects[s] = (out.subjects[s] || 0) + study;
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
function subjectTotals() {
  const totals = {};
  for (const d of Object.values(state.days)) {
    for (const [s, ms] of Object.entries(d.subjects || {})) if (s) totals[s] = (totals[s] || 0) + ms;
  }
  return totals;
}
function knownSubjects() {
  const totals = subjectTotals();
  return Object.keys(totals).sort((a, b) => totals[b] - totals[a]);
}

/* ---------- subject suggestions ---------- */

const escHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
let suggestItems = [];
let suggestIndex = -1;

function renderSuggest() {
  const box = $("suggest");
  const input = $("subject");
  const q = input.value.trim().toLocaleLowerCase();
  const totals = subjectTotals();
  suggestItems = knownSubjects()
    .filter((s) => s.toLocaleLowerCase() !== q && s.toLocaleLowerCase().includes(q))
    .slice(0, 6);
  if (document.activeElement !== input || !suggestItems.length) return hideSuggest();
  suggestIndex = Math.min(suggestIndex, suggestItems.length - 1);
  box.innerHTML = suggestItems.map((s, i) => {
    const at = q ? s.toLocaleLowerCase().indexOf(q) : -1;
    const name = at < 0 ? escHtml(s)
      : escHtml(s.slice(0, at)) + `<mark>${escHtml(s.slice(at, at + q.length))}</mark>` + escHtml(s.slice(at + q.length));
    return `<li role="option" id="sg-${i}" data-i="${i}" aria-selected="${i === suggestIndex}"${i === suggestIndex ? ' class="on"' : ""}>`
      + `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><circle cx="8" cy="8" r="6.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.8V8l2.2 1.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      + `<span class="sg-name">${name}</span><span class="sg-time">${shortHours(totals[s])}</span></li>`;
  }).join("");
  input.setAttribute("aria-expanded", "true");
  if (suggestIndex >= 0) input.setAttribute("aria-activedescendant", `sg-${suggestIndex}`);
  else input.removeAttribute("aria-activedescendant");
  if (box.hidden || box.classList.contains("closing")) {
    clearTimeout(hideSuggest.timer);
    box.classList.remove("closing");
    box.hidden = false;
  }
}
function hideSuggest() {
  const box = $("suggest");
  suggestIndex = -1;
  $("subject").setAttribute("aria-expanded", "false");
  $("subject").removeAttribute("aria-activedescendant");
  if (box.hidden || box.classList.contains("closing")) return;
  box.classList.add("closing");
  clearTimeout(hideSuggest.timer);
  hideSuggest.timer = setTimeout(() => { box.hidden = true; box.classList.remove("closing"); }, 130);
}
function chooseSuggest(i) {
  const v = suggestItems[i];
  if (v == null) return;
  $("subject").value = v;
  draftSubject = v;
  hideSuggest();
}

/* ---------- clearing a day ----------
 * A day started by mistake can be cleared from the report. Its record goes,
 * and so does the running session's share of it; Undo puts both back.
 */

const TRASH = `<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M2.8 4.2h10.4M6.3 4.2V2.9c0-.4.3-.7.7-.7h2c.4 0 .7.3.7.7v1.3M4.1 4.2l.6 8.6c0 .6.5 1 1.1 1h4.4c.6 0 1.1-.4 1.1-1l.6-8.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
let pickedDay = null;
let undoInfo = null;
let undoTimer = null;
let clearArmTimer = null;

const clone = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));
const hasRecord = (k) => { const d = liveFor(k); return d.study > 0 || d.sessions > 0; };

function pickDay(k) {
  pickedDay = pickedDay === k ? null : k;
  undoInfo = null;
  clearTimeout(clearArmTimer);
  buildDayPanel(true);
  renderReport();
}

function buildDayPanel(animate) {
  const p = $("day-panel");
  const week = $("chart").dataset.week;
  const any = week && [0, 1, 2, 3, 4, 5, 6].some((i) => hasRecord(addDays(week, i)));
  let mode;
  if (undoInfo) {
    mode = "undo";
    p.innerHTML = `<span class="dp-text">${t("dayCleared")}</span><button class="dp-btn" id="dp-undo">${t("undo")}</button>`;
    $("dp-undo").addEventListener("click", undoClear);
  } else if (pickedDay) {
    mode = "day";
    p.innerHTML = `<span class="dp-text"><b>${cap(fmt(pickedDay, { weekday: "long", day: "numeric", month: "short" }))}</b><span class="dp-time" id="dp-time">${hm(liveFor(pickedDay).study)}</span></span>`
      + `<button class="dp-btn dp-clear" id="dp-clear">${TRASH}<span>${t("clearDay")}</span></button>`;
    $("dp-clear").addEventListener("click", armClear);
  } else if (any) {
    mode = "hint";
    p.innerHTML = `<span class="dp-hint">${t("pickHint")}</span>`;
  } else {
    mode = "";
    p.innerHTML = "";
  }
  p.dataset.mode = mode;
  if (animate && mode) replay(p.firstElementChild, "swap");
}

function armClear() {
  const b = $("dp-clear");
  if (b.dataset.armed) { clearTimeout(clearArmTimer); return clearDay(pickedDay); }
  b.dataset.armed = "1";
  b.classList.add("armed");
  b.lastChild.textContent = t("confirmClear");
  replay(b, "morph");
  clearArmTimer = setTimeout(() => buildDayPanel(false), 3000);
}

function clearDay(k) {
  undoInfo = { k, day: clone(state.days[k]), active: clone(state.active) };
  delete state.days[k];
  const a = state.active;
  if (a) {
    bank(a, a.status === "running" ? "study" : "breaks");
    delete a.days[k];
    const rest = Object.keys(a.days).filter((d) => {
      const p = a.days[d];
      return p.study > 0 || p.breaks > 0 || p.pauses > 0;
    }).sort();
    if (a.date === k) {
      if (rest.length) a.date = rest[0];     // the session lives on, counted on its next day
      else state.active = null;               // a session started by mistake today: gone
    }
  }
  pickedDay = null;
  clearTimeout(undoTimer);
  undoTimer = setTimeout(() => { undoInfo = null; buildDayPanel(true); }, 6000);
  buildDayPanel(true);
  commitAndRender();
}

function undoClear() {
  if (!undoInfo) return;
  const { k, day, active } = undoInfo;
  if (day) state.days[k] = day;
  if (active) state.active = active;
  undoInfo = null;
  clearTimeout(undoTimer);
  pickedDay = k;
  buildDayPanel(true);
  commitAndRender();
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

/* With animate, the old buttons fade out before the new ones arrive. */
function renderControls(animate = false) {
  const c = $("controls");
  const wrap = $("subject-wrap");
  clearTimeout(renderControls.timer);
  if (animate && c.children.length) {
    c.classList.add("leaving");
    if (!wrap.hidden && !["idle", "closed"].includes(currentState())) wrap.classList.add("leaving");
    renderControls.timer = setTimeout(() => {
      c.classList.remove("leaving");
      wrap.classList.remove("leaving");
      buildControls(true);
    }, 170);
  } else {
    buildControls(false);
  }
}

function buildControls(animate) {
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
  if (s === "paused") {
    const onBreak = state.active.pomo && state.active.pomo.phase !== "focus";
    btn(t(onBreak ? "skipBreak" : "resume"), "btn-primary", resume).title = "Space";
  }
  if (s === "running" || s === "paused") {
    const b = btn(t("stop"), "btn-ghost", armStop);
    b.id = "stop-btn";
    b.title = "S";
  }
  if (s === "closed") {
    const b = btn("", "btn-round", start);
    b.title = t("startAnother");
    b.setAttribute("aria-label", t("startAnother"));
    b.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path transform="translate(-1.6 0)" d="M8 5.6c0-1.3 1.4-2.1 2.5-1.4l9.1 5.9a1.7 1.7 0 0 1 0 2.8l-9.1 5.9C9.4 19.5 8 18.7 8 17.4Z" fill="currentColor"/></svg><span></span>`;
    b.lastChild.textContent = t("startAnother");
    b.lastChild.className = "round-label";
  }

  if (animate) stagger(c.children, 60);

  /* the optional subject field only exists before a session starts */
  const idle = s === "idle" || s === "closed";
  const wasHidden = $("subject-wrap").hidden;
  $("subject-wrap").hidden = !idle;
  if (idle && wasHidden && animate) replay($("subject-wrap"), "reveal");
  if (idle) {
    $("subject").value = draftSubject;
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
  replay(b, "morph");
  confirmTimer = setTimeout(renderControls, 3000);
}

function renderTimer() {
  const s = currentState();
  if (renderTimer.last && renderTimer.last !== s) {
    replay($("status"), "swap");
    if (s === "running") replay($("timer"), "kick");
  }
  renderTimer.last = s;
  document.body.dataset.state = s;
  const a = state.active;
  const pomo = a ? a.pomo : state.pomo.on ? {} : null;
  document.body.dataset.phase = pomo ? (a && a.pomo && a.pomo.phase !== "focus" ? "break" : "focus") : "";
  const track = $("pomo-track");
  const dots = $("pomo-dots");
  track.hidden = !pomo;
  dots.hidden = !(a && a.pomo);

  if (pomo) {
    const left = pomoLeft(a);
    const sec = Math.ceil(left / 1000);
    $("timer").textContent = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
    const len = a && a.pomo ? a.pomo.len : state.pomo.focus * 60000;
    $("pomo-fill").style.width = `${a && a.pomo ? (1 - left / len) * 100 : 0}%`;
    const today = `${t("todayShort")} ${hm(liveFor(todayKey()).study)}`;
    let text;
    if (!a) {
      text = `${t("modePomo")} · ${state.pomo.focus} / ${state.pomo.short} ${t("minUnit")}`;
      if (s === "closed") text = `${t("done")} · ${today}`;
    } else {
      const p = a.pomo;
      const round = (p.count % state.pomo.every) + (p.phase === "focus" ? 1 : 0) || state.pomo.every;
      if (p.phase !== "focus") {
        const at = new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit" }).format(new Date(p.ends));
        text = `${t(p.phase === "long" ? "longLen" : "shortLen")} · ${t("backAt", at)}`;
      } else if (s === "paused") {
        text = `${t("onBreak")} · ${clock(now() - a.since).replace(/^00:/, "")}`;
      } else {
        text = `${t("phaseFocus")} · ${t("round", round, state.pomo.every)}${a.subject ? ` · ${a.subject}` : ""}`;
      }
      const done = p.count % state.pomo.every;
      const filled = p.phase === "focus" ? done : done || state.pomo.every;
      if (dots.childElementCount !== state.pomo.every) dots.innerHTML = "<i></i>".repeat(state.pomo.every);
      [...dots.children].forEach((d, i) => {
        d.classList.toggle("on", i < filled);
        d.classList.toggle("now", p.phase === "focus" && i === filled);
      });
    }
    $("status-text").textContent = text;
    return;
  }

  // Today's total; a session that began yesterday only brings its part since midnight.
  $("timer").textContent = clock(liveFor(todayKey()).study);

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
  const fresh = strip.dataset.week !== days[0].key || strip.children.length !== 7;
  if (fresh) {
    // built at zero height, so the bars grow into place
    strip.dataset.week = days[0].key;
    strip.innerHTML = days.map((d, i) => `<div class="day"><span class="v"></span><div class="bar-wrap"><div class="bar" style="height:0%;transition-delay:${i * 45}ms"></div></div><span class="d">${dayName(d.key, "narrow")}</span></div>`).join("");
    void strip.offsetWidth;
    setTimeout(() => strip.querySelectorAll(".bar").forEach((b) => (b.style.transitionDelay = "")), 900);
  }
  let total = 0;
  days.forEach((d, i) => {
    total += d.study;
    const el = strip.children[i];
    el.className = "day" + (d.study > 0 ? " has" : "") + (d.key === today ? " is-today" : "");
    el.title = `${cap(dayName(d.key))} · ${hm(d.study)}`;
    el.querySelector(".bar").style.height = d.study > 0 ? `${Math.max(6, (d.study / max) * 100)}%` : "0%";
    el.querySelector(".v").textContent = shortHours(d.study);
  });
  $("week-total").textContent = hm(total);

  /* weekly goal: a hairline of progress, nothing more */
  const goal = state.goal;
  $("week-goal").textContent = goal ? ` / ${goal}h` : "";
  const trackWasHidden = $("goal-track").hidden;
  $("goal-track").hidden = !goal;
  if (goal) {
    const pct = Math.min(1, total / (goal * 3600000));
    $("goal-fill").style.width = `${pct * 100}%`;
    $("goal-fill").classList.toggle("done", pct >= 1);
  }
  $("goal-btn").classList.toggle("has-goal", Boolean(goal));
  if (goal && trackWasHidden) setTimeout(() => replay($("goal-track"), "reveal"), 0);
  const label = goal ? `${t("goal")} · ${goal}h` : t("setGoal");
  if ($("goal-edit").hidden && $("goal-label").textContent && $("goal-label").textContent !== label) replay($("goal-label"), "swap");
  if ($("goal-edit").hidden) $("goal-label").textContent = goal ? `${t("goal")} · ${goal}h` : t("setGoal");

  const left = 6 - parseKey(today).getDay();
  const n = streak();
  $("week-hint").textContent = left === 0 ? t("reportReady") : t("reportIn", left);
  const streakText = n >= 2 ? ` · ${t("streak", n)}` : "";
  if (streakText && streakText !== $("week-streak").textContent) replay($("week-streak"), "swap");
  $("week-streak").textContent = streakText;
}

function openGoalEditor() {
  $("goal-btn").hidden = true;
  $("goal-edit").hidden = false;
  replay($("goal-edit"), "pop");
  const input = $("goal-input");
  input.value = state.goal || "";
  input.placeholder = "10";
  input.focus();
  input.select();
}
function closeGoalEditor(saveIt) {
  if ($("goal-edit").hidden) return;
  const before = state.goal;
  if (saveIt) {
    const v = Math.round(Number($("goal-input").value));
    state.goal = v >= 1 && v <= 100 ? v : null;   // empty or 0 removes the goal
    save();
  }
  $("goal-edit").hidden = true;
  $("goal-btn").hidden = false;
  replay($("goal-btn"), "pop");
  renderWeekStrip();
  if (state.goal && state.goal !== before) {
    const b = $("goal-btn");
    b.classList.remove("hit");
    void b.offsetWidth;
    b.classList.add("hit");                       // the arrow flies in
    setTimeout(() => b.classList.remove("hit"), 1200);
  }
}

function renderToday(animate = false) {
  renderMode();
  $("today-date").textContent = fmt(todayKey(), { weekday: "long", month: "long", day: "numeric" });
  renderTimer();
  renderControls(animate);
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

  renderCarousel();
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
  const freshChart = chart.dataset.week !== start || chart.children.length !== 7;
  if (freshChart) {
    chart.dataset.week = start;
    chart.innerHTML = days.map((d, i) => `<div class="col"><span class="v"></span><div class="bar-wrap"><div class="bar" style="height:0%;transition-delay:${80 + i * 50}ms"></div></div></div>`).join("");
    void chart.offsetWidth;
    setTimeout(() => chart.querySelectorAll(".bar").forEach((b) => (b.style.transitionDelay = "")), 1100);
  }
  days.forEach((d, i) => {
    const col = chart.children[i];
    col.className = "col " + (d.study < 60000 ? "empty" : d.key === bestKey ? "best" : "")
      + (hasRecord(d.key) ? " can-pick" : "") + (d.key === pickedDay ? " picked" : "");
    col.querySelector(".v").textContent = shortHours(d.study);
    col.querySelector(".bar").style.height = `${Math.max(2, (d.study / max) * 100)}%`;
  });
  let labels = chart.nextElementSibling;
  if (!labels || !labels.classList.contains("chart-days")) {
    labels = document.createElement("div");
    labels.className = "chart-days";
    chart.after(labels);
  }
  labels.innerHTML = days.map((d) => `<span${d.key === pickedDay ? ' class="picked"' : ""}>${dayName(d.key, "short")}</span>`).join("");
  if (pickedDay && !days.some((d) => d.key === pickedDay)) pickedDay = null;
  const panel = $("day-panel");
  const wantMode = undoInfo ? "undo" : pickedDay ? "day" : days.some((d) => hasRecord(d.key)) ? "hint" : "";
  if (freshChart || panel.dataset.mode !== wantMode) buildDayPanel(freshChart);
  else if (wantMode === "day" && $("dp-time")) $("dp-time").textContent = hm(liveFor(pickedDay).study);

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
  const stats = $("stats");
  if (stats.dataset.week !== start || stats.children.length !== rows.length) {
    stats.dataset.week = start;
    stats.innerHTML = rows.map(() => `<div class="stat"><dt></dt><dd></dd></div>`).join("");
    stagger(stats.children, 55);
  }
  rows.forEach(([k, v], i) => {
    const el = stats.children[i];
    el.querySelector("dt").innerHTML = k;
    el.querySelector("dd").innerHTML = v;
  });

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

/* ---------- week carousel and calendar ---------- */

/* Moves the report to another week; the dates and the report slide in
   from the side they come from. */
function goToWeek(start) {
  const current = weekStart(todayKey());
  if (start > current) start = current;
  if (start === reportWeek) return;
  const dir = start > reportWeek ? "next" : "prev";
  reportWeek = start;
  $("report-notice").hidden = true;
  renderReport();
  for (const el of [$("report-body")]) {
    el.classList.remove("slide-next", "slide-prev");
    void el.offsetWidth;
    el.classList.add(`slide-${dir}`);
  }
}

/* ---- Coverflow ----
   Like Apple's Cover Flow: the week on display faces you; its neighbours
   turn sharply away and stack toward the edges, darker the further they go.
   There are always weeks on both sides; the future ones are only there for
   balance and cannot be opened. Chips are keyed by week, so the track glides
   instead of being redrawn. */

const chips = new Map();          // week key -> element
/* The chips sit on the outside of a drum: each step around it is an angle,
   and position, depth and turn all follow from that angle. */
const DRUM = { radius: 300, step: [0, 38, 70, 100], scale: [1, .84, .72, .6], dim: [0, .2, .35, 1], alpha: [1, .62, .3, 0] };

function placeChip(el, offset) {
  const d = Math.min(Math.abs(offset), 3);
  const side = Math.sign(offset);
  const angle = side * DRUM.step[d];
  const rad = (angle * Math.PI) / 180;
  const x = DRUM.radius * Math.sin(rad);
  const z = DRUM.radius * (Math.cos(rad) - 1);
  el.style.transform = `translateX(calc(-50% + ${x.toFixed(1)}px)) translateZ(${z.toFixed(1)}px) rotateY(${angle}deg) scale(${DRUM.scale[d]})`;
  el.style.setProperty("--dim", DRUM.dim[d]);
  el.style.opacity = DRUM.alpha[d];
  el.classList.toggle("is-left", offset < 0);
  el.classList.toggle("is-right", offset > 0);
  el.style.zIndex = String(10 - d);
  el.classList.toggle("is-center", offset === 0);
  const usable = d === 1 && !el.classList.contains("is-future");
  el.style.pointerEvents = offset === 0 || usable ? "auto" : "none";
  el.tabIndex = offset === 0 || usable ? 0 : -1;
}

function makeChip(week) {
  const el = document.createElement("button");
  el.className = "week-chip";
  el.dataset.week = week;
  el.innerHTML = `<svg class="range-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><rect x="2" y="3" width="12" height="11" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 6.6h12" stroke="currentColor" stroke-width="1.4"/><path d="M5.2 1.6v2.6M10.8 1.6v2.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><rect x="4.6" y="8.6" width="2.4" height="2.2" rx=".6" fill="currentColor"/></svg><span class="range-text"><span class="range-year"></span><span class="range-main"></span></span>`;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    if (el.classList.contains("is-future")) return;
    if (el.dataset.week === reportWeek) toggleCalendar();
    else { closeCalendar(); goToWeek(el.dataset.week); }
  });
  return el;
}

function renderCarousel() {
  const track = $("weeks");
  const current = weekStart(todayKey());
  const wanted = new Map();
  for (let o = -2; o <= 2; o++) wanted.set(addDays(reportWeek, 7 * o), o);

  for (const [w, el] of chips) {
    if (wanted.has(w)) continue;
    chips.delete(w);
    placeChip(el, w < reportWeek ? -3 : 3);   // glide out past the edge
    setTimeout(() => el.remove(), 700);
  }
  for (const [w, o] of wanted) {
    let el = chips.get(w);
    if (!el) {
      el = makeChip(w);
      track.appendChild(el);
      chips.set(w, el);
      placeChip(el, o < 0 ? -3 : 3);          // enter from its own side
      void el.offsetWidth;
    }
    const label = rangeLabel(w);
    el.querySelector(".range-year").textContent = label.year;
    el.querySelector(".range-main").textContent = label.main;
    el.setAttribute("aria-label", `${label.main} ${label.year}`);
    el.classList.toggle("is-future", w > current);
    placeChip(el, o);
  }
  setExpanded(!$("cal").hidden);
}

function setExpanded(open) {
  const centre = chips.get(reportWeek);
  for (const el of chips.values()) el.removeAttribute("aria-expanded");
  if (centre) {
    centre.setAttribute("aria-haspopup", "dialog");
    centre.setAttribute("aria-expanded", String(open));
  }
}

/* ---- small motion helpers ---- */

/* Replays a one-shot CSS animation class on an element. */
function replay(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/* Gives freshly built children a staggered entrance. */
function stagger(children, step = 45) {
  [...children].forEach((el, i) => {
    el.style.animationDelay = `${i * step}ms`;
    el.classList.add("pop");
  });
}

let calMonth = null;   // first day of the month on display

function toggleCalendar() {
  if (!$("cal").hidden && !$("cal").classList.contains("closing")) return closeCalendar();
  clearTimeout(closeCalendar.timer);
  $("cal").classList.remove("closing");
  const mid = parseKey(addDays(reportWeek, 3));
  calMonth = new Date(mid.getFullYear(), mid.getMonth(), 1);
  renderCalendar();
  $("cal").hidden = false;
  setExpanded(true);
}

function closeCalendar() {
  const cal = $("cal");
  if (cal.hidden || cal.classList.contains("closing")) return;
  setExpanded(false);
  cal.classList.add("closing");
  clearTimeout(closeCalendar.timer);
  closeCalendar.timer = setTimeout(() => {
    cal.hidden = true;
    cal.classList.remove("closing");
  }, 170);
}

function moveCalendar(step) {
  calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + step, 1);
  renderCalendar();
}

function renderCalendar() {
  const today = todayKey();
  const first = keyOf(calMonth);
  const thisMonth = new Date(parseKey(today).getFullYear(), parseKey(today).getMonth(), 1);
  const title = new Intl.DateTimeFormat(locale(), { month: "long", year: "numeric" }).format(calMonth);
  $("cal-title").textContent = cap(title);
  $("cal-next").disabled = calMonth >= thisMonth;

  const sunday = weekStart(today);
  $("cal-weekdays").innerHTML = Array.from({ length: 7 }, (_, i) =>
    `<span>${dayName(addDays(sunday, i), "narrow")}</span>`).join("");

  const grid = $("cal-grid");
  grid.innerHTML = "";
  for (let row = weekStart(first); parseKey(row) <= new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 0); row = addDays(row, 7)) {
    const week = document.createElement("div");
    week.className = "cal-row" + (row === reportWeek ? " is-selected" : "") + (row > today ? " is-future" : "");
    for (let i = 0; i < 7; i++) {
      const k = addDays(row, i);
      const d = parseKey(k);
      const day = document.createElement("button");
      const studied = liveFor(k).study >= 60000;
      day.className = "cal-day"
        + (d.getMonth() !== calMonth.getMonth() ? " is-out" : "")
        + (k === today ? " is-today" : "")
        + (studied ? " has-study" : "");
      day.disabled = k > today;
      day.innerHTML = `<span class="n">${d.getDate()}</span>`;
      if (studied) day.style.setProperty("--heat", String(Math.min(1, liveFor(k).study / (3 * 3600000))));
      day.title = `${cap(dayName(k))} · ${hm(liveFor(k).study)}`;
      day.addEventListener("click", () => { closeCalendar(); goToWeek(weekStart(k)); });
      week.appendChild(day);
    }
    grid.appendChild(week);
  }
}

/* ---------- views ---------- */

let view = "today";
function show(v, opts = {}) {
  view = v;
  // the bars and stats grow again whenever a view is opened
  $("strip").dataset.week = "";
  $("chart").dataset.week = "";
  $("stats").dataset.week = "";
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
  if (DEMO) auto = params.get("view") === "report" ? { week: addDays(weekStart(todayKey()), -7 * (Number(params.get("back")) || 0)), notice: params.get("notice") ? t("saturday") : null } : null;
  else auto = autoReport();
  if (auto) show("report", auto);
  else show("today");
}

function commitAndRender() {
  save();
  pomoSchedule();
  renderMode();
  if (view === "today") renderToday(true);
  else renderReport();
}

/* ---------- updates ---------- */

/* Lectern never downloads or runs anything by itself. It asks GitHub whether
   a newer release exists; "Update" hands over to the installed updater, which
   shows its own window, updates in place and reopens Lectern. Without it, the
   release's installer opens in the browser instead. */

const RELEASES = "https://api.github.com/repos/mthsluna/lectern/releases/latest";
const DOWNLOADS = "https://github.com/mthsluna/lectern/";
let pendingUpdate = null;

const versionTuple = (v) => String(v).replace(/^v/, "").split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
function isNewer(a, b) {
  const x = versionTuple(a), y = versionTuple(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

async function checkForUpdate() {
  let found = null;
  if (DEMO) {
    if (params.get("update")) found = { version: params.get("update"), url: DOWNLOADS };
  } else if (tauri) {
    try {
      const current = await window.__TAURI__.app.getVersion();
      const res = await fetch(RELEASES, { headers: { Accept: "application/vnd.github+json" } });
      if (!res.ok) return;
      const release = await res.json();
      if (release.draft || release.prerelease || !isNewer(release.tag_name, current)) return;
      const asset = (release.assets || []).find((x) => /^Lectern-Setup.*\.exe$/.test(x.name));
      found = { version: release.tag_name.replace(/^v/, ""), url: asset ? asset.browser_download_url : release.html_url };
    } catch {
      return;   // offline: stay quiet
    }
  }
  if (!found || !found.url.startsWith(DOWNLOADS) || state.skipVersion === found.version) return;
  pendingUpdate = found;
  renderUpdate();
}

function renderUpdate(phase = "offer") {
  const box = $("update");
  box.hidden = !pendingUpdate;
  if (!pendingUpdate) return;
  box.dataset.phase = phase;
  $("update-text").textContent =
    phase === "opened" ? t("updateOpened") :
    phase === "failed" ? t("updateFailed") :
    t("updateAvailable", pendingUpdate.version);
  $("update-now").textContent = phase === "failed" ? t("tryAgain") : t("updateNow");
  $("update-later").textContent = phase === "opened" ? t("close") : t("notNow");
  $("update-skip").textContent = t("skipVersion");
}

async function installUpdate() {
  if (!tauri) return renderUpdate("opened");
  // Installed with Lectern Setup: the updater takes over and reopens Lectern.
  try {
    await tauri.invoke("start_update");
    return;
  } catch {
    // not installed by the setup (or it is missing): fall back to the download
  }
  try {
    await window.__TAURI__.opener.openUrl(pendingUpdate.url);
    renderUpdate("opened");
  } catch (e) {
    console.error("Could not open the download", e);
    renderUpdate("failed");
  }
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
      date: today, status: st, since: now() - (st === "paused" ? 4 * m + 12000 : 0), subject: "Calculus",
      days: { [today]: { study: 1 * h + 24 * m + 7000, breaks: 6 * m, pauses: 1 } },
    };
  }
  if (params.has("pomo")) {
    state.pomo.on = true;
    const ph = params.get("pomo");
    if (state.active && (ph === "focus" || ph === "break")) {
      const brk = ph === "break";
      if (brk) state.active.status = "paused";
      state.active.pomo = { phase: brk ? "short" : "focus", count: brk ? 2 : 1, len: (brk ? 5 : 25) * 60000,
        left: 0, ends: now() + (brk ? 3 * 60000 + 20000 : 17 * 60000 + 42000) };
    }
  }
  state.lang = params.has("pick") ? null : params.get("lang") || "en";
  state.theme = params.get("theme") || "system";
  state.seen = {};
}

/* ---------- boot ---------- */

(async function boot() {
  await load();
  state.pomo = { ...POMO_DEFAULTS, ...(state.pomo || {}) };
  migrateActive(state.active);
  settleStaleSession();

  document.querySelectorAll(".tab[data-view]").forEach((el) => el.addEventListener("click", () => show(el.dataset.view)));
  $("lang-btn").addEventListener("click", showPicker);
  $("theme-btn").addEventListener("click", toggleTheme);
  darkQuery.addEventListener("change", applyTheme);

  /* update banner */
  $("update-now").addEventListener("click", installUpdate);
  $("update-later").addEventListener("click", () => { pendingUpdate = null; renderUpdate(); });
  $("update-skip").addEventListener("click", () => {
    state.skipVersion = pendingUpdate.version;
    save();
    pendingUpdate = null;
    renderUpdate();
  });
  checkForUpdate();
  $("prev-week").addEventListener("click", () => goToWeek(addDays(reportWeek, -7)));
  $("next-week").addEventListener("click", () => goToWeek(addDays(reportWeek, 7)));
  $("cal-prev").addEventListener("click", () => moveCalendar(-1));
  $("cal-next").addEventListener("click", () => moveCalendar(1));
  $("cal-today").addEventListener("click", () => { closeCalendar(); goToWeek(weekStart(todayKey())); });
  $("cal").addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", closeCalendar);

  /* subject field */
  $("subject").addEventListener("input", (e) => { draftSubject = e.target.value; suggestIndex = -1; renderSuggest(); });
  $("subject").addEventListener("focus", () => { suggestIndex = -1; renderSuggest(); });
  $("subject").addEventListener("blur", hideSuggest);
  $("subject").addEventListener("keydown", (e) => {
    const open = !$("suggest").hidden && !$("suggest").classList.contains("closing");
    if (open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      const n = suggestItems.length;
      suggestIndex = e.key === "ArrowDown" ? (suggestIndex + 1) % n : (suggestIndex <= 0 ? n - 1 : suggestIndex - 1);
      return renderSuggest();
    }
    if (open && e.key === "Escape") { e.stopPropagation(); return hideSuggest(); }
    if (open && (e.key === "Enter" || e.key === "Tab") && suggestIndex >= 0) {
      e.preventDefault();
      return chooseSuggest(suggestIndex);
    }
    if (e.key === "Enter") { e.preventDefault(); e.target.blur(); start(); }
  });
  $("suggest").addEventListener("mousedown", (e) => e.preventDefault());   // keep the focus in the field
  $("suggest").addEventListener("click", (e) => {
    const li = e.target.closest("li");
    if (li) chooseSuggest(Number(li.dataset.i));
  });

  /* Pomodoro */
  $("mode").addEventListener("click", (e) => {
    const b = e.target.closest(".mode-opt");
    if (b) setMode(b.dataset.mode === "pomo");
  });
  $("pomo-gear").addEventListener("click", (e) => { e.stopPropagation(); togglePomoPanel(); });
  $("pomo-panel").addEventListener("click", (e) => {
    e.stopPropagation();
    const step = e.target.closest(".pp-step button");
    if (step) {
      const s = STEPS.find((x) => x.key === step.closest(".pp-row").dataset.key);
      const v = state.pomo[s.key] + Number(step.dataset.d) * s.step;
      state.pomo[s.key] = Math.max(s.min, Math.min(s.max, v));
      save();
      renderPomoPanel();
      replay($("pomo-rows").querySelector(`[data-key="${s.key}"] .pp-val`), "swap");
      return renderTimer();
    }
    const tab = e.target.closest(".pp-tabs button");
    if (tab) { soundEvent = tab.dataset.event; renderPomoPanel(); return replay($("pomo-sounds"), "swap"); }
    const snd = e.target.closest(".pp-snd");
    if (snd) {
      state.pomo[soundEvent] = snd.dataset.sound;
      save();
      renderPomoPanel();
      return playSound(snd.dataset.sound);
    }
    if (e.target.closest("#pomo-reset")) {
      state.pomo = { ...POMO_DEFAULTS, on: state.pomo.on };
      save();
      renderPomoPanel();
      renderTimer();
    }
  });
  $("pomo-volume").addEventListener("input", (e) => { state.pomo.volume = Number(e.target.value) / 100; });
  $("pomo-volume").addEventListener("change", () => { save(); playSound(state.pomo[soundEvent] === "none" ? "marimba" : state.pomo[soundEvent]); });
  document.addEventListener("click", closePomoPanel);

  /* report: pick a day to clear it */
  $("chart").addEventListener("click", (e) => {
    const col = e.target.closest(".col");
    if (!col) return;
    const k = addDays($("chart").dataset.week, [...$("chart").children].indexOf(col));
    if (hasRecord(k) || pickedDay === k) pickDay(k);
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
    if (e.key === "Escape" && !$("cal").hidden) return closeCalendar();
    if (e.key === "Escape" && !$("pomo-panel").hidden) return closePomoPanel();
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
  pomoSchedule();
  setInterval(() => {
    pomoTick();
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
