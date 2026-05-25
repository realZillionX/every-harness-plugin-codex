#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installCodexHooks } from "./lib/runtime/hook-install.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(SCRIPT_DIR, "..");

function main() {
  const result = installCodexHooks(PLUGIN_ROOT, process.env);
  process.stdout.write(`Every Harness hooks installed into ${result.hooksFile}.\n`);
  process.stdout.write(`Codex hook feature is enabled in ${result.configFile} with [features].hooks.\n`);
  process.stdout.write(`Installed events: ${result.installedEvents.join(", ")}.\n`);
}

fs.statSync(path.join(PLUGIN_ROOT, "hooks", "hooks.json"));
main();
