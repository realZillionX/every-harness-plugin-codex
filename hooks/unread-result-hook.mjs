#!/usr/bin/env node

import fs from "node:fs";
import { parseHookInput, handleUnreadResult } from "../scripts/lib/runtime/hooks.mjs";

const input = parseHookInput(fs.readFileSync(0, "utf8"));
const cwd = input.cwd ?? process.cwd();
process.stdout.write(`${JSON.stringify(handleUnreadResult(input, { cwd }))}\n`);
