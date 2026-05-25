import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureCodexHooksEnabled } from "./codex-config.mjs";

export function resolveCodexHome(env = process.env) {
  return env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export function resolveHookInstallPaths(pluginRoot, env = process.env) {
  const codexHome = resolveCodexHome(env);
  return {
    codexHome,
    configFile: path.join(codexHome, "config.toml"),
    codexHooksFile: path.join(codexHome, "hooks.json"),
    pluginHooksFile: path.join(pluginRoot, "hooks", "hooks.json"),
  };
}

export function resolvePluginHooks(pluginRoot) {
  const hooksFile = path.join(pluginRoot, "hooks", "hooks.json");
  const payload = JSON.parse(fs.readFileSync(hooksFile, "utf8"));
  return replacePluginRoot(payload, pluginRoot);
}

export function inspectCodexHookSetup(pluginRoot, env = process.env) {
  const paths = resolveHookInstallPaths(pluginRoot, env);
  const configText = fs.existsSync(paths.configFile) ? fs.readFileSync(paths.configFile, "utf8") : "";
  const featureEnabled = !ensureCodexHooksEnabled(configText).changed;
  const pluginHooks = resolvePluginHooks(pluginRoot);
  const installedHooks = readJson(paths.codexHooksFile, { hooks: {} });
  const missing = [];

  for (const eventName of Object.keys(pluginHooks.hooks ?? {})) {
    const expectedCommands = commandsForEntries(pluginHooks.hooks[eventName]);
    const installedCommands = new Set(commandsForEntries(installedHooks.hooks?.[eventName] ?? []));
    for (const command of expectedCommands) {
      if (!installedCommands.has(command)) {
        missing.push({ eventName, command });
      }
    }
  }

  return {
    enabled: featureEnabled && missing.length === 0,
    featureEnabled,
    hooksFile: paths.codexHooksFile,
    missingCount: missing.length,
    detail: featureEnabled
      ? missing.length === 0
        ? "Every Harness hooks are installed and [features].hooks is enabled."
        : `Every Harness hooks are missing ${missing.length} command(s). Run install-hooks.mjs.`
      : "Codex hook feature is not enabled. Run install-hooks.mjs.",
  };
}

export function installCodexHooks(pluginRoot, env = process.env) {
  const paths = resolveHookInstallPaths(pluginRoot, env);
  fs.mkdirSync(paths.codexHome, { recursive: true });

  const existingConfig = fs.existsSync(paths.configFile) ? fs.readFileSync(paths.configFile, "utf8") : "";
  const configUpdate = ensureCodexHooksEnabled(existingConfig);
  if (configUpdate.changed || !fs.existsSync(paths.configFile)) {
    fs.writeFileSync(paths.configFile, configUpdate.content, "utf8");
  }

  const pluginHooks = resolvePluginHooks(pluginRoot);
  const existingHooks = readJson(paths.codexHooksFile, { hooks: {} });
  const merged = mergeHookPayload(existingHooks, pluginHooks);
  fs.writeFileSync(paths.codexHooksFile, `${JSON.stringify(merged, null, 2)}\n`, "utf8");

  return {
    configChanged: configUpdate.changed || !fs.existsSync(paths.configFile),
    hooksFile: paths.codexHooksFile,
    configFile: paths.configFile,
    installedEvents: Object.keys(pluginHooks.hooks ?? {}),
  };
}

export function mergeHookPayload(existingPayload, pluginPayload) {
  const merged = {
    ...existingPayload,
    hooks: { ...(existingPayload.hooks ?? {}) },
  };

  for (const [eventName, pluginEntries] of Object.entries(pluginPayload.hooks ?? {})) {
    const existingEntries = Array.isArray(merged.hooks[eventName]) ? merged.hooks[eventName] : [];
    merged.hooks[eventName] = [
      ...existingEntries.filter((entry) => !isEveryHarnessHookEntry(entry)),
      ...pluginEntries,
    ];
  }

  return merged;
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function replacePluginRoot(value, pluginRoot) {
  if (Array.isArray(value)) return value.map((item) => replacePluginRoot(item, pluginRoot));
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? value.replace(/\$PLUGIN_ROOT/g, pluginRoot) : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, replacePluginRoot(nested, pluginRoot)]),
  );
}

function commandsForEntries(entries) {
  const commands = [];
  for (const entry of entries ?? []) {
    for (const hook of entry.hooks ?? []) {
      if (hook.command) commands.push(hook.command);
    }
  }
  return commands;
}

function isEveryHarnessHookEntry(entry) {
  const text = JSON.stringify(entry);
  return text.includes("Every Harness") || text.includes("every-harness");
}
