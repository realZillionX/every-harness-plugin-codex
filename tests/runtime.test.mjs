import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFakeAdapter } from "../scripts/lib/adapters/fake.mjs";
import { clearAdapters, registerAdapter } from "../scripts/lib/adapters/registry.mjs";
import { parseCommandArgs, splitRawArgumentString } from "../scripts/lib/runtime/args.mjs";
import {
  createJob,
  listJobs,
  readJob,
  resolvePluginDataRoot,
} from "../scripts/lib/runtime/job-store.mjs";
import { handleCancel, handleRun, handleStatus } from "../scripts/lib/runtime/mailbox-runtime.mjs";
import { publicJobPayload, sanitizePublic } from "../scripts/lib/runtime/render.mjs";

function makeTempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "every-harness-test-"));
  fs.mkdirSync(path.join(root, ".git"));
  return root;
}

async function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  let text = "";
  process.stdout.write = (chunk, encoding, callback) => {
    text += String(chunk);
    if (typeof encoding === "function") encoding();
    if (typeof callback === "function") callback();
    return true;
  };
  try {
    const value = await fn();
    return { text, value };
  } finally {
    process.stdout.write = originalWrite;
  }
}

test("parses shell-like command arguments", () => {
  assert.deepEqual(
    splitRawArgumentString("--harness fake --model 'test model' do \"the task\""),
    ["--harness", "fake", "--model", "test model", "do", "the task"],
  );
  assert.deepEqual(parseCommandArgs(["--harness=fake", "--write", "hello"]), {
    options: { harness: "fake", write: true },
    positionals: ["hello"],
  });
  assert.throws(() => splitRawArgumentString("'unterminated"), /Unterminated/);
  assert.throws(() => parseCommandArgs(["--unknown"]), /Unknown option/);
});

test("job state is workspace-scoped and public payloads are sanitized", () => {
  const cwd = makeTempWorkspace();
  const env = { PLUGIN_DATA: path.join(cwd, "plugin-data") };
  const job = createJob(cwd, {
    id: "job-test",
    harnessId: "fake",
    status: "running",
    phase: "tool",
    request: { prompt: "secret" },
    providerMetadata: { token: "secret" },
    processRef: { pid: 123 },
  }, env);

  assert.equal(resolvePluginDataRoot(env), env.PLUGIN_DATA);
  assert.equal(readJob(cwd, job.id, env).status, "running");
  assert.equal(listJobs(cwd, env).length, 1);
  assert.deepEqual(sanitizePublic(job).request, undefined);
  assert.deepEqual(publicJobPayload(job), {
    harnessId: "fake",
    status: "running",
    phase: "tool",
    summary: null,
    progress: null,
    errorMessage: null,
    result: null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: null,
  });
});

test("mailbox runtime runs, reports, and cancels fake jobs", async () => {
  const cwd = makeTempWorkspace();
  const env = {
    ...process.env,
    CODEX_HOME: path.join(cwd, "codex-home"),
    PLUGIN_DATA: path.join(cwd, "plugin-data"),
  };
  clearAdapters();
  registerAdapter(createFakeAdapter({ aliases: ["mock"] }));

  const foreground = await captureStdout(() =>
    handleRun(["--cwd", cwd, "--harness", "fake", "--json", "hello world"], env),
  );
  const foregroundPayload = JSON.parse(foreground.text);
  assert.equal(foregroundPayload.status, "completed");
  assert.equal(foregroundPayload.job.result.finalText, "Fake result: hello world");
  assert.equal(foregroundPayload.job.processRef, undefined);
  assert.equal(foregroundPayload.job.providerMetadata, undefined);

  const status = await captureStdout(() =>
    handleStatus(["--cwd", cwd, "--harness", "fake", "--json"], env),
  );
  assert.equal(JSON.parse(status.text).jobs.length, 1);

  const queued = createJob(cwd, {
    id: "manual-queued",
    harnessId: "fake",
    status: "queued",
    phase: "queued",
  }, env);
  const cancel = await captureStdout(() =>
    handleCancel(["--cwd", cwd, "--harness", "fake", "--json"], env),
  );
  assert.equal(JSON.parse(cancel.text).job.status, "cancelled");
  assert.equal(readJob(cwd, queued.id, env).status, "cancelled");
});
