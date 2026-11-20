"use strict";

/* Lectern Setup: one window, a few calm screens.
 *   install / update  ->  progress  ->  done
 *   uninstall         ->  progress  ->  removed
 * Outside Tauri (opened in a browser) it runs against a fake backend, so the
 * screens can be previewed: add ?mode=install|update|uninstall&lang=pt.
 */

const params = new URLSearchParams(location.search);
const tauri = window.__TAURI__;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const backend = tauri
  ? { invoke: tauri.core.invoke, win: tauri.window.getCurrentWindow() }
  : {
      invoke: async (cmd) => {
        await sleep(300);
        if (cmd === "fetch_update") return { version: "1.13.0", url: "", digest: null };
        if (cmd === "context") {
          return {
            mode: params.get("mode") || "install", version: "1.7.0", installed: "1.6.1",
            dir: "C:\\Users\\you\\AppData\\Local\\Lectern", desktop: false, startup: false,
            lang: params.get("lang"), theme: params.get("theme"),
          };
        }
      },
      win: { close() {}, minimize() {} },
    };

const $ = (id) => document.getElementById(id);
let ctx, lang = "en";
const opts = { desktop: false, startup: false, keep: true };

function t(key, ...args) {
  const v = (S[lang] && S[lang][key]) ?? S.en[key];
  return typeof v === "function" ? v(...args) : v;
}

function pickLanguage(saved) {
  if (saved && S[saved]) return saved;
  for (const l of navigator.languages || [navigator.language || "en"]) {
    const code = l.toLowerCase().split("-")[0];
    if (S[code]) return code;
  }
  return "en";
}

/* ---------- building blocks ---------- */

function screen({ title, lede = "", options = null, progress = false, actions = [], foot = "" }) {
  const s = $("screen");
  s.classList.remove("enter");
  void s.offsetWidth;                 // restart the entrance animation
  s.classList.add("enter");
  $("title").textContent = title;
  $("lede").textContent = lede;
  $("foot").textContent = foot;

  const box = $("options");
  box.hidden = !options;
  box.innerHTML = "";
  for (const o of options || []) {
    const b = document.createElement("button");
    b.className = "option";
    b.setAttribute("role", "switch");
    b.setAttribute("aria-checked", String(opts[o.key]));
    b.innerHTML = `<span></span><span class="switch"></span>`;
    b.firstChild.textContent = o.label;
    b.addEventListener("click", () => {
      opts[o.key] = !opts[o.key];
      b.setAttribute("aria-checked", String(opts[o.key]));
    });
    box.appendChild(b);
  }

  $("progress").hidden = !progress;

  const bar = $("actions");
  bar.innerHTML = "";
  for (const a of actions) {
    const b = document.createElement("button");
    b.className = `btn ${a.kind || "btn-primary"}`;
    b.textContent = a.label;
    b.addEventListener("click", a.run);
    bar.appendChild(b);
  }
}

function mark(state) {
  const m = $("mark");
  m.classList.remove("busy", "done", "gone");
  if (state) { void m.offsetWidth; m.classList.add(state); }
}

const close = () => backend.win.close();

/* ---------- screens ---------- */

/* Started by Lectern's Update button: no questions, just update and reopen. */
async function runSelfUpdate() {
  const fill = $("fill");
  const step = (label, pct) => { $("step").textContent = label; fill.style.width = `${pct}%`; };
  try {
    screen({ title: t("updatingTitle"), progress: true });
    mark("busy");
    step(t("s_check"), 6);
    const [release] = await Promise.all([backend.invoke("fetch_update"), sleep(450)]);
    $("lede").textContent = `Lectern ${release.version}`;
    step(t("s_download"), 22);
    await Promise.all([backend.invoke("download_update", { release }), sleep(600)]);
    step(t("s_close"), 62);
    await Promise.all([backend.invoke("close_running"), sleep(400)]);
    step(t("s_copy"), 82);
    await Promise.all([backend.invoke("apply_update", { version: release.version }), sleep(450)]);
    fill.style.width = "100%";
    await sleep(350);
    mark("done");
    screen({ title: t("updated"), lede: t("reopening") });
    await sleep(1100);
    await backend.invoke("launch");
    close();
  } catch (e) {
    failed(e);
  }
}

function welcome() {
  if (ctx.mode === "self-update") return runSelfUpdate();
  if (ctx.mode === "uninstall") {
    return screen({
      title: t("removeTitle"),
      lede: t("removeSub"),
      options: [{ key: "keep", label: t("keep") }],
      actions: [
        { label: t("remove"), run: runUninstall },
        { label: t("cancel"), kind: "btn-link", run: close },
      ],
    });
  }
  const updating = ctx.mode === "update";
  screen({
    title: updating ? t("updateTitle") : "Lectern",
    lede: updating ? t("updateSub", ctx.installed, ctx.version) : t("tagline"),
    options: [
      { key: "desktop", label: t("desktop") },
      { key: "startup", label: t("startup") },
    ],
    actions: [{ label: updating ? t("update") : t("install"), run: runInstall }],
    foot: t("where", ctx.dir.replace(/^.*?\\(AppData\\)/i, "$1")),
  });
}

async function runSteps(title, steps) {
  screen({ title, progress: true });
  mark("busy");
  const fill = $("fill");
  fill.style.width = "4%";
  for (const [i, [label, cmd, args]] of steps.entries()) {
    $("step").textContent = label;
    // a minimum pace, so each step can be read
    await Promise.all([backend.invoke(cmd, args), sleep(520)]);
    fill.style.width = `${((i + 1) / steps.length) * 100}%`;
  }
  await sleep(450);
}

async function runInstall() {
  try {
    await runSteps(ctx.mode === "update" ? t("updating") : t("installing"), [
      [t("s_close"), "close_running"],
      [t("s_copy"), "copy_files"],
      [t("s_links"), "shortcuts", { desktop: opts.desktop }],
      [t("s_register"), "register", { startup: opts.startup }],
    ]);
    mark("done");
    screen({
      title: t("ready"),
      lede: t("readySub"),
      actions: [
        { label: t("open"), run: async () => { await backend.invoke("launch"); close(); } },
        { label: t("close"), kind: "btn-link", run: close },
      ],
    });
  } catch (e) {
    failed(e);
  }
}

async function runUninstall() {
  try {
    await runSteps(t("removing"), [[t("s_close"), "uninstall", { keepData: opts.keep }]]);
    mark("gone");
    screen({
      title: t("removed"),
      lede: t("removedSub", opts.keep),
      actions: [{ label: t("close"), run: close }],
    });
  } catch (e) {
    failed(e);
  }
}

function failed(e) {
  mark(null);
  screen({
    title: t("failed"),
    lede: String(e),
    actions: [{ label: t("close"), kind: "btn-ghost", run: close }],
  });
}

/* ---------- boot ---------- */

(async function boot() {
  $("close").addEventListener("click", close);
  $("min").addEventListener("click", () => backend.win.minimize());
  document.addEventListener("contextmenu", (e) => e.preventDefault());

  ctx = await backend.invoke("context");
  lang = pickLanguage(ctx.lang);
  document.documentElement.lang = lang;
  document.documentElement.dir = RTL.includes(lang) ? "rtl" : "ltr";
  if (ctx.theme === "light" || ctx.theme === "dark") document.documentElement.dataset.theme = ctx.theme;
  opts.desktop = ctx.desktop;
  opts.startup = ctx.startup;
  welcome();
})();
