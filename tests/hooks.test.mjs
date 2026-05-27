import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { fakeAdapter } from "../scripts/lib/adapters/fake.mjs";
import {
  createJob,
  getCurrentSession,
  readJob,
  writeConfig,
} from "../scripts/lib/runtime/job-store.mjs";
import {
  handleSessionStart,
  handleStopReview,
  handleUnreadResult,
  parseHookInput,
} from "../scripts/lib/runtime/hooks.mjs";

const SUPPORTED_CODEX_HOOK_EVENTS = new Set([
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "PreCompact",
  "PostCompact",
  "SessionStart",
  "UserPromptSubmit",
  "SubagentStart",
  "SubagentStop",
  "Stop",
]);

function makeTempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "every-harness-hooks-"));
  fs.mkdirSync(path.join(root, ".git"));
  return root;
}

test("session start hook tracks current session", () => {
  const cwd = makeTempWorkspace();
  const env = { PLUGIN_DATA: path.join(cwd, "plugin-data") };

  const start = handleSessionStart({ session_id: "session/one" }, { cwd, env });
  assert.equal(start.continue, true);
  assert.equal(getCurrentSession(cwd, env), "session_one");
});

test("unread result hook marks terminal jobs viewed", () => {
  const cwd = makeTempWorkspace();
  const env = { PLUGIN_DATA: path.join(cwd, "plugin-data") };
  const job = createJob(cwd, {
    id: "completed-job",
    harnessId: "fake",
    status: "completed",
    viewed: false,
  }, env);

  const result = handleUnreadResult({}, { cwd, env });
  assert.equal(result.continue, true);
  assert.match(result.hookSpecificOutput.additionalContext, /1 unread background result/);
  assert.equal(readJob(cwd, job.id, env).viewed, true);
  assert.equal(handleUnreadResult({}, { cwd, env }).suppressOutput, true);
});

test("stop review hook only blocks when review-capable adapter says BLOCK", async () => {
  const cwd = makeTempWorkspace();
  const env = { PLUGIN_DATA: path.join(cwd, "plugin-data") };

  assert.deepEqual(await handleStopReview({}, { cwd, env, adapters: [fakeAdapter] }), {
    continue: true,
    suppressOutput: true,
  });

  writeConfig(cwd, { stopReviewGate: true }, env);
  assert.deepEqual(
    await handleStopReview({ last_assistant_message: "looks fine" }, { cwd, env, adapters: [fakeAdapter] }),
    { continue: true, suppressOutput: true },
  );
  assert.equal(
    (await handleStopReview({ last_assistant_message: "BLOCK this" }, { cwd, env, adapters: [fakeAdapter] })).decision,
    "block",
  );
});

test("parseHookInput accepts empty and JSON input", () => {
  assert.deepEqual(parseHookInput(""), {});
  assert.deepEqual(parseHookInput("{\"cwd\":\"/tmp\"}\n"), { cwd: "/tmp" });
});

test("bundled hooks only use Codex-supported event names", () => {
  const hooksPath = new URL("../hooks/hooks.json", import.meta.url);
  const hooksFile = JSON.parse(fs.readFileSync(hooksPath, "utf8"));
  const unsupported = Object.keys(hooksFile.hooks ?? {})
    .filter((eventName) => !SUPPORTED_CODEX_HOOK_EVENTS.has(eventName));

  assert.deepEqual(unsupported, []);
});
