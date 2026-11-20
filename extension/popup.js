/* The popup. On its own, it keeps time in the browser's storage. Linked to
 * the Lectern app, it shows the app's data and its buttons press the app's
 * buttons: the app stays the one source of truth.
 */
import * as C from "./core.js";

/* global LANGS, STRINGS -- from i18n.js, the app's own translations */

const $ = (id) => document.getElementById(id);
const hasChrome = Boolean(globalThis.chrome && chrome.runtime && chrome.runtime.id);
const params = new URLSearchParams(location.search);
const MOCK = !hasChrome && params.has("mock");   // preview only: pretend to be linked

let local = C.emptyState();     // the extension's own data
let appState = null;            // the app's data, when linked
let linked = false;
let port = null;
let lang = "en";
let draft = "";
let pending = null;             // a command sent to the app, not yet reflected
let armed = false;
let armTimer = 0;
let controlsKey = "";
let calm = true;                // may the blocker show its own page?

const view = () => (linked && appState ? appState : local);

/* ---------- language ---------- */

function pickLang(code) {
  const c = String(code || "en").toLowerCase().split("-")[0];
  return STRINGS[c] ? c : "en";
}
function t(key, ...args) {
  const v = (STRINGS[lang] && STRINGS[lang][key]) ?? STRINGS.en[key];
  return typeof v === "function" ? v(...args) : v;
}
const locale = () => (LANGS.find((l) => l.code === lang) || LANGS[0]).locale;

/* ---------- storage, for the extension on its own ---------- */

async function loadLocal() {
  try {
    if (hasChrome) return (await chrome.storage.local.get(C.STORE_KEY))[C.STORE_KEY] || C.emptyState();
    return JSON.parse(localStorage.getItem(C.STORE_KEY)) || C.emptyState();
  } catch { return C.emptyState(); }
}
async function saveLocal() {
  if (hasChrome) await chrome.storage.local.set({ [C.STORE_KEY]: local });
  else try { localStorage.setItem(C.STORE_KEY, JSON.stringify(local)); } catch { /* preview */ }
}
function refreshBadge() {
  if (hasChrome) chrome.runtime.sendMessage({ type: "badge" }).catch(() => {});
}

/* ---------- the link to the app ---------- */

function onHost(msg) {
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "hello") {
    linked = true;
    port.postMessage({ type: "state" });
  } else if (msg.type === "state") {
    appState = msg.data && typeof msg.data === "object" ? msg.data : C.emptyState();
    if (pending) { pending = null; controlsKey = ""; }
    if (appState.lang) lang = pickLang(appState.lang);
    applyLook();
    render();
  } else if (msg.type === "error") {
    pending = null;
    controlsKey = "";
    render();
  }
}

function connect() {
  if (MOCK) return mockConnect();
  if (!hasChrome) return;
  try { port = chrome.runtime.connectNative(C.HOST); } catch { port = null; return; }
  port.onMessage.addListener(onHost);
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;   // "host not found" when the app is not installed
    port = null;
    if (linked) { linked = false; appState = null; controlsKey = ""; applyLook(); render(); }
  });
  port.postMessage({ type: "hello" });
}

/* A stand-in for the app, so the linked look can be previewed in a page. */
function mockConnect() {
  const h = 3600000, m = 60000, today = C.todayKey(), start = C.weekStart(today);
  const days = {};
  [1.3, 2.7, 4.2, 1.6, 3.3].forEach((x, i) => {
    const k = C.addDays(start, i);
    if (k < today) days[k] = { study: x * h, breaks: 9 * m, pauses: 2, sessions: 1, closed: true, subjects: {} };
  });
  const data = {
    lang: params.get("lang") || "en", theme: params.get("theme") || "system", goal: 15, days,
    block: { on: true, sites: C.DEFAULT_SITES },
    active: { date: today, status: "running", since: Date.now() - 4 * m, subject: "Calculus",
      days: { [today]: { study: 1 * h + 20 * m, breaks: 6 * m, pauses: 1 } } },
  };
  port = {
    postMessage(msg) {
      setTimeout(() => {
        if (msg.type === "hello") onHost({ type: "hello" });
        if (msg.type === "state") onHost({ type: "state", data: JSON.parse(JSON.stringify(data)) });
      }, 120);
    },
  };
  port.postMessage({ type: "hello" });
}

/* ---------- actions ---------- */

async function act(cmd) {
  armed = false;
  clearTimeout(armTimer);
  if (linked) {
    pending = cmd;
    controlsKey = "";
    render();
    port.postMessage({ type: "command", cmd, subject: cmd === "start" ? draft : undefined });
    setTimeout(() => { if (pending === cmd) { pending = null; controlsKey = ""; render(); } }, 8000);
    setTimeout(refreshBadge, 1500);
    return;
  }
  if (cmd === "start") C.start(local, draft);
  if (cmd === "pause") C.pause(local);
  if (cmd === "resume") C.resume(local);
  if (cmd === "stop") C.stop(local);
  if (cmd === "start") draft = "";
  controlsKey = "";
  await saveLocal();
  render();
  refreshBadge();
}

function armStop() {
  if (armed) return act("stop");
  armed = true;
  controlsKey = "";
  render();
  clearTimeout(armTimer);
  armTimer = setTimeout(() => { armed = false; controlsKey = ""; render(); }, 3000);
}

/* ---------- rendering ---------- */

function applyLook() {
  const info = LANGS.find((l) => l.code === lang) || LANGS[0];
  document.documentElement.lang = info.code;
  document.documentElement.dir = info.rtl ? "rtl" : "ltr";
  const theme = linked && appState && appState.theme ? appState.theme : "system";
  const dark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = theme === "system" ? "" : theme;
  document.documentElement.dataset.dark = dark ? "1" : "";
  $("subject").placeholder = t("subject");
  $("week-label").textContent = t("thisWeek");
  renderLink();
  renderFoot();
}

function renderLink() {
  $("link").classList.toggle("on", linked);
  $("link-text").textContent = linked ? t("extLinked") : t("extAlone");
  $("link").title = linked ? t("extLinkedNote") : t("extAloneNote");
}

function renderFoot() {
  const foot = $("foot");
  if (linked) {
    foot.innerHTML = `<p>${t("extSynced")}</p><button class="btn btn-soft" id="open-app"></button>`;
    $("open-app").textContent = t("extOpen");
    $("open-app").addEventListener("click", () => port && port.postMessage({ type: "command", cmd: "open" }));
  } else {
    foot.innerHTML = `<p><b></b><span></span></p><button class="btn btn-soft" id="get-app"></button>`;
    foot.querySelector("b").textContent = t("extGet");
    foot.querySelector("span").textContent = t("extGetNote");
    $("get-app").textContent = t("extDownload");
    $("get-app").addEventListener("click", () => {
      // straight to the installer: the browser downloads it at once
      if (hasChrome) chrome.tabs.create({ url: C.DOWNLOAD, active: false });
      else window.open(C.DOWNLOAD, "_blank");
      $("get-app").textContent = t("extDownloading");
    });
  }
}

function buildControls(s, onBreak) {
  const key = [s, onBreak, pending, armed].join("|");
  if (key === controlsKey) return;
  controlsKey = key;
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
  if (s === "idle" || s === "closed") btn(t("start"), "btn-primary", () => act("start"));
  if (s === "running") btn(t("pause"), "btn-primary", () => act("pause"));
  if (s === "paused") btn(t(onBreak ? "skipBreak" : "resume"), "btn-primary", () => act("resume"));
  if (s === "running" || s === "paused") btn(armed ? t("confirmStop") : t("stop"), armed ? "btn-warn" : "btn-ghost", armStop);
  if (pending) c.querySelectorAll(".btn").forEach((b) => b.classList.add("busy"));
  c.classList.remove("in");
  void c.offsetWidth;
  c.classList.add("in");
}

function render() {
  const v = view();
  const now = Date.now();
  const today = C.todayKey();
  const s = C.currentState(v);
  const a = v.active;
  const pomo = linked && a && a.pomo;
  const onBreak = Boolean(pomo && a.pomo.phase !== "focus");
  document.body.dataset.state = s;
  document.body.dataset.phase = pomo ? (onBreak ? "break" : "focus") : "";

  $("date").textContent = new Intl.DateTimeFormat(locale(), { weekday: "long", month: "long", day: "numeric" }).format(new Date());

  // the clock: today's total, or the Pomodoro countdown
  $("pomo-track").hidden = !pomo;
  if (pomo) {
    const left = C.pomoLeft(a, now);
    const sec = Math.ceil(left / 1000);
    $("timer").textContent = `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
    $("pomo-fill").style.width = `${a.pomo.len ? (1 - left / a.pomo.len) * 100 : 0}%`;
  } else {
    $("timer").textContent = C.clock(C.liveFor(v, today, now).study);
  }

  let text = t("ready");
  if (s === "running") text = pomo ? t("phaseFocus") : t("studying");
  if (s === "running" && a.subject) text += ` · ${a.subject}`;
  if (s === "paused") text = onBreak ? t(a.pomo.phase === "long" ? "longLen" : "shortLen") : `${t("onBreak")} · ${C.clock(now - a.since).replace(/^00:/, "")}`;
  if (s === "closed") text = t("done");
  $("status").textContent = text;

  const idle = s === "idle" || s === "closed";
  $("subject-wrap").hidden = !idle;
  if (idle && document.activeElement !== $("subject")) $("subject").value = draft;

  buildControls(s, onBreak);

  // the blocker
  const sites = C.blockList(v);
  const on = Boolean(v.block && v.block.on && sites.length);
  const row = $("block-row");
  row.hidden = linked ? !on : false;
  row.classList.toggle("live", C.isBlocking(v));
  row.classList.toggle("link", !linked);
  $("block-text").textContent = on ? (C.isBlocking(v) ? t("blockingN", sites.length) : t("blockReady", sites.length)) : t("blockSettings");
  $("block-allow").hidden = !on || calm;
  $("block-allow").textContent = t("allowBlock");
  $("block-allow").title = t("allowNote");

  // the week
  const days = C.week(v);
  const total = days.reduce((x, d) => x + d.study, 0);
  const max = Math.max(3600000, ...days.map((d) => d.study));
  $("week-total").textContent = C.hm(total);
  const goal = v.goal;
  $("week-goal").textContent = goal ? ` / ${goal}h` : "";
  $("goal-track").hidden = !goal;
  if (goal) {
    const pct = Math.min(1, total / (goal * 3600000));
    $("goal-fill").style.width = `${pct * 100}%`;
    $("goal-fill").classList.toggle("done", pct >= 1);
  }
  const n = C.streak(v);
  $("streak").textContent = n >= 2 ? ` · ${t("streak", n)}` : "";
  const strip = $("strip");
  if (strip.childElementCount !== 7 || strip.dataset.lang !== lang) {
    strip.dataset.lang = lang;
    strip.innerHTML = days.map((d) => `<div class="day"><div class="bar-wrap"><div class="bar"></div></div><span>${
      new Intl.DateTimeFormat(locale(), { weekday: "narrow" }).format(C.parseKey(d.key))}</span></div>`).join("");
  }
  days.forEach((d, i) => {
    const el = strip.children[i];
    el.classList.toggle("is-today", d.key === today);
    el.querySelector(".bar").style.height = d.study > 0 ? `${Math.max(6, (d.study / max) * 100)}%` : "0%";
    el.title = C.hm(d.study);
  });
}

/* ---------- start ---------- */

(async function boot() {
  local = await loadLocal();
  lang = pickLang(params.get("lang") || (hasChrome ? chrome.i18n.getUILanguage() : navigator.language));
  applyLook();
  render();
  connect();

  $("subject").addEventListener("input", (e) => { draft = e.target.value; });
  $("subject").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); act("start"); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement || e.repeat) return;
    if (e.code === "Space") {
      e.preventDefault();
      const s = C.currentState(view());
      act(s === "running" ? "pause" : s === "paused" ? "resume" : "start");
    }
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyLook);
  if (hasChrome) calm = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  $("block-allow").addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!hasChrome) return;
    calm = await chrome.permissions.request({ origins: ["<all_urls>"] });
    render();
  });
  $("block-row").addEventListener("click", () => {
    if (!linked && hasChrome) chrome.runtime.openOptionsPage();
  });
  if (hasChrome) chrome.storage.onChanged.addListener(async () => { local = await loadLocal(); if (!linked) render(); });

  setInterval(render, 500);
})();
