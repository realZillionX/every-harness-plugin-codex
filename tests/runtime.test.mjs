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
  resolveDataRoot,
  transitionJob,
  withJobStoreLock,
} from "../scripts/lib/runtime/job-store.mjs";
import { handleCancel, handleRun, handleStatus, runJob } from "../scripts/lib/runtime/mailbox-runtime.mjs";
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

async function waitForJob(cwd, env, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const job = listJobs(cwd, env).find(predicate);
    if (job) return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("Timed out waiting for matching job.");
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
  const env = { EVERY_HARNESS_DATA: path.join(cwd, "every-harness-data") };
  const job = createJob(cwd, {
    id: "job-test",
    harnessId: "fake",
    status: "running",
    phase: "tool",
    summary: "Authorization: Bearer abcdef123456",
    progress: "api_key=sk-testsecret123456",
    errorMessage: "TOKEN=visible-token",
    result: { finalText: "password: hunter2" },
    request: { prompt: "secret" },
    providerMetadata: { token: "secret" },
    processRef: { pid: 123 },
  }, env);

  assert.equal(resolveDataRoot(env), env.EVERY_HARNESS_DATA);
  assert.equal(readJob(cwd, job.id, env).status, "running");
  assert.equal(listJobs(cwd, env).length, 1);
  assert.deepEqual(sanitizePublic(job).request, undefined);
  assert.deepEqual(publicJobPayload(job), {
    harnessId: "fake",
    status: "running",
    phase: "tool",
    summary: "Authorization: [REDACTED]",
    progress: "api_key=[REDACTED]",
    errorMessage: "TOKEN=[REDACTED]",
    result: { finalText: "password: [REDACTED]" },
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: null,
  });
});

test("job store lock serializes active job creation checks", async () => {
  const cwd = makeTempWorkspace();
  const env = { EVERY_HARNESS_DATA: path.join(cwd, "every-harness-data") };
  const events = [];

  await Promise.all([
    withJobStoreLock(cwd, env, async () => {
      events.push("first:start");
      await new Promise((resolve) => setTimeout(resolve, 30));
      events.push("first:end");
    }, { name: "unit" }),
    withJobStoreLock(cwd, env, async () => {
      events.push("second:start");
      events.push("second:end");
    }, { name: "unit" }),
  ]);

  assert.deepEqual(events, [
    "first:start",
    "first:end",
    "second:start",
    "second:end",
  ]);
});

test("mailbox runtime runs, reports, and cancels fake jobs", async () => {
  const cwd = makeTempWorkspace();
  const env = {
    ...process.env,
    CODEX_HOME: path.join(cwd, "codex-home"),
    EVERY_HARNESS_DATA: path.join(cwd, "every-harness-data"),
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

  const aliasStatus = await captureStdout(() =>
    handleStatus(["--cwd", cwd, "--harness", "mock", "--json"], env),
  );
  assert.equal(JSON.parse(aliasStatus.text).jobs.length, 1);

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

test("queued cancellation prevents a worker from executing the job", async () => {
  const cwd = makeTempWorkspace();
  const env = {
    ...process.env,
    EVERY_HARNESS_DATA: path.join(cwd, "every-harness-data"),
  };
  const job = createJob(cwd, {
    id: "cancelled-before-worker",
    harnessId: "fake",
    status: "queued",
    phase: "queued",
  }, env);
  transitionJob(cwd, job.id, ["queued"], "cancelled", {
    phase: "cancelled",
    summary: "Cancelled before start.",
  }, env);

  let executed = false;
  const result = await runJob(cwd, job, {
    id: "fake",
    displayName: "Fake Harness",
    async runTurn() {
      executed = true;
      return { finalText: "should not run" };
    },
  }, { prompt: "do not run" }, env);

  assert.equal(executed, false);
  assert.equal(result.job.status, "cancelled");
  assert.equal(readJob(cwd, job.id, env).status, "cancelled");
});

test("background worker can read jobs when EVERY_HARNESS_DATA is relative", async () => {
  const invocationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "every-harness-launcher-"));
  const cwd = makeTempWorkspace();
  const previousCwd = process.cwd();
  try {
    process.chdir(invocationRoot);
    const env = {
      ...process.env,
      EVERY_HARNESS_DATA: "mailbox",
    };
    clearAdapters();
    registerAdapter(createFakeAdapter());

    const run = await captureStdout(() =>
      handleRun(["--cwd", cwd, "--harness", "fake", "--background", "--json", "relative data"], env),
    );
    assert.equal(JSON.parse(run.text).status, "running");

    const completed = await waitForJob(cwd, env, (job) =>
      job.harnessId === "fake" && job.status === "completed",
    );
    assert.match(completed.result.finalText, /relative data/);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(invocationRoot, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test("cancel failures are persisted instead of leaving jobs active", async () => {
  const cwd = makeTempWorkspace();
  const env = {
    ...process.env,
    EVERY_HARNESS_DATA: path.join(cwd, "every-harness-data"),
  };
  clearAdapters();
  registerAdapter({
    id: "throw-cancel",
    displayName: "Throw Cancel Harness",
    async runTurn() {
      return { finalText: "unused" };
    },
    async cancel() {
      throw new Error("cancel transport failed");
    },
  });
  createJob(cwd, {
    id: "running-cancel",
    harnessId: "throw-cancel",
    status: "running",
    phase: "responding",
    processRef: { pid: 123 },
  }, env);

  const cancel = await captureStdout(() =>
    handleCancel(["--cwd", cwd, "--harness", "throw-cancel", "--json"], env),
  );
  const payload = JSON.parse(cancel.text);
  assert.equal(payload.job.status, "cancel_failed");
  assert.match(payload.job.summary, /cancel transport failed/);
  assert.equal(readJob(cwd, "running-cancel", env).status, "cancel_failed");
});

test("status wait times out with an error when jobs remain active", async () => {
  const cwd = makeTempWorkspace();
  const env = {
    ...process.env,
    EVERY_HARNESS_DATA: path.join(cwd, "every-harness-data"),
  };
  clearAdapters();
  registerAdapter(createFakeAdapter());
  createJob(cwd, {
    id: "still-running",
    harnessId: "fake",
    status: "running",
    phase: "responding",
  }, env);

  await assert.rejects(
    () => handleStatus([
      "--cwd",
      cwd,
      "--harness",
      "fake",
      "--wait",
      "--timeout-ms",
      "1",
      "--poll-interval-ms",
      "1",
    ], env),
    /Timed out waiting/,
  );
});

test("mailbox runtime preserves resolved adapter failure status", async () => {
  const cwd = makeTempWorkspace();
  const env = {
    ...process.env,
    EVERY_HARNESS_DATA: path.join(cwd, "every-harness-data"),
  };
  clearAdapters();
  registerAdapter({
    id: "soft-fail",
    displayName: "Soft Fail Harness",
    async runTurn() {
      return {
        status: "failed",
        exitCode: 7,
        finalText: "partial output",
        stderr: "bad credentials\n",
      };
    },
    async cancel() {
      return { cancelled: true };
    },
  });

  const run = await captureStdout(() =>
    handleRun(["--cwd", cwd, "--harness", "soft-fail", "--json", "do work"], env),
  );

  const payload = JSON.parse(run.text);
  assert.equal(payload.status, "failed");
  assert.equal(payload.job.status, "failed");
  assert.match(payload.job.errorMessage, /bad credentials/);
  assert.equal(payload.job.result.finalText, "partial output");
});
