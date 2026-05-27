#!/usr/bin/env node

import fs from "node:fs";
import { parseHookInput, handleSessionStart } from "../scripts/lib/runtime/hooks.mjs";

const input = parseHookInput(fs.readFileSync(0, "utf8"));
const cwd = input.cwd ?? process.cwd();
const result = handleSessionStart(input, { cwd });

process.stdout.write(`${JSON.stringify(result)}\n`);
