/* Keeps the toolbar badge current: today's hours while you study, in green;
 * grey while you are on a break; nothing otherwise. Linked to the app, it
 * reads the app's data; on its own, the extension's.
 */
import * as C from "./core.js";

async function currentData() {
  try {
    const r = await chrome.runtime.sendNativeMessage(C.HOST, { type: "state" });
    if (r && r.type === "state" && r.data) return r.data;
  } catch { /* the app is not installed: the extension works on its own */ }
  return (await chrome.storage.local.get(C.STORE_KEY))[C.STORE_KEY] || C.emptyState();
}

async function updateBadge() {
  const data = await currentData();
  const s = C.currentState(data);
  if (s !== "running" && s !== "paused") {
    await chrome.action.setBadgeText({ text: "" });
    return;
  }
  const a = data.active;
  const text = a.pomo
    ? `${Math.ceil(C.pomoLeft(a) / 60000)}m`
    : C.badgeText(C.liveFor(data, C.todayKey()).study);
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color: s === "running" ? "#2f6b55" : "#8a887f" });
  if (chrome.action.setBadgeTextColor) await chrome.action.setBadgeTextColor({ color: "#ffffff" });
}

function schedule() {
  chrome.alarms.create("tick", { periodInMinutes: 0.5 });
  updateBadge();
}

chrome.runtime.onInstalled.addListener(schedule);
chrome.runtime.onStartup.addListener(schedule);
chrome.alarms.onAlarm.addListener(updateBadge);
chrome.storage.onChanged.addListener(updateBadge);
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "badge") updateBadge();
});
