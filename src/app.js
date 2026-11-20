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
/* The site blocker is enforced by the browser extension; the app holds the list. */
const BLOCK_DEFAULTS = { on: false, sites: ["instagram.com", "x.com", "twitter.com", "tiktok.com", "facebook.com", "web.whatsapp.com", "reddit.com"] };
const SITE_NAMES = {
  "instagram.com": "Instagram", "x.com": "X", "tiktok.com": "TikTok", "facebook.com": "Facebook",
  "web.whatsapp.com": "WhatsApp", "reddit.com": "Reddit", "youtube.com": "YouTube", "netflix.com": "Netflix",
  "twitch.tv": "Twitch", "discord.com": "Discord", "pinterest.com": "Pinterest", "threads.net": "Threads",
};
/* Brand marks for the sites people block most, from Simple Icons (CC0). */
const SITE_ICONS = {
  "instagram.com": "M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077",
  "x.com": "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  "twitter.com": "M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z",
  "tiktok.com": "M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z",
  "facebook.com": "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z",
  "web.whatsapp.com": "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z",
  "reddit.com": "M12 0C5.373 0 0 5.373 0 12c0 3.314 1.343 6.314 3.515 8.485l-2.286 2.286C.775 23.225 1.097 24 1.738 24H12c6.627 0 12-5.373 12-12S18.627 0 12 0Zm4.388 3.199c1.104 0 1.999.895 1.999 1.999 0 1.105-.895 2-1.999 2-.946 0-1.739-.657-1.947-1.539v.002c-1.147.162-2.032 1.15-2.032 2.341v.007c1.776.067 3.4.567 4.686 1.363.473-.363 1.064-.58 1.707-.58 1.547 0 2.802 1.254 2.802 2.802 0 1.117-.655 2.081-1.601 2.531-.088 3.256-3.637 5.876-7.997 5.876-4.361 0-7.905-2.617-7.998-5.87-.954-.447-1.614-1.415-1.614-2.538 0-1.548 1.255-2.802 2.803-2.802.645 0 1.239.218 1.712.585 1.275-.79 2.881-1.291 4.64-1.365v-.01c0-1.663 1.263-3.034 2.88-3.207.188-.911.993-1.595 1.959-1.595Zm-8.085 8.376c-.784 0-1.459.78-1.506 1.797-.047 1.016.64 1.429 1.426 1.429.786 0 1.371-.369 1.418-1.385.047-1.017-.553-1.841-1.338-1.841Zm7.406 0c-.786 0-1.385.824-1.338 1.841.047 1.017.634 1.385 1.418 1.385.785 0 1.473-.413 1.426-1.429-.046-1.017-.721-1.797-1.506-1.797Zm-3.703 4.013c-.974 0-1.907.048-2.77.135-.147.015-.241.168-.183.305.483 1.154 1.622 1.964 2.953 1.964 1.33 0 2.47-.81 2.953-1.964.057-.137-.037-.29-.184-.305-.863-.087-1.795-.135-2.769-.135Z",
  "youtube.com": "M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z",
  "netflix.com": "M5.398 0v.006c3.028 8.556 5.37 15.175 8.348 23.596 2.344.058 4.85.398 4.854.398-2.8-7.924-5.923-16.747-8.487-24zm8.489 0v9.63L18.6 22.951c-.043-7.86-.004-15.913.002-22.95zM5.398 1.05V24c1.873-.225 2.81-.312 4.715-.398v-9.22z",
  "twitch.tv": "M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z",
  "discord.com": "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z",
  "pinterest.com": "M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z",
  "threads.net": "M12.186 24h-.007c-3.581-.024-6.334-1.205-8.184-3.509C2.35 18.44 1.5 15.586 1.472 12.01v-.017c.03-3.579.879-6.43 2.525-8.482C5.845 1.205 8.6.024 12.18 0h.014c2.746.02 5.043.725 6.826 2.098 1.677 1.29 2.858 3.13 3.509 5.467l-2.04.569c-1.104-3.96-3.898-5.984-8.304-6.015-2.91.022-5.11.936-6.54 2.717C4.307 6.504 3.616 8.914 3.589 12c.027 3.086.718 5.496 2.057 7.164 1.43 1.783 3.631 2.698 6.54 2.717 2.623-.02 4.358-.631 5.8-2.045 1.647-1.613 1.618-3.593 1.09-4.798-.31-.71-.873-1.3-1.634-1.75-.192 1.352-.622 2.446-1.284 3.272-.886 1.102-2.14 1.704-3.73 1.79-1.202.065-2.361-.218-3.259-.801-1.063-.689-1.685-1.74-1.752-2.964-.065-1.19.408-2.285 1.33-3.082.88-.76 2.119-1.207 3.583-1.291a13.853 13.853 0 0 1 3.02.142c-.126-.742-.375-1.332-.75-1.757-.513-.586-1.308-.883-2.359-.89h-.029c-.844 0-1.992.232-2.721 1.32L7.734 7.847c.98-1.454 2.568-2.256 4.478-2.256h.044c3.194.02 5.097 1.975 5.287 5.388.108.046.216.094.321.142 1.49.7 2.58 1.761 3.154 3.07.797 1.82.871 4.79-1.548 7.158-1.85 1.81-4.094 2.628-7.277 2.65Zm1.003-11.69c-.242 0-.487.007-.739.021-1.836.103-2.98.946-2.916 2.143.067 1.256 1.452 1.839 2.784 1.767 1.224-.065 2.818-.543 3.086-3.71a10.5 10.5 0 0 0-2.215-.221z"
};
/* One tile can stand for several domains of the same site. */
const SITE_ALIASES = { "x.com": ["twitter.com"] };
const aliasOf = (s) => Object.keys(SITE_ALIASES).find((k) => SITE_ALIASES[k].includes(s));
const siteIcon = (s, size = 20) => SITE_ICONS[s]
  ? `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${SITE_ICONS[s]}" fill="currentColor"/></svg>`
  : `<svg viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true"><circle cx="10" cy="10" r="7.2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.8 10h14.4M10 2.8c2 2.2 2.9 4.6 2.9 7.2S12 15 10 17.2M10 2.8C8 5 7.1 7.4 7.1 10S8 15 10 17.2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`;

let state = { version: 1, lang: null, theme: "system", goal: null, days: {}, active: null, seen: {}, pomo: { ...POMO_DEFAULTS }, block: { ...BLOCK_DEFAULTS, sites: [...BLOCK_DEFAULTS.sites] } };
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
let playing = null;
function playSound(name, volume = state.pomo.volume) {
  if (!name || name === "none" || !SOUNDS.includes(name)) return;
  try {
    if (audio) audio.pause();
    audio = new Audio(`sounds/${name}.mp3`);
    audio.volume = Math.max(0, Math.min(1, volume));
    playing = name;
    markPlaying();
    const done = () => { if (playing === name) { playing = null; markPlaying(); } };
    audio.addEventListener("ended", done);
    audio.addEventListener("pause", done);
    audio.play().catch(done);
  } catch (e) { /* no sound is never an error */ }
}
function markPlaying() {
  document.querySelectorAll(".pp-snd").forEach((b) => b.classList.toggle("is-playing", b.dataset.sound === playing));
}
function renderVolume() {
  const v = Math.round(state.pomo.volume * 100);
  const r = $("pomo-volume");
  r.value = v;
  r.style.setProperty("--v", `${v}%`);
  $("pomo-volume-val").textContent = `${v}%`;
  const icon = $("pomo-mute");
  icon.dataset.level = v === 0 ? "0" : v < 50 ? "1" : "2";
}

function setMode(on) {
  if (state.active) {                              // a session keeps the mode it began with
    const m = $("mode");
    m.title = t("pomoLocked");
    replay(m, "nudge");
    return;
  }
  if (state.pomo.on === on) return on ? togglePomoPanel() : undefined;
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
  const pomoBtn = m.querySelector('[data-mode="pomo"]');
  pomoBtn.title = on && !state.active ? t("pomoSettings") : "";
  // the first time only: show what can be set
  if (on && animate && !(state.seen && state.seen.pomoPanel)) setTimeout(togglePomoPanel, 260);
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
  $("pomo-sounds").innerHTML = [...SOUNDS, "none"].map((n) => `<button class="pp-snd${n === chosen ? " is-on" : ""}${n === playing ? " is-playing" : ""}" data-sound="${n}" role="radio" aria-checked="${n === chosen}">`
    + `<span class="pp-ic">`
    + (n === "none"
      ? `<svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><path d="m4.5 4.5 7 7m0-7-7 7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`
      : `<svg class="play" viewBox="0 0 16 16" width="10" height="10" aria-hidden="true"><path d="M5 3.4v9.2L12.6 8Z" fill="currentColor"/></svg><span class="eq" aria-hidden="true"><i></i><i></i><i></i></span>`)
    + `</span><span class="pp-name">${t("snd_" + n)}</span>`
    + `<svg class="pp-check" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m3.5 8.4 2.9 2.9 6.1-6.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`).join("");
  renderVolume();
}

function togglePomoPanel() {
  if (!$("pomo-panel").hidden && !$("pomo-panel").classList.contains("closing")) return closePomoPanel();
  clearTimeout(closePomoPanel.timer);
  const p = $("pomo-panel");
  p.classList.remove("closing");
  renderPomoPanel();
  p.hidden = false;
  $("mode").classList.add("open");
  if (!state.seen) state.seen = {};
  if (!state.seen.pomoPanel) { state.seen.pomoPanel = true; save(); }
}
function closePomoPanel() {
  const p = $("pomo-panel");
  if (p.hidden || p.classList.contains("closing")) return;
  $("mode").classList.remove("open");
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
  $("view-settings").hidden = v !== "settings";
  const notice = $("report-notice");
  notice.hidden = !opts.notice;
  if (opts.notice) notice.textContent = opts.notice;
  if (v === "report") {
    reportWeek = opts.week || reportWeek || defaultReportWeek();
    renderReport();
  } else if (v === "settings") {
    renderSettings(true);
  } else {
    renderToday();
  }
}

/* ---------- settings: the site blocker ---------- */

/** "https://www.Instagram.com/foo" -> "instagram.com"; null if it is not a site. */
function normalizeSite(input) {
  let s = String(input || "").trim().toLowerCase();
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) && s.length <= 80 ? s : null;
}

function blockingNow() {
  return Boolean(state.block.on && state.block.sites.length && currentState() === "running");
}

function renderSettings(animate = false) {
  const b = state.block;
  $("block-on").setAttribute("aria-checked", String(b.on));
  $("block-card").classList.toggle("is-on", b.on);
  const live = $("block-live");
  live.hidden = !blockingNow();
  live.textContent = t("blockActive");

  // known sites are a tile with their mark; any other site shows its domain
  const list = $("sites");
  list.innerHTML = b.sites.filter((s) => !(aliasOf(s) && b.sites.includes(aliasOf(s)))).map((s) => {
    const known = Boolean(SITE_ICONS[s]);
    const label = SITE_NAMES[s] || s;
    return `<li class="site${known ? "" : " site-wide"}" data-site="${s}" title="${s}">`
      + siteIcon(s, known ? 22 : 16)
      + (known ? `<span class="sr">${label}</span>` : `<span class="site-domain">${s}</span>`)
      + `<button class="site-x" data-remove="${s}" aria-label="${t("remove")} ${label}"><svg viewBox="0 0 12 12" width="8" height="8" aria-hidden="true"><path d="m3 3 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></li>`;
  }).join("") || `<li class="sites-empty">${t("noSites")}</li>`;
  if (animate) stagger(list.children, 20);

  const rest = Object.keys(SITE_NAMES).filter((s) => !b.sites.includes(s));
  $("presets-wrap").hidden = rest.length === 0;
  $("presets").innerHTML = rest.map((s) => `<button class="preset" data-add="${s}" title="${SITE_NAMES[s]}" aria-label="${t("addSite")} ${SITE_NAMES[s]}">${siteIcon(s, 18)}<span class="preset-plus" aria-hidden="true"><svg viewBox="0 0 12 12" width="8" height="8"><path d="M6 2.5v7M2.5 6h7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></span></button>`).join("");
  renderExtStatus();
}

const EXT_ZIP = "https://github.com/mthsluna/lectern/releases/latest/download/Lectern-Extension.zip";
const EXT_GUIDE = "https://github.com/mthsluna/lectern/blob/main/extension/README.md#install";
let extDownloaded = false;
let extBrowsers = null;      // browsers on this computer that can take the extension
let extSetup = null;         // { id, name, path, page, copied } while the person adds the extension
let extPoll = 0;

function openExternal(url) {
  if (window.__TAURI__ && window.__TAURI__.opener) window.__TAURI__.opener.openUrl(url).catch(() => {});
  else window.open(url, "_blank");
}

async function renderExtStatus() {
  let seen = 0;
  try { if (tauri) seen = await tauri.invoke("bridge_seen"); } catch { /* older shell */ }
  const linked = seen && Date.now() - seen < 150000;
  const el = $("ext-status");
  el.classList.toggle("ok", Boolean(linked));
  if (linked && extSetup) {
    // it worked: the extension just said hello
    extSetup = null;
    clearInterval(extPoll);
    setTimeout(() => replay(el, "swap"), 0);
  }
  if (!linked && extBrowsers === null) {
    try { extBrowsers = tauri ? await tauri.invoke("ext_browsers") : []; } catch { extBrowsers = []; }
  }
  el.classList.toggle("steps", !linked && Boolean(extDownloaded || extSetup));
  if (linked) {
    el.innerHTML = `<i></i><span>${t("extConnected")}</span>`;
  } else if (extSetup) {
    // three steps, each with what to paste
    const copyBtn = (key) => `<button class="copy${extSetup.copied === key ? " done" : ""}" data-copy="${key}">`
      + `<svg class="i-copy" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="2" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M10.5 3.5v-.3a1.7 1.7 0 0 0-1.7-1.7H4.2a1.7 1.7 0 0 0-1.7 1.7v4.6a1.7 1.7 0 0 0 1.7 1.7h.3" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>`
      + `<svg class="i-done" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="m3.5 8.4 2.9 2.9 6.1-6.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      + `<span>${extSetup.copied === key ? t("extCopied") : t("extCopy")}</span></button>`;
    el.innerHTML = `<div class="setup">`
      + `<div class="setup-head"><span class="setup-title">${t("extSetupTitle", extSetup.name)}</span>`
      + `<button class="setup-x" id="setup-x" aria-label="${t("extCancel")}"><svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="m3 3 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button></div>`
      + `<ol class="stepper">`
      + `<li><span class="num">1</span><div><p>${t("extS1", extSetup.name)}</p><div class="copy-row"><code id="ext-page"></code>${copyBtn("page")}</div></div></li>`
      + `<li><span class="num">2</span><div><p>${t("extS2")}</p></div></li>`
      + `<li><span class="num">3</span><div><p>${t("extS3")}</p><div class="copy-row"><code id="ext-path"></code>${copyBtn("path")}</div>`
      + `<button class="setup-link" id="ext-reveal">${t("extReveal")}</button></div></li>`
      + `</ol><p class="setup-wait"><span class="spin" aria-hidden="true"></span>${t("extWaiting")}</p></div>`;
    $("ext-page").textContent = extSetup.page;
    $("ext-path").textContent = extSetup.path;
    el.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => {
      await copyText(b.dataset.copy === "page" ? extSetup.page : extSetup.path);
      extSetup.copied = b.dataset.copy;
      el.querySelectorAll("[data-copy]").forEach((x) => {
        const on = x.dataset.copy === extSetup.copied;
        x.classList.toggle("done", on);
        x.querySelector("span").textContent = on ? t("extCopied") : t("extCopy");
      });
      replay(b, "pop");
    }));
    $("ext-reveal").addEventListener("click", () => tauri && tauri.invoke("ext_reveal").catch(() => {}));
    $("setup-x").addEventListener("click", () => {
      extSetup = null;
      clearInterval(extPoll);
      renderExtStatus().then(() => replay(el, "swap"));
    });
  } else if (extBrowsers.length) {
    const [first, ...others] = extBrowsers;
    el.innerHTML = `<i></i><span>${t("extMissing")}</span><div class="ext-add">`
      + `<button class="ext-get" data-browser="${first.id}">${t("extAddTo", first.name)}</button>`
      + others.map((b) => `<button class="ext-alt" data-browser="${b.id}">${b.name}</button>`).join("")
      + `</div>`;
    el.querySelectorAll("[data-browser]").forEach((b) => b.addEventListener("click", () => setUpExtension(b.dataset.browser)));
  } else if (extDownloaded) {
    // the zip is on its way: what to do with it
    el.innerHTML = `<div class="ext-steps"><p class="ext-steps-title"><i></i>${t("extDownloading")}</p><ol>`
      + [t("extStep1"), t("extStep2"), t("extStep3")].map((s) => `<li>${s}</li>`).join("")
      + `</ol><button class="ext-guide" id="ext-guide">${t("extGuide")}</button></div>`;
    $("ext-guide").addEventListener("click", () => openExternal(EXT_GUIDE));
  } else {
    el.innerHTML = `<i></i><span>${t("extMissing")}</span><button class="ext-get" id="ext-get"><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M8 2.5v8m0 0L4.8 7.3M8 10.5l3.2-3.2M3 13.5h10" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>${t("extGetIt")}</button>`;
    $("ext-get").addEventListener("click", () => {
      openExternal(EXT_ZIP);           // the browser downloads it straight away
      extDownloaded = true;
      renderExtStatus().then(() => replay($("ext-status"), "swap"));
    });
  }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/* Unpacks the extension, brings the browser forward and copies its
   extensions address. No program may add an extension on its own, and
   browsers will not open their own pages for one, so the person pastes the
   address, turns on developer mode and picks the folder. */
async function setUpExtension(id) {
  const b = (extBrowsers || []).find((x) => x.id === id);
  if (!b || !tauri) return;
  let path, page;
  try { [path, page] = await tauri.invoke("ext_install", { browser: id }); } catch { return; }
  const copied = (await copyText(page)) ? "page" : null;
  extSetup = { id, name: b.name, path, page, copied };
  await renderExtStatus();
  replay($("ext-status"), "swap");
  clearInterval(extPoll);
  extPoll = setInterval(() => { if (view === "settings") renderExtStatus(); }, 3000);
}

function addSite(raw) {
  const site = normalizeSite(raw);
  const err = $("site-error");
  if (!site) {
    err.hidden = false;
    err.textContent = t("invalidSite");
    replay($("site-add"), "nudge");
    return false;
  }
  err.hidden = true;
  for (const s of [site, ...(SITE_ALIASES[site] || [])].reverse()) {
    if (!state.block.sites.includes(s)) state.block.sites.unshift(s);
  }
  save();
  renderSettings();
  const li = $("sites").querySelector(`[data-site="${site}"]`);
  if (li) replay(li, "pop");
  return true;
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
  else show(DEMO && params.get("view") === "settings" ? "settings" : "today");
  // demo only: open a popover for screenshots (?panel=pomo or ?panel=cal)
  const panel = DEMO && params.get("panel");
  if (panel) setTimeout(() => (panel === "cal" ? toggleCalendar() : togglePomoPanel()), 300);
}

/* ---------- the browser extension ----------
 * Buttons pressed in the extension arrive here, through lectern.exe
 * --remote. The window may be hidden: the commands run all the same.
 */

async function takeRemote() {
  if (!tauri) return;
  let raw = null;
  try { raw = await tauri.invoke("take_remote"); } catch { return; }
  if (raw) {
    let r = null;
    try { r = JSON.parse(raw); } catch { /* ignore a malformed command */ }
    if (r) runRemote(r.cmd, r.subject);
  }
  syncKeepAlive();
  try { await tauri.invoke("release_window"); } catch { /* still open: fine */ }
}

function runRemote(cmd, subject) {
  const s = currentState();
  if (cmd === "toggle") cmd = s === "running" ? "pause" : s === "paused" ? "resume" : "start";
  if (cmd === "start" && (s === "idle" || s === "closed")) {
    if (typeof subject === "string") draftSubject = subject.slice(0, 40);
    start();
  } else if (cmd === "pause" && s === "running") pause();
  else if (cmd === "resume" && s === "paused") resume();
  else if (cmd === "stop" && (s === "running" || s === "paused")) stop();
}

/* A Pomodoro keeps the interface loaded when the window closes. */
function syncKeepAlive() {
  if (tauri) tauri.invoke("set_keep_alive", { on: Boolean(state.active && state.active.pomo) }).catch(() => {});
}

function commitAndRender() {
  save();
  syncKeepAlive();
  pomoSchedule();
  renderMode();
  if (view === "today") renderToday(true);
  else if (view === "settings") renderSettings();
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
  if (!state.block || !Array.isArray(state.block.sites)) state.block = { ...BLOCK_DEFAULTS, sites: [...BLOCK_DEFAULTS.sites] };
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

  /* settings: the site blocker */
  $("block-on").addEventListener("click", () => {
    state.block.on = !state.block.on;
    save();
    renderSettings();
  });
  $("site-add").addEventListener("submit", (e) => {
    e.preventDefault();
    if (addSite($("site-input").value)) $("site-input").value = "";
  });
  $("site-input").addEventListener("input", () => { $("site-error").hidden = true; });
  $("sites").addEventListener("click", (e) => {
    const x = e.target.closest("[data-remove]");
    if (!x) return;
    const li = x.closest("li");
    li.classList.add("leaving");
    setTimeout(() => {
      const gone = [x.dataset.remove, ...(SITE_ALIASES[x.dataset.remove] || [])];
      state.block.sites = state.block.sites.filter((s) => !gone.includes(s));
      save();
      renderSettings();
    }, 160);
  });
  $("presets").addEventListener("click", (e) => {
    const p = e.target.closest("[data-add]");
    if (p) addSite(p.dataset.add);
  });

  /* Pomodoro */
  $("mode").addEventListener("click", (e) => {
    e.stopPropagation();
    const b = e.target.closest(".mode-opt");
    if (b) setMode(b.dataset.mode === "pomo");
  });
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
  $("pomo-volume").addEventListener("input", (e) => {
    state.pomo.volume = Number(e.target.value) / 100;
    if (audio) audio.volume = state.pomo.volume;
    renderVolume();
  });
  $("pomo-volume").addEventListener("change", () => {
    save();
    if (state.pomo.volume > 0) playSound(state.pomo[soundEvent] === "none" ? "marimba" : state.pomo[soundEvent]);
  });
  $("pomo-mute").addEventListener("click", (e) => {
    e.stopPropagation();
    const v = state.pomo.volume;
    state.pomo.volume = v > 0 ? 0 : (renderVolume.last || 0.8);
    if (v > 0) renderVolume.last = v;
    if (audio) audio.volume = state.pomo.volume;
    save();
    renderVolume();
  });
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
  syncKeepAlive();
  if (window.__TAURI__ && window.__TAURI__.event) window.__TAURI__.event.listen("remote", takeRemote);
  takeRemote();
  setInterval(() => {
    pomoTick();
    if (!state.lang || !$("picker").hidden) return;
    if (todayKey() !== lastDay) {
      lastDay = todayKey();
      settleStaleSession();
      const a = autoReport();
      if (a) return show("report", a);
      return view === "today" ? renderToday() : view === "settings" ? renderSettings() : renderReport();
    }
    if (view === "today") {
      renderTimer();
      if (state.active && state.active.status === "running") renderWeekStrip();
    } else if (view === "report" && state.active) {
      renderReport();
    }
  }, 500);
})();
