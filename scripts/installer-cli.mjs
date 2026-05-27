#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.argv[2] ?? "install";

if (!["install", "update", "uninstall"].includes(command)) {
  process.stderr.write("Usage: every-harness-plugin-codex <install|update|uninstall>\n");
  process.exit(1);
}

if (command === "uninstall") {
  process.stdout.write("Manual uninstall is not implemented yet. Remove the plugin from your Codex plugin directory.\n");
  process.exit(0);
}

const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", "local-plugin-install.mjs"), "install"], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
