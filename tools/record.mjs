// Records short animated clips of the app for the README and the website.
//
//   npm run clips
//
// Serves src/, drives headless Edge or Chrome over the DevTools protocol,
// captures frames while it clicks through a scene, and writes each scene as
// an animated WebP in docs/clips/.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const out = path.join(root, "docs", "clips");
fs.mkdirSync(out, { recursive: true });

const BROWSERS = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean);
const browserPath = BROWSERS.find((b) => fs.existsSync(b));
if (!browserPath) throw new Error("No Chromium browser found. Set BROWSER=/path/to/chrome.");

const W = 520, SCALE = 2, OUT_W = 640, MIN_FRAME = 70;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* static server for src/ */
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".mp3": "audio/mpeg" };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p === "/") p = "/index.html";
  const file = path.join(src, p);
  if (!file.startsWith(src) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

/* browser with a debugging port */
const profile = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP || "/tmp"), "lectern-rec-"));
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(browserPath, [
  "--headless=new", "--disable-gpu", "--hide-scrollbars", "--mute-audio", "--lang=en-US",
  "--autoplay-policy=no-user-gesture-required", `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`, "about:blank",
], { stdio: "ignore" });

let target;
for (let i = 0; i < 50 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); }
  catch { await sleep(200); }
}
if (!target) throw new Error("Browser did not start");

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let seq = 0;
const pending = new Map();
const waiters = [];
ws.addEventListener("message", (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  if (msg.method) waiters.filter((w) => w.method === msg.method).forEach((w) => { w.resolve(msg.params); waiters.splice(waiters.indexOf(w), 1); });
});
const cdp = (method, params = {}) => new Promise((resolve) => { const id = ++seq; pending.set(id, resolve); ws.send(JSON.stringify({ id, method, params })); });
const once = (method) => new Promise((resolve) => waiters.push({ method, resolve }));
const js = (expr) => cdp("Runtime.evaluate", { expression: expr, awaitPromise: true });

await cdp("Page.enable");

/* recording: frames keep coming while the scene runs */
async function record(name, query, height, scene) {
  await cdp("Emulation.setDeviceMetricsOverride", { width: W, height, deviceScaleFactor: SCALE, mobile: false });
  const loaded = once("Page.loadEventFired");
  await cdp("Page.navigate", { url: `${base}/?demo&lang=en&theme=light&${query}` });
  await loaded;
  await sleep(150);

  const frames = [];
  let running = true;
  const grab = (async () => {
    while (running) {
      const t0 = Date.now();
      const { data } = await cdp("Page.captureScreenshot", { format: "png" });
      frames.push({ t: t0, data });
      const spent = Date.now() - t0;
      if (spent < MIN_FRAME) await sleep(MIN_FRAME - spent);
    }
  })();
  await scene();
  running = false;
  await grab;

  // each frame lasts until the next one was taken
  const delays = frames.map((f, i) => Math.max(20, (frames[i + 1] ? frames[i + 1].t : f.t + 900) - f.t));
  const outH = Math.round((height / W) * OUT_W);
  const bufs = await Promise.all(frames.map((f) => sharp(Buffer.from(f.data, "base64")).resize(OUT_W, outH).png().toBuffer()));
  // round the corners and draw a hairline, like the still screenshots
  const r = Math.round(22 * OUT_W / W);
  const mask = Buffer.from(`<svg width="${OUT_W}" height="${outH}"><rect width="${OUT_W}" height="${outH}" rx="${r}"/></svg>`);
  const frame = Buffer.from(`<svg width="${OUT_W}" height="${outH}"><rect x=".75" y=".75" width="${OUT_W - 1.5}" height="${outH - 1.5}" rx="${r}" fill="none" stroke="#e3e0d4" stroke-width="1.5"/></svg>`);
  const framed = await Promise.all(bufs.map((b) => sharp(b).composite([{ input: mask, blend: "dest-in" }, { input: frame }]).png().toBuffer()));
  const file = path.join(out, `${name}.webp`);
  await sharp(framed, { join: { animated: true } })
    .webp({ quality: 82, effort: 6, loop: 0, delay: delays, minSize: true, mixed: true })
    .toFile(file);
  console.log(`docs/clips/${name}.webp  ${frames.length} frames, ${(fs.statSync(file).size / 1024).toFixed(0)} KB`);
}

const click = (sel) => js(`document.querySelector(${JSON.stringify(sel)}).click()`);

/* 1. Start: the button, then the clock running */
await record("timer", "", 720, async () => {
  await sleep(1100);
  await click("#controls .btn-primary");
  await sleep(4600);
});

/* 2. Pomodoro: switch, settings, a chime, the volume, then the countdown */
await record("pomodoro", "", 720, async () => {
  await sleep(700);
  await click('.mode-opt[data-mode="pomo"]');
  await sleep(1300);
  await click('[data-sound="kalimba"]');
  await sleep(1100);
  for (let v = 80; v >= 45; v -= 5) {
    await js(`(() => { const r = document.getElementById("pomo-volume"); r.value = ${v}; r.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await sleep(60);
  }
  await sleep(700);
  await js("document.body.click()");
  await sleep(600);
  await click("#controls .btn-primary");
  await sleep(3400);
});

/* 3. Report: bars grow, a week back, the calendar */
await record("report", "view=report&today=2026-11-21&state=closed", 720, async () => {
  await sleep(1600);
  await click("#prev-week");
  await sleep(1600);
  await click("#next-week");
  await sleep(1300);
  await js(`document.querySelector(".week-chip.is-center").click()`);
  await sleep(1900);
  await js("document.body.click()");
  await sleep(700);
});

ws.close();
proc.kill();
server.close();
await sleep(300);
try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
