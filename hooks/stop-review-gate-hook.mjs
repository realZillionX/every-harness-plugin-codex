#!/usr/bin/env node

import fs from "node:fs";
import { parseHookInput, handleStopReview } from "../scripts/lib/runtime/hooks.mjs";

const input = parseHookInput(fs.readFileSync(0, "utf8"));
const cwd = input.cwd ?? process.cwd();
const result = await handleStopReview(input, { cwd, adapters: [] });
process.stdout.write(`${JSON.stringify(result)}\n`);
