/* Lectern for the browser: the study model, shared by the popup and the
 * background worker. It is the app's model, unchanged: time is stored as
 * timestamps, a session keeps a per-day ledger cut at midnight, and a day
 * record holds study, breaks, pauses, sessions and subjects. That is what
 * lets the extension show the app's data as is when the two are linked.
 */

export const HOST = "app.lectern.bridge";
export const STORE_KEY = "lectern";
export const SITE = "https://mthsluna.github.io/lectern/";
export const DOWNLOAD = "https://github.com/mthsluna/lectern/releases/latest/download/Lectern-Setup.exe";

/* ---------- dates ---------- */

export function keyOf(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function parseKey(k) {
  const [y, m, d] = k.split("-").map(Number);
  return new Date(y, m - 1, d);
}
export function addDays(k, n) {
  const d = parseKey(k);
  d.setDate(d.getDate() + n);
  return keyOf(d);
}
export const todayKey = () => keyOf(new Date());
export const weekStart = (k) => addDays(k, -parseKey(k).getDay());   // Sunday

/* ---------- formatting ---------- */

export function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return [h, m, sec].map((v) => String(v).padStart(2, "0")).join(":");
}
export function hm(ms) {
  const total = Math.round(ms / 60000);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}
export function badgeText(ms) {
  const total = Math.floor(ms / 60000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/* ---------- the model ---------- */

export const emptyState = () => ({ version: 1, days: {}, active: null, goal: null });

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
const ledger = (a, k) => a.days[k] || (a.days[k] = { study: 0, breaks: 0, pauses: 0 });
const dayRec = (state, k) =>
  state.days[k] || (state.days[k] = { study: 0, breaks: 0, pauses: 0, sessions: 0, closed: false, subjects: {} });

function bank(a, field, now) {
  for (const { key, ms } of splitByDay(a.since, now)) ledger(a, key)[field] += ms;
  a.since = now;
}

/** Live totals for a day, with the running session's share of it. */
export function liveFor(state, k, now = Date.now()) {
  const d = (state.days && state.days[k]) || { study: 0, breaks: 0, pauses: 0, sessions: 0, closed: false };
  const out = { study: d.study, breaks: d.breaks, sessions: d.sessions, closed: d.closed };
  const a = state.active;
  if (!a || !a.days) return out;
  const part = a.days[k] || { study: 0, breaks: 0 };
  let study = part.study, breaks = part.breaks;
  for (const { key, ms } of splitByDay(a.since, now)) {
    if (key !== k) continue;
    if (a.status === "running") study += ms; else breaks += ms;
  }
  out.study += study;
  out.breaks += breaks;
  return out;
}

export function currentState(state) {
  if (state.active) return state.active.status;
  const d = state.days && state.days[todayKey()];
  return d && d.closed ? "closed" : "idle";
}

export function streak(state) {
  let k = todayKey();
  if (liveFor(state, k).study < 60000) k = addDays(k, -1);
  let n = 0;
  while (liveFor(state, k).study >= 60000 && n < 3650) { n++; k = addDays(k, -1); }
  return n;
}

export function week(state) {
  const start = weekStart(todayKey());
  return Array.from({ length: 7 }, (_, i) => {
    const key = addDays(start, i);
    return { key, study: liveFor(state, key).study };
  });
}

/** Time left in a Pomodoro phase (only the app runs Pomodoro). */
export function pomoLeft(a, now = Date.now()) {
  const p = a && a.pomo;
  if (!p) return 0;
  return p.ends ? Math.max(0, p.ends - now) : p.left;
}

/* ---------- actions, for the extension on its own ---------- */

export function start(state, subject = "") {
  const k = todayKey();
  if (state.days[k]) state.days[k].closed = false;
  state.active = { date: k, status: "running", since: Date.now(), subject: subject.trim().slice(0, 40), days: {} };
}
export function pause(state) {
  const a = state.active;
  bank(a, "study", Date.now());
  ledger(a, todayKey()).pauses += 1;
  a.status = "paused";
}
export function resume(state) {
  const a = state.active;
  bank(a, "breaks", Date.now());
  a.status = "running";
}
export function stop(state) {
  const a = state.active;
  if (a.status === "running") bank(a, "study", Date.now());
  const s = a.subject || "";
  for (const [k, part] of Object.entries(a.days)) {
    const d = dayRec(state, k);
    d.study += part.study;
    d.breaks += part.breaks;
    d.pauses += part.pauses;
    d.subjects = d.subjects || {};
    if (part.study > 0) d.subjects[s] = (d.subjects[s] || 0) + part.study;
  }
  const first = dayRec(state, a.date);
  first.sessions += 1;
  first.closed = true;
  state.active = null;
}
