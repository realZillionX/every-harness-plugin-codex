#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOME = process.env.HOME || os.homedir();
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex");
const MARKETPLACE_FILE = process.env.EVERY_HARNESS_MARKETPLACE_FILE || path.join(HOME, ".agents", "plugins", "marketplace.json");
const INSTALL_ROOT = path.join(CODEX_HOME, "plugins", "every-harness");
const USER_BIN_DIR = process.env.EVERY_HARNESS_BIN_DIR || path.join(HOME, ".local", "bin");
const USER_BIN = path.join(USER_BIN_DIR, "ehplugin");
const HOOKS_FILE = path.join(CODEX_HOME, "hooks.json");
const LEGACY_HOOK_MARKERS = [
  "every-harness",
  "session-lifecycle-hook.mjs",
  "unread-result-hook.mjs",
  "stop-review-gate-hook.mjs",
];

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

function installCliShim() {
  fs.mkdirSync(USER_BIN_DIR, { recursive: true });
  const target = path.join(INSTALL_ROOT, "scripts", "ehplugin.mjs");
  try {
    const stat = fs.lstatSync(USER_BIN);
    if (!stat.isSymbolicLink() || fs.readlinkSync(USER_BIN) !== target) {
      throw new Error(`${USER_BIN} already exists and is not managed by this installer.`);
    }
    fs.rmSync(USER_BIN);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  fs.symlinkSync(target, USER_BIN);
}

function isLegacyEveryHarnessHook(hook) {
  const text = JSON.stringify(hook ?? {});
  return LEGACY_HOOK_MARKERS.some((marker) => text.includes(marker));
}

function removeLegacyHooks() {
  if (!fs.existsSync(HOOKS_FILE)) return false;
  const config = JSON.parse(fs.readFileSync(HOOKS_FILE, "utf8"));
  if (!config?.hooks || typeof config.hooks !== "object") return false;
  let changed = false;
  for (const [eventName, entries] of Object.entries(config.hooks)) {
    if (!Array.isArray(entries)) continue;
    const nextEntries = [];
    for (const entry of entries) {
      const hookList = Array.isArray(entry?.hooks) ? entry.hooks : [];
      const nextHooks = hookList.filter((hook) => !isLegacyEveryHarnessHook(hook));
      if (nextHooks.length !== hookList.length) changed = true;
      if (nextHooks.length > 0) nextEntries.push({ ...entry, hooks: nextHooks });
    }
    if (nextEntries.length > 0) config.hooks[eventName] = nextEntries;
    else {
      delete config.hooks[eventName];
      if (entries.length > 0) changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(HOOKS_FILE, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }
  return changed;
}

function removeLegacyHookFiles() {
  fs.rmSync(path.join(INSTALL_ROOT, "hooks"), { recursive: true, force: true });
}

function main() {
  const command = process.argv[2] ?? "install";
  if (command !== "install") {
    throw new Error("Only install is implemented.");
  }
  copyDir(ROOT, INSTALL_ROOT);
  removeLegacyHookFiles();
  installCliShim();
  const removedLegacyHooks = removeLegacyHooks();
  upsertMarketplace();
  process.stdout.write(`Installed every-harness to ${INSTALL_ROOT}\n`);
  process.stdout.write(`Installed ehplugin CLI to ${USER_BIN}\n`);
  if (removedLegacyHooks) {
    process.stdout.write("Removed legacy every-harness hook entries\n");
  }
}

main();
