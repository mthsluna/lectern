// Captures README screenshots from the demo data and composes the showcase.
//
//   npm run screenshots
//
// Serves src/ locally, renders each screen with headless Edge (Windows) or
// Chrome, then lays the screens side by side on a transparent canvas, once
// in the light theme and once in the dark theme.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src");
const out = path.join(root, "docs");
const tmp = fs.mkdtempSync(path.join(fs.realpathSync(process.env.TEMP || "/tmp"), "lectern-shots-"));

const BROWSERS = [
  process.env.BROWSER,
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
].filter(Boolean);
const browser = BROWSERS.find((b) => fs.existsSync(b));
if (!browser) throw new Error("No Chromium browser found. Set BROWSER=/path/to/chrome.");

const W = 460, H = 800, SCALE = 2;
const SCREENS = [
  ["today", "state=running"],
  ["report", "view=report&today=2026-11-21&state=closed&notice=1"],
  ["languages", "pick"],
];

/* tiny static server for src/ */
const TYPES = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
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

function shoot(name, query, theme) {
  const file = path.join(tmp, `${name}-${theme}.png`);
  // headless Chromium enforces a minimum window width, so render wider and crop
  execFileSync(browser, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--lang=en-US",
    `--force-device-scale-factor=${SCALE}`, `--window-size=520,${H}`,
    "--virtual-time-budget=3000", `--screenshot=${file}`,
    `${base}/?demo&${query}&theme=${theme}`,
  ], { stdio: "ignore" });
  return file;
}

async function screen(file, theme) {
  const r = 22 * SCALE;
  const w = W * SCALE, h = H * SCALE;
  const shot = await sharp(file).resize(w, h, { fit: "cover", position: "top" }).toBuffer();
  const border = theme === "dark" ? "#34332f" : "#e3e0d4";
  const mask = Buffer.from(`<svg width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${r}"/></svg>`);
  const frame = Buffer.from(`<svg width="${w}" height="${h}"><rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="${r}" fill="none" stroke="${border}" stroke-width="2"/></svg>`);
  return sharp(shot).composite([{ input: mask, blend: "dest-in" }, { input: frame }]).png().toBuffer();
}

for (const theme of ["light", "dark"]) {
  const gap = 40 * SCALE;
  const tiles = [];
  for (const [i, [name, query]] of SCREENS.entries()) {
    tiles.push({ input: await screen(shoot(name, query, theme), theme), left: i * (W * SCALE + gap), top: 0 });
  }
  const width = SCREENS.length * W * SCALE + (SCREENS.length - 1) * gap;
  await sharp({ create: { width, height: H * SCALE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles)
    .png()
    .toBuffer()
    .then((buf) => sharp(buf).resize(1800).png({ compressionLevel: 9, palette: true, quality: 95 }).toFile(path.join(out, `showcase-${theme}.png`)));
  console.log(`docs/showcase-${theme}.png`);
}

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
