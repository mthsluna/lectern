// Captures the screens shown on the project page (docs/index.html).
//
//   npm run screenshots:site
//
// Same approach as capture.mjs: serve src/, render each screen with headless
// Edge or Chrome from the demo data, then round the corners and add a hairline.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const out = path.join(root, "docs", "shots");
fs.mkdirSync(out, { recursive: true });
const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP || "/tmp"), "lectern-site-"));

const BROWSERS = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean);
const browser = BROWSERS.find((b) => fs.existsSync(b));
if (!browser) throw new Error("No Chromium browser found. Set BROWSER=/path/to/chrome.");

const W = 520, SCALE = 2;
const DAY = "today=2026-11-21";
// name, query, theme, height
const SHOTS = [
  ["today", "state=running", "light", 700],
  ["today-dark", "state=running", "dark", 700],
  ["pomodoro", "state=running&pomo=focus", "light", 420],
  ["pomodoro-settings", "pomo=1&panel=pomo", "light", 720],
  ["report", `view=report&${DAY}&state=closed`, "light", 760],
  ["calendar", `view=report&${DAY}&state=closed&panel=cal`, "light", 520],
  ["languages", "pick", "light", 700],
];

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

for (const [name, query, theme, H] of SHOTS) {
  const raw = path.join(tmp, `${name}.png`);
  await run(browser, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--lang=en-US",
    `--force-device-scale-factor=${SCALE}`, `--window-size=${W},${H}`,
    "--virtual-time-budget=4000", `--screenshot=${raw}`,
    `${base}/?demo&lang=en&${query}&theme=${theme}`,
  ], { timeout: 60000 });
  const w = W * SCALE, h = H * SCALE, r = 22 * SCALE;
  const shot = await sharp(raw).resize(w, h, { fit: "cover", position: "top" }).toBuffer();
  const border = theme === "dark" ? "#34332f" : "#e3e0d4";
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}"/></svg>`);
  const frame = Buffer.from(`<svg width="${w}" height="${h}"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${r}" fill="none" stroke="${border}" stroke-width="2"/></svg>`);
  await sharp(shot).composite([{ input: mask, blend: "dest-in" }, { input: frame }])
    .webp({ quality: 88 })
    .toFile(path.join(out, `${name}.webp`));
  console.log(`docs/shots/${name}.webp`);
}

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
