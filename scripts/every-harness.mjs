#!/usr/bin/env node

import { registerAdapter } from "./lib/adapters/registry.mjs";
import { fakeAdapter } from "./lib/adapters/fake.mjs";
import { createBuiltinHarnessAdapters } from "./lib/adapters/builtin-harnesses.mjs";
import { handleCancel, handleRun, handleStatus, handleWorker } from "./lib/runtime/mailbox-runtime.mjs";

const HELP = `Usage: every-harness <command> [args]

Commands:
  run       Delegate a scoped task to a harness
  status    Inspect mailbox jobs
  cancel    Cancel active delegated work

Run "every-harness <command> --help" for command-specific options.
`;

const RUN_HELP = `Usage: every-harness run --harness <id> [options] <task>

Options:
  --harness <id>           Target harness
  --background             Run asynchronously
  --write                  Allow file edits
  --read-only              Restrict the task to read-only work
  --model <model>          Override model selection
  --effort <effort>        Set effort level
  --prompt-file <path>     Load task text from a file
  --cwd <path>             Run against a specific workspace
  --json                   Emit JSON
`;

const STATUS_HELP = `Usage: every-harness status [options]

Options:
  --harness <id>           Filter by harness
  --all                    Show terminal jobs as well as active jobs
  --wait                   Wait until matching active jobs finish
  --timeout-ms <ms>        Wait timeout
  --poll-interval-ms <ms>  Wait polling interval
  --cwd <path>             Inspect a specific workspace
  --json                   Emit JSON
`;

const CANCEL_HELP = `Usage: every-harness cancel [options]

Options:
  --harness <id>           Cancel jobs for a specific harness
  --cwd <path>             Cancel work in a specific workspace
  --json                   Emit JSON
`;

async function registerBuiltInAdapters() {
  registerAdapter(fakeAdapter);
  for (const adapter of createBuiltinHarnessAdapters()) {
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

function wantsHelp(command, argv) {
  return command === "--help" || command === "-h" || argv.includes("--help") || argv.includes("-h");
}

function printHelp(command) {
  switch (command) {
    case "run":
      process.stdout.write(RUN_HELP);
      return true;
    case "status":
      process.stdout.write(STATUS_HELP);
      return true;
    case "cancel":
      process.stdout.write(CANCEL_HELP);
      return true;
    case undefined:
    case "--help":
    case "-h":
      process.stdout.write(HELP);
      return true;
    default:
      return false;
  }
}

async function main() {
  await registerBuiltInAdapters();
  const [command, ...argv] = process.argv.slice(2);
  if (wantsHelp(command, argv)) {
    if (printHelp(command)) return;
  }
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
        throw new Error("Usage: every-harness <run|status|cancel> [args]");
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

await main();
