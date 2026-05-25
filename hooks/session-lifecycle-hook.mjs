#!/usr/bin/env node

import fs from "node:fs";
import { parseHookInput, handleSessionEnd, handleSessionStart } from "../scripts/lib/runtime/hooks.mjs";

const eventName = process.argv[2] ?? "SessionStart";
const input = parseHookInput(fs.readFileSync(0, "utf8"));
const cwd = input.cwd ?? process.cwd();
const result = eventName === "SessionEnd"
  ? handleSessionEnd(input, { cwd })
  : handleSessionStart(input, { cwd });

process.stdout.write(`${JSON.stringify(result)}\n`);
