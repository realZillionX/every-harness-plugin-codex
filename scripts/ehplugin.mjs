#!/usr/bin/env node

import { registerAdapter } from "./lib/adapters/registry.mjs";
import { fakeAdapter } from "./lib/adapters/fake.mjs";
import { createBuiltinHarnessAdapters, createPlannedHarnessAdapters } from "./lib/adapters/builtin-harnesses.mjs";
import { handleCancel, handleRun, handleStatus, handleWorker } from "./lib/runtime/mailbox-runtime.mjs";

async function registerBuiltInAdapters() {
  registerAdapter(fakeAdapter);
  for (const adapter of createBuiltinHarnessAdapters()) {
    registerAdapter(adapter, adapter.aliases ?? []);
  }
  for (const adapter of createPlannedHarnessAdapters()) {
    registerAdapter(adapter, adapter.aliases ?? []);
  }
  try {
    const { createClaudeCodeAdapter } = await import("./lib/adapters/claude-code.mjs");
    const adapter = createClaudeCodeAdapter();
    registerAdapter(adapter, adapter.aliases ?? []);
  } catch {
    // Optional adapter files may be absent in minimal builds.
  }
}

async function main() {
  await registerBuiltInAdapters();
  const [command, ...argv] = process.argv.slice(2);
  try {
    switch (command) {
      case "run":
        await handleRun(argv);
        break;
      case "status":
        await handleStatus(argv);
        break;
      case "cancel":
        await handleCancel(argv);
        break;
      case "__worker":
        await handleWorker(argv);
        break;
      default:
        throw new Error("Usage: ehplugin <run|status|cancel> [args]");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

await main();
