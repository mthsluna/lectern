// Prepares the browser extension and packs it for a release.
//
//   npm run build:extension   ->   dist/Lectern-Extension-<version>.zip
//
// The extension shares the app's translations and mark, so both are copied
// in from src/, the icons are drawn from the app icon, and the version
// follows package.json.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ext = path.join(root, "extension");
const { version } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

fs.mkdirSync(path.join(ext, "icons"), { recursive: true });
fs.mkdirSync(path.join(ext, "fonts"), { recursive: true });
fs.copyFileSync(path.join(root, "src", "i18n.js"), path.join(ext, "i18n.js"));
fs.copyFileSync(path.join(root, "src", "mark.svg"), path.join(ext, "icons", "mark.svg"));
fs.copyFileSync(path.join(root, "src", "fonts", "inter.woff2"), path.join(ext, "fonts", "inter.woff2"));

const icon = path.join(root, "docs", "brand", "lectern-app-icon.png");
for (const size of [16, 32, 48, 128]) {
  await sharp(icon).resize(size, size).png().toFile(path.join(ext, "icons", `icon-${size}.png`));
}

const manifestPath = path.join(ext, "manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.version = version;
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

const out = path.join(root, "dist", `Lectern-Extension-${version}.zip`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });
// Windows 10+ ships bsdtar, which writes zip files with -a (Git Bash has a different tar)
const sysTar = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
execFileSync(fs.existsSync(sysTar) ? sysTar : "tar", ["-a", "-c", "-f", out, "-C", ext, "."]);
fs.copyFileSync(out, path.join(root, "dist", "Lectern-Extension.zip"));
console.log(`· ${path.relative(root, out)} (${(fs.statSync(out).size / 1024).toFixed(0)} KB)`);
