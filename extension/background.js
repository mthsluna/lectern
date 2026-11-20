/* The extension's background: the toolbar badge and the site blocker.
 *
 * Linked to the app, it keeps a native port open; the app's bridge sends the
 * study data again whenever the app saves, so pressing Start in the app
 * blocks sites at once, and a break opens them at once. On its own, it uses
 * the extension's data. Sites are blocked only while the timer runs.
 */
import * as C from "./core.js";

let port = null;
let appData = null;        // the app's data while linked
let lastRules = "";
let wasBlocking = false;

/* ---------- the link ---------- */

function connect() {
  if (port) return;
  try { port = chrome.runtime.connectNative(C.HOST); } catch { port = null; return; }
  port.onMessage.addListener((msg) => {
    if (msg && msg.type === "hello") port.postMessage({ type: "state" });
    if (msg && msg.type === "state") { appData = msg.data || null; refresh(); }
  });
  port.onDisconnect.addListener(() => {
    void chrome.runtime.lastError;      // "host not found" when the app is not installed
    port = null;
    appData = null;
    refresh();
  });
  port.postMessage({ type: "hello" });
}

async function currentData() {
  if (appData) return { data: appData, linked: true };
  const local = (await chrome.storage.local.get(C.STORE_KEY))[C.STORE_KEY] || C.emptyState();
  return { data: local, linked: false };
}

/* ---------- badge ---------- */

async function updateBadge(data) {
  const s = C.currentState(data);
  if (s !== "running" && s !== "paused") return chrome.action.setBadgeText({ text: "" });
  const a = data.active;
  const text = a.pomo ? `${Math.ceil(C.pomoLeft(a) / 60000)}m` : C.badgeText(C.liveFor(data, C.todayKey()).study);
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: s === "running" ? "#2f6b55" : "#8a887f" });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: "#ffffff" });
}

/* ---------- blocker ---------- */

async function applyBlock(data) {
  const blocking = C.isBlocking(data);
  const sites = blocking ? C.blockList(data) : [];
  // With access to sites, a calm page replaces the blocked one; without it,
  // the browser's own "blocked" page is shown.
  const calm = await chrome.permissions.contains({ origins: ["<all_urls>"] });
  const key = `${sites.join(",")}|${calm}`;
  if (key !== lastRules) {
    lastRules = key;
    const old = await chrome.declarativeNetRequest.getDynamicRules();
    const addRules = sites.length ? [{
      id: 1,
      priority: 1,
      condition: { regexFilter: "^https?://([^/?#]+)", requestDomains: sites, resourceTypes: ["main_frame", "sub_frame"] },
      action: calm
        ? { type: "redirect", redirect: { regexSubstitution: `${chrome.runtime.getURL("blocked.html")}#\\1` } }
        : { type: "block" },
    }] : [];
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map((r) => r.id), addRules });
  }

  // Tabs already open on a blocked site follow along, when the extension may see them.
  if (blocking && !wasBlocking && calm) {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
      try {
        const u = new URL(tab.url || "");
        if (/^https?:$/.test(u.protocol) && C.matchesSite(u.hostname, sites)) {
          chrome.tabs.update(tab.id, { url: `${chrome.runtime.getURL("blocked.html")}#${u.hostname}` });
        }
      } catch { /* not a web page */ }
    }
  }
  if (blocking !== wasBlocking) chrome.runtime.sendMessage({ type: "blocking", on: blocking }).catch(() => {});
  wasBlocking = blocking;
}

async function refresh() {
  const { data } = await currentData();
  await updateBadge(data);
  await applyBlock(data);
}

/* ---------- events ---------- */

function wake() {
  chrome.alarms.create("tick", { periodInMinutes: 0.5 });
  connect();
  refresh();
}

chrome.runtime.onInstalled.addListener(wake);
chrome.runtime.onStartup.addListener(wake);
chrome.alarms.onAlarm.addListener(() => { connect(); refresh(); });
chrome.storage.onChanged.addListener(refresh);
chrome.permissions.onAdded.addListener(refresh);
chrome.permissions.onRemoved.addListener(refresh);
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === "badge") { connect(); refresh(); }
  if (msg && msg.type === "is-blocking") {
    currentData().then(({ data }) => reply({ on: C.isBlocking(data) }));
    return true;
  }
});
connect();
refresh();
