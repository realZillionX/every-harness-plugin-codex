import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseCommandArgs } from "./args.mjs";
import {
  ACTIVE_JOB_STATUSES,
  TERMINAL_JOB_STATUSES,
  cleanupOldJobs,
  createJob,
  findActiveJob,
  listJobs,
  patchJob,
  readJob,
  resolveJobLogFile,
  transitionJob,
  withJobStoreLock,
} from "./job-store.mjs";
import { publicJobPayload, renderJson, renderMailboxJob, renderStatus } from "./render.mjs";
import { resolveHarnessSelection } from "../adapters/registry.mjs";

const THIS_FILE = fileURLToPath(import.meta.url);
const PACKAGE_ROOT = path.resolve(path.dirname(THIS_FILE), "..", "..", "..");
const EVERY_HARNESS_PATH = path.join(PACKAGE_ROOT, "scripts", "every-harness.mjs");
const DEFAULT_WAIT_TIMEOUT_MS = 240_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

function normalizeRuntimeEnv(env = process.env) {
  const normalized = { ...env };
  if (normalized.EVERY_HARNESS_DATA) {
    normalized.EVERY_HARNESS_DATA = path.resolve(process.cwd(), normalized.EVERY_HARNESS_DATA);
  }
  return normalized;
}

function resolveCwd(options = {}) {
  return options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd();
}

function output(value, asJson) {
  process.stdout.write(asJson ? renderJson(value) : value);
}

function readPrompt(cwd, options, positionals) {
  const chunks = [];
  if (options["prompt-file"]) {
    chunks.push(fs.readFileSync(path.resolve(cwd, options["prompt-file"]), "utf8"));
  }
  if (positionals.length) {
    chunks.push(positionals.join(" "));
  }
  if (!process.stdin.isTTY) {
    try {
      const piped = fs.readFileSync(0, "utf8");
      if (piped.trim()) chunks.push(piped);
    } catch {}
  }
  return chunks.join("\n").trim();
}

function createProgressUpdater(cwd, jobId, env) {
  return (event) => {
    const patch = {};
    if (event?.phase) patch.phase = event.phase;
    if (event?.message) patch.progress = event.message;
    if (event?.threadId) patch.threadId = event.threadId;
    if (event?.turnId) patch.turnId = event.turnId;
    if (event?.touchedFiles?.length) patch.touchedFiles = event.touchedFiles;
    if (Object.keys(patch).length) patchJob(cwd, jobId, patch, env);
  };
}

function createSpawnUpdater(cwd, jobId, env) {
  return ({ pid, pidIdentity = null, metadata = {} } = {}) => {
    if (!Number.isFinite(Number(pid))) return;
    patchJob(cwd, jobId, {
      processRef: { pid: Number(pid), pidIdentity },
      providerMetadata: { ...(readJob(cwd, jobId, env)?.providerMetadata ?? {}), ...metadata },
    }, env);
  };
}

function buildRunRequest({ cwd, adapter, options, prompt, job }) {
  return {
    cwd,
    harnessId: adapter.id,
    prompt,
    mode: options.write ? "write" : "read",
    model: adapter.normalizeModel?.(options.model),
    effort: adapter.normalizeEffort?.(options.effort) ?? options.effort ?? null,
    ownerSessionId: job.ownerSessionId ?? null,
    jobId: job.id,
  };
}

function firstResultLine(text, fallback) {
  const line = String(text ?? "").trim().split("\n").find(Boolean);
  return line ? line.slice(0, 200) : fallback;
}

function normalizeResultStatus(status) {
  const normalized = String(status ?? "").trim().toLowerCase();
  if (!normalized || normalized === "completed") return "completed";
  if (TERMINAL_RESULT_STATUSES.has(normalized)) return normalized;
  return "failed";
}

const TERMINAL_RESULT_STATUSES = new Set(["failed", "cancelled", "cancel_failed"]);

function resultFailureMessage(result, status) {
  const message =
    result.warning ??
    result.errorMessage ??
    result.error ??
    result.stderr ??
    (Number.isFinite(Number(result.exitCode)) ? `Harness exited with code ${result.exitCode}.` : null);
  return String(message ?? `Harness returned ${status}.`).trim();
}

export async function runJob(cwd, job, adapter, request, env = process.env) {
  const logFile = resolveJobLogFile(cwd, job.id, env);
  const started = transitionJob(cwd, job.id, ["queued", "running"], "running", {
    phase: "starting",
    logFile,
    request,
  }, env);
  if (!started.transitioned) {
    const current = started.job ?? readJob(cwd, job.id, env);
    if (current) {
      return {
        job: current,
        result: {
          status: current.status,
          finalText: "",
          warning: TERMINAL_JOB_STATUSES.has(current.status)
            ? `Job was already ${current.status}.`
            : `Job is not runnable from status ${current.status}.`,
        },
      };
    }
    throw new Error(`No job found for ${job.id}.`);
  }
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  if (!fs.existsSync(logFile)) fs.writeFileSync(logFile, "", "utf8");
  const onProgress = createProgressUpdater(cwd, job.id, env);
  const onSpawn = createSpawnUpdater(cwd, job.id, env);
  try {
    const result = await adapter.runTurn(request, { onProgress, onSpawn });
    const finalText = String(result.finalText ?? result.finalMessage ?? result.output ?? result.text ?? "").trim();
    const processRef = result.processRef ?? (Number.isFinite(Number(result.pid)) ? { pid: Number(result.pid), pidIdentity: result.pidIdentity ?? null } : null);
    const status = normalizeResultStatus(result.status);
    if (status !== "completed") {
      const transitioned = transitionJob(cwd, job.id, ["running"], status, {
        phase: status,
        summary: firstResultLine(finalText, resultFailureMessage(result, status)),
        errorMessage: resultFailureMessage(result, status),
        result: {
          finalText,
          structuredOutput: result.structuredOutput ?? null,
          touchedFiles: result.touchedFiles ?? [],
        },
        providerMetadata: result.providerMetadata ?? null,
        ...(processRef ? { processRef } : {}),
        threadId: result.sessionId ?? result.threadId ?? null,
      }, env);
      cleanupOldJobs(cwd, {}, env);
      return { job: transitioned.job ?? readJob(cwd, job.id, env), result };
    }
    const transitioned = transitionJob(cwd, job.id, ["running"], "completed", {
      phase: "done",
      summary: firstResultLine(finalText, "Completed."),
      result: {
        finalText,
        structuredOutput: result.structuredOutput ?? null,
        touchedFiles: result.touchedFiles ?? [],
      },
      providerMetadata: result.providerMetadata ?? null,
      ...(processRef ? { processRef } : {}),
      threadId: result.sessionId ?? result.threadId ?? null,
    }, env);
    cleanupOldJobs(cwd, {}, env);
    return { job: transitioned.job ?? readJob(cwd, job.id, env), result };
  } catch (error) {
    transitionJob(cwd, job.id, ["running"], "failed", {
      phase: "failed",
      errorMessage: error instanceof Error ? error.message : String(error),
    }, env);
    cleanupOldJobs(cwd, {}, env);
    throw error;
  }
}

function spawnWorker(cwd, jobId, env) {
  const child = spawn(process.execPath, [EVERY_HARNESS_PATH, "__worker", "--cwd", cwd, "--job-id", jobId], {
    cwd,
    env,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return child.pid;
}

async function waitForIdle(cwd, env, { harnessId = null, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS } = {}) {
  const deadline = Date.now() + Number(timeoutMs || DEFAULT_WAIT_TIMEOUT_MS);
  while (Date.now() <= deadline) {
    const active = listJobs(cwd, env).filter((job) =>
      ACTIVE_JOB_STATUSES.has(job.status) && (!harnessId || job.harnessId === harnessId)
    );
    if (active.length === 0) return { timedOut: false };
    await new Promise((resolve) => setTimeout(resolve, Number(pollIntervalMs || DEFAULT_POLL_INTERVAL_MS)));
  }
  return { timedOut: true };
}

export async function handleRun(argv, env = process.env) {
  env = normalizeRuntimeEnv(env);
  const { options, positionals } = parseCommandArgs(argv);
  if (options.background && options.wait) throw new Error("Choose either --background or --wait.");
  if (options.write && options["read-only"]) throw new Error("Choose either --write or --read-only.");
  const cwd = resolveCwd(options);
  const adapter = resolveHarnessSelection({ requestedHarness: options.harness });
  const prompt = readPrompt(cwd, options, positionals);
  if (!prompt) throw new Error("Provide task text or --prompt-file.");
  const ownerSessionId = options["owner-session-id"] ?? env.EVERY_HARNESS_SESSION_ID ?? null;
  let job;
  let request;
  await withJobStoreLock(cwd, env, () => {
    const active = findActiveJob(cwd, { harnessId: adapter.id, ownerSessionId }, env);
    if (active) throw new Error(`${adapter.displayName} already has active work in this session.`);
    job = createJob(cwd, {
      harnessId: adapter.id,
      ownerSessionId,
      mode: options.write ? "write" : "read",
      model: adapter.normalizeModel?.(options.model) ?? options.model ?? null,
      effort: adapter.normalizeEffort?.(options.effort) ?? options.effort ?? null,
      phase: "queued",
      status: "queued",
      title: `${adapter.displayName} Run`,
    }, env);
    request = buildRunRequest({ cwd, adapter, options, prompt, job });
    patchJob(cwd, job.id, { request }, env);
  }, { name: `run-${adapter.id}-${ownerSessionId ?? "default"}` });
  if (options.background) {
    spawnWorker(cwd, job.id, env);
    const updated = patchJob(cwd, job.id, { phase: "queued", progress: `${adapter.displayName} is working in the background.` }, env);
    output(options.json ? { status: "running", job: publicJobPayload(updated) } : renderMailboxJob(updated), options.json);
    return updated;
  }
  const { job: completedJob } = await runJob(cwd, job, adapter, request, env);
  output(options.json ? { status: completedJob.status, job: publicJobPayload(completedJob) } : renderMailboxJob(completedJob), options.json);
  return completedJob;
}

export async function handleWorker(argv, env = process.env) {
  env = normalizeRuntimeEnv(env);
  const { options } = parseCommandArgs(argv);
  const cwd = resolveCwd(options);
  if (!options["job-id"]) throw new Error("Missing --job-id.");
  const job = readJob(cwd, options["job-id"], env);
  if (!job) throw new Error(`No job found for ${options["job-id"]}.`);
  const adapter = resolveHarnessSelection({ requestedHarness: job.harnessId });
  return runJob(cwd, job, adapter, job.request, env);
}

export async function handleStatus(argv, env = process.env) {
  env = normalizeRuntimeEnv(env);
  const { options } = parseCommandArgs(argv);
  const cwd = resolveCwd(options);
  const harnessId = options.harness
    ? resolveHarnessSelection({ requestedHarness: options.harness }).id
    : null;
  if (options.wait) {
    const waitResult = await waitForIdle(cwd, env, {
      harnessId,
      timeoutMs: options["timeout-ms"],
      pollIntervalMs: options["poll-interval-ms"],
    });
    if (waitResult.timedOut) {
      throw new Error(`Timed out waiting for Every Harness jobs${harnessId ? ` for ${harnessId}` : ""}.`);
    }
  }
  const jobs = listJobs(cwd, env).filter((job) => !harnessId || job.harnessId === harnessId);
  output(options.json ? { jobs: jobs.map(publicJobPayload) } : renderStatus(jobs, { all: options.all || Boolean(options.harness) }), options.json);
  return jobs;
}

export async function handleCancel(argv, env = process.env) {
  env = normalizeRuntimeEnv(env);
  const { options } = parseCommandArgs(argv);
  const cwd = resolveCwd(options);
  const adapter = options.harness
    ? resolveHarnessSelection({ requestedHarness: options.harness })
    : null;
  const harnessId = adapter?.id ?? null;
  const job = findActiveJob(cwd, { harnessId }, env);
  if (!job) {
    const payload = { status: "idle", reason: "No active Every Harness job." };
    output(options.json ? payload : "No active Every Harness job.\n", options.json);
    return payload;
  }
  if (job.status === "queued") {
    const cancelled = transitionJob(cwd, job.id, ["queued"], "cancelled", { phase: "cancelled", summary: "Cancelled before start." }, env).job;
    output(options.json ? { job: publicJobPayload(cancelled) } : renderMailboxJob(cancelled), options.json);
    return cancelled;
  }
  const selectedAdapter = adapter ?? resolveHarnessSelection({ requestedHarness: job.harnessId });
  transitionJob(cwd, job.id, ["running", "queued", "cancelling"], "cancelling", { phase: "cancelling" }, env);
  let result;
  try {
    result = await selectedAdapter.cancel({
      cwd,
      env,
      job,
      pid: job.processRef?.pid,
      pidIdentity: job.processRef?.pidIdentity,
      sessionId: job.threadId,
      threadId: job.threadId,
      processRef: job.processRef,
      providerMetadata: job.providerMetadata,
    });
  } catch (error) {
    result = {
      cancelled: false,
      status: "failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
  const wasCancelled = Boolean(result.cancelled ?? result.status === "cancelled");
  const cancelled = transitionJob(cwd, job.id, ["cancelling", "running"], wasCancelled ? "cancelled" : "cancel_failed", {
    phase: wasCancelled ? "cancelled" : "cancel_failed",
    summary: result.detail ?? result.note ?? null,
  }, env).job ?? readJob(cwd, job.id, env);
  output(options.json ? { job: publicJobPayload(cancelled) } : renderMailboxJob(cancelled), options.json);
  return cancelled;
}
