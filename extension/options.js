/* Blocked sites for the extension on its own. Linked to the app, the list
 * lives in the app's Settings instead. */
import * as C from "./core.js";

/* global LANGS, STRINGS */
const $ = (id) => document.getElementById(id);
const hasChrome = Boolean(globalThis.chrome && chrome.runtime && chrome.runtime.id);
const code = String((hasChrome ? chrome.i18n.getUILanguage() : navigator.language) || "en").toLowerCase().split("-")[0];
const lang = STRINGS[code] ? code : "en";
const t = (key, ...args) => {
  const v = (STRINGS[lang] && STRINGS[lang][key]) ?? STRINGS.en[key];
  return typeof v === "function" ? v(...args) : v;
};
const info = LANGS.find((l) => l.code === lang) || LANGS[0];
document.documentElement.lang = info.code;
document.documentElement.dir = info.rtl ? "rtl" : "ltr";
document.documentElement.dataset.dark = matchMedia("(prefers-color-scheme: dark)").matches ? "1" : "";

let local = C.emptyState();
let linked = false;

async function load() {
  try {
    local = hasChrome ? (await chrome.storage.local.get(C.STORE_KEY))[C.STORE_KEY] || C.emptyState()
      : JSON.parse(localStorage.getItem(C.STORE_KEY)) || C.emptyState();
  } catch { local = C.emptyState(); }
  if (!local.block) local.block = { on: false, sites: [...C.DEFAULT_SITES] };
}
async function save() {
  if (hasChrome) await chrome.storage.local.set({ [C.STORE_KEY]: local });
  else localStorage.setItem(C.STORE_KEY, JSON.stringify(local));
}

async function render() {
  $("title").textContent = t("blockTitle");
  $("desc").textContent = t("blockDesc");
  $("add-btn").textContent = t("addSite");
  $("managed").hidden = !linked;
  $("managed").textContent = t("blockManaged");
  $("editor").hidden = linked;
  $("on").hidden = linked;
  $("on").setAttribute("aria-checked", String(local.block.on));
  $("sites").innerHTML = "";
  for (const s of local.block.sites) {
    const li = document.createElement("li");
    li.innerHTML = `<span></span><button aria-label="${t("remove")}">×</button>`;
    li.querySelector("span").textContent = s;
    li.querySelector("button").addEventListener("click", async () => {
      local.block.sites = local.block.sites.filter((x) => x !== s);
      await save();
      render();
    });
    $("sites").appendChild(li);
  }
  const calm = hasChrome ? await chrome.permissions.contains({ origins: ["<all_urls>"] }) : true;
  $("allow-row").hidden = calm;
  $("allow-note").textContent = t("allowNote");
  $("allow").textContent = t("allowBlock");
}

$("on").addEventListener("click", async () => { local.block.on = !local.block.on; await save(); render(); });
$("add").addEventListener("submit", async (e) => {
  e.preventDefault();
  const site = C.normalizeSite($("site").value);
  $("error").hidden = Boolean(site);
  $("error").textContent = t("invalidSite");
  if (!site) return;
  if (!local.block.sites.includes(site)) local.block.sites.unshift(site);
  $("site").value = "";
  await save();
  render();
});
$("allow").addEventListener("click", async () => {
  if (hasChrome) await chrome.permissions.request({ origins: ["<all_urls>"] });
  render();
});

// linked? then the app's Settings own the list
if (hasChrome) {
  try {
    const port = chrome.runtime.connectNative(C.HOST);
    port.onMessage.addListener((m) => { if (m && m.type === "hello") { linked = true; render(); port.disconnect(); } });
    port.onDisconnect.addListener(() => void chrome.runtime.lastError);
    port.postMessage({ type: "hello" });
  } catch { /* on its own */ }
}
await load();
render();
