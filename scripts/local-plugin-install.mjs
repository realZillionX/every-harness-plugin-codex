#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOME = process.env.HOME || os.homedir();
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex");
const MARKETPLACE_FILE = process.env.EVERY_HARNESS_MARKETPLACE_FILE || path.join(HOME, ".agents", "plugins", "marketplace.json");
const INSTALL_ROOT = path.join(CODEX_HOME, "plugins", "every-harness");

function copyDir(source, destination) {
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, {
    recursive: true,
    filter: (file) => !file.includes(`${path.sep}.git${path.sep}`) && !file.endsWith(`${path.sep}.git`),
  });
}

function upsertMarketplace() {
  fs.mkdirSync(path.dirname(MARKETPLACE_FILE), { recursive: true });
  const marketplace = fs.existsSync(MARKETPLACE_FILE)
    ? JSON.parse(fs.readFileSync(MARKETPLACE_FILE, "utf8"))
    : { name: "local-plugins", interface: { displayName: "Local Plugins" }, plugins: [] };
  marketplace.plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  const entry = {
    name: "every-harness",
    source: { source: "local", path: "./.codex/plugins/every-harness" },
    policy: { installation: "AVAILABLE", authentication: "ON_USE" },
    category: "Coding",
  };
  const existing = marketplace.plugins.findIndex((plugin) => plugin?.name === "every-harness");
  if (existing >= 0) marketplace.plugins.splice(existing, 1, entry);
  else marketplace.plugins.push(entry);
  fs.writeFileSync(MARKETPLACE_FILE, `${JSON.stringify(marketplace, null, 2)}\n`, "utf8");
}

function main() {
  const command = process.argv[2] ?? "install";
  if (command !== "install") {
    throw new Error("Only install is implemented.");
  }
  copyDir(ROOT, INSTALL_ROOT);
  upsertMarketplace();
  spawnSync(process.execPath, [path.join(INSTALL_ROOT, "scripts", "install-hooks.mjs")], { stdio: "inherit" });
  process.stdout.write(`Installed every-harness to ${INSTALL_ROOT}\n`);
}

main();
