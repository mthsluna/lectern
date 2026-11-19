// Builds Lectern, then builds Lectern Setup around it.
//
//   npm run build   ->   dist/Lectern-Setup-<version>.exe
//
// 1. compile the app (no bundle)
// 2. gzip lectern.exe into setup/payload/ (embedded by the installer)
// 3. copy the font the installer UI shares with the app
// 4. compile the installer and copy it to dist/

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
const target = process.env.CARGO_TARGET_DIR || path.join(root, "src-tauri", "target");
const tauri = path.join(root, "node_modules", ".bin", process.platform === "win32" ? "tauri.cmd" : "tauri");
const sh = (cmd, cwd) => execSync(cmd, { cwd, stdio: "inherit", env: process.env });

console.log(`\n· Building Lectern ${version}`);
sh(`"${tauri}" build --no-bundle`, root);

console.log("\n· Packing the app into the installer");
const exe = fs.readFileSync(path.join(target, "release", "lectern.exe"));
fs.mkdirSync(path.join(root, "setup", "payload"), { recursive: true });
fs.writeFileSync(path.join(root, "setup", "payload", "lectern.exe.gz"), zlib.gzipSync(exe, { level: 9 }));
fs.mkdirSync(path.join(root, "setup", "ui", "fonts"), { recursive: true });
fs.copyFileSync(path.join(root, "src", "fonts", "inter.woff2"), path.join(root, "setup", "ui", "fonts", "inter.woff2"));

// keep the installer's version in step with the app
for (const [file, re, rep] of [
  ["setup/src-tauri/Cargo.toml", /^version = ".*"$/m, `version = "${version}"`],
  ["setup/src-tauri/tauri.conf.json", /"version": ".*?"/, `"version": "${version}"`],
]) {
  const p = path.join(root, file);
  fs.writeFileSync(p, fs.readFileSync(p, "utf8").replace(re, rep));
}

console.log("\n· Building Lectern Setup");
sh(`"${tauri}" build --no-bundle`, path.join(root, "setup"));

const out = path.join(root, "dist", `Lectern-Setup-${version}.exe`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.copyFileSync(path.join(target, "release", "lectern-setup.exe"), out);
console.log(`\n· ${path.relative(root, out)} (${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
