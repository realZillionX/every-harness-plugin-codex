#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "every-harness-smoke-"));
const env = { ...process.env, PLUGIN_DATA: path.join(tmp, "plugin-data") };

function run(args) {
  const result = spawnSync(process.execPath, ["scripts/ehplugin.mjs", ...args], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

run(["run", "--harness", "fake", "--json", "smoke foreground"]);
run(["run", "--harness", "fake", "--background", "smoke background"]);
run(["status", "--harness", "fake", "--wait", "--json", "--timeout-ms", "5000", "--poll-interval-ms", "100"]);
run(["cancel", "--harness", "fake"]);

process.stdout.write("Fake smoke passed.\n");
