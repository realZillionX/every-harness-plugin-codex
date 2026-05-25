#!/usr/bin/env node

import { registerAdapter } from "./lib/adapters/registry.mjs";
import { fakeAdapter } from "./lib/adapters/fake.mjs";
import { createBuiltinAcpAdapters, createPlannedHarnessAdapters } from "./lib/adapters/builtin-harnesses.mjs";
import { handleCancel, handleRun, handleSetup, handleStatus, handleWorker } from "./lib/runtime/mailbox-runtime.mjs";

async function registerBuiltInAdapters() {
  registerAdapter(fakeAdapter);
  for (const adapter of createBuiltinAcpAdapters()) {
    registerAdapter(adapter, adapter.aliases ?? []);
  }
  for (const adapter of createPlannedHarnessAdapters()) {
    registerAdapter(adapter, adapter.aliases ?? []);
  }
  for (const modulePath of ["./lib/adapters/gemini-acp.mjs", "./lib/adapters/claude-cli.mjs"]) {
    try {
      const mod = await import(modulePath);
      const factory = mod.createGeminiAcpAdapter ?? mod.createClaudeCliAdapter;
      if (factory) {
        const adapter = factory();
        registerAdapter(adapter, adapter.aliases ?? []);
      }
    } catch {
      // Optional adapter file may not exist during early development.
    }
  }
}

async function main() {
  await registerBuiltInAdapters();
  const [command, ...argv] = process.argv.slice(2);
  try {
    switch (command) {
      case "setup":
        await handleSetup(argv);
        break;
      case "run":
        await handleRun(argv);
        break;
      case "status":
        await handleStatus(argv);
        break;
      case "cancel":
        await handleCancel(argv);
        break;
      case "worker":
        await handleWorker(argv);
        break;
      default:
        throw new Error("Usage: every-harness-companion.mjs <setup|run|status|cancel|worker> [args]");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

await main();
