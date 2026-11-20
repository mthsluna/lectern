/* The page shown instead of a blocked site. When the timer pauses or stops,
 * it offers the site again. */

/* global LANGS, STRINGS */
const $ = (id) => document.getElementById(id);
const hasChrome = Boolean(globalThis.chrome && chrome.runtime && chrome.runtime.id);
const site = decodeURIComponent(location.hash.slice(1)).replace(/^www\./, "") || "This site";

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

function show(on) {
  document.body.dataset.on = on ? "1" : "0";
  $("title").textContent = on ? t("blockedTitle") : t("blockedBreak");
  $("text").textContent = t("blockedText", site);
  $("text").hidden = !on;
  $("hint").textContent = t("blockedHint");
  $("hint").hidden = !on;
  $("close").textContent = t("closeTab");
  const open = $("open");
  open.hidden = on;
  open.textContent = t("blockedOpen", site);
  open.href = `https://${site}/`;
}

$("close").addEventListener("click", async () => {
  if (hasChrome) {
    const tab = await chrome.tabs.getCurrent();
    if (tab) return chrome.tabs.remove(tab.id);
  }
  window.close();
});

show(true);
if (hasChrome) {
  chrome.runtime.sendMessage({ type: "is-blocking" }).then((r) => r && show(r.on)).catch(() => {});
  chrome.runtime.onMessage.addListener((msg) => { if (msg && msg.type === "blocking") show(msg.on); });
}
