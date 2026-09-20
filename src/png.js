import fs from "node:fs";
import { execFileSync } from "node:child_process";

const CANDIDATES = [
  process.env.SAID_DONE_CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

export function findChrome() {
  for (const p of CANDIDATES) if (fs.existsSync(p)) return p;
  for (const name of ["google-chrome", "chromium", "chromium-browser", "chrome"]) {
    try {
      const p = execFileSync(process.platform === "win32" ? "where" : "which", [name], { stdio: ["ignore", "pipe", "ignore"] }).toString().trim().split("\n")[0];
      if (p && fs.existsSync(p)) return p;
    } catch {}
  }
  return null;
}

// Renders card.html to a PNG with the machine's own Chrome. No dependency,
// and a real capture of the real page rather than a drawn imitation.
export function exportPng(htmlPath, pngPath, { width = 640, height = 420, chrome = findChrome() } = {}) {
  if (!chrome) return null;
  execFileSync(chrome, ["--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${width},${height}`, "--virtual-time-budget=2000", `--screenshot=${pngPath}`, `file://${htmlPath}`], { stdio: "ignore", timeout: 30000 });
  return fs.existsSync(pngPath) ? pngPath : null;
}
