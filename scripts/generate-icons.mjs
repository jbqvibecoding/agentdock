// Desktop icon exports only. Source artwork stays replaceable in assets/brand.
import { mkdtempSync, copyFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "node_modules/@tauri-apps/cli/tauri.js");
const output = join(root, "src-tauri/icons");
const temporary = mkdtempSync(join(tmpdir(), "agentdock-icons-"));
const run = (args) => execFileSync(process.execPath, [cli, "icon", ...args], { stdio: "inherit", cwd: root });
try {
  const app = join(temporary, "app");
  run([join(root, "assets/brand/AgentDock-1024.png"), "--output", app]);
  for (const file of readdirSync(app)) {
    if (/\.(png|ico|icns)$/.test(file)) copyFileSync(join(app, file), join(output, file));
  }
  const tray = join(temporary, "tray");
  run([join(root, "assets/brand/tray-symbol.svg"), "--output", tray, "--png", "44"]);
  copyFileSync(join(tray, "44x44.png"), join(output, "tray-template.png"));
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
