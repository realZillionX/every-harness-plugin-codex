import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ACTIVE_JOB_STATUSES = new Set(["queued", "running", "cancelling"]);
export const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled", "cancel_failed"]);

export function nowIso() {
  return new Date().toISOString();
}

export function resolveDataRoot(env = process.env) {
  return env.EVERY_HARNESS_DATA
    ? path.resolve(env.EVERY_HARNESS_DATA)
    : path.join(os.homedir(), ".every-harness");
}

export function resolveWorkspaceRoot(cwd = process.cwd()) {
  let current = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return path.resolve(cwd);
    current = parent;
  }
}

export function resolveWorkspaceHash(cwd = process.cwd()) {
  let canonical = resolveWorkspaceRoot(cwd);
  try {
    canonical = fs.realpathSync.native(canonical);
  } catch {}
  return createHash("sha256").update(canonical).digest("hex").slice(0, 12);
}

export function resolveStateDir(cwd = process.cwd(), env = process.env) {
  return path.join(resolveDataRoot(env), "state", resolveWorkspaceHash(cwd));
}

export function resolveJobsDir(cwd = process.cwd(), env = process.env) {
  return path.join(resolveStateDir(cwd, env), "jobs");
}

export function resolveLockDir(cwd = process.cwd(), env = process.env) {
  return path.join(resolveStateDir(cwd, env), "locks");
}

export function ensureStateDir(cwd = process.cwd(), env = process.env) {
  fs.mkdirSync(resolveJobsDir(cwd, env), { recursive: true, mode: 0o700 });
  fs.mkdirSync(resolveLockDir(cwd, env), { recursive: true, mode: 0o700 });
}

export function sanitizeId(id, label = "ID") {
  const text = String(id ?? "");
  if (!/^[\w.-]+$/.test(text)) {
    throw new Error(`Invalid ${label}: ${text.slice(0, 50)}`);
  }
  return text;
}

export function generateJobId(prefix = "job") {
  return `${prefix}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
}

export function resolveJobFile(cwd, jobId, env = process.env) {
  return path.join(resolveJobsDir(cwd, env), `${sanitizeId(jobId, "job ID")}.json`);
}

export function resolveJobLogFile(cwd, jobId, env = process.env) {
  return path.join(resolveJobsDir(cwd, env), `${sanitizeId(jobId, "job ID")}.log`);
}

function writeAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = `${filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temp, filePath);
}

export function createJob(cwd, data, env = process.env) {
  ensureStateDir(cwd, env);
  const job = {
    id: data.id ?? generateJobId(data.harnessId ?? "job"),
    harnessId: data.harnessId,
    status: data.status ?? "queued",
    workspaceRoot: resolveWorkspaceRoot(cwd),
    createdAt: data.createdAt ?? nowIso(),
    updatedAt: nowIso(),
    phase: data.phase ?? "queued",
    viewed: Boolean(data.viewed),
    ...data,
  };
  writeAtomic(resolveJobFile(cwd, job.id, env), job);
  return job;
}

export function readJob(cwd, jobId, env = process.env) {
  try {
    return JSON.parse(fs.readFileSync(resolveJobFile(cwd, jobId, env), "utf8"));
  } catch {
    return null;
  }
}

export function writeJob(cwd, job, env = process.env) {
  writeAtomic(resolveJobFile(cwd, job.id, env), { ...job, updatedAt: nowIso() });
}

export function listJobs(cwd, env = process.env) {
  const jobsDir = resolveJobsDir(cwd, env);
  if (!fs.existsSync(jobsDir)) return [];
  return fs.readdirSync(jobsDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(jobsDir, file), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
}

export function patchJob(cwd, jobId, patch, env = process.env) {
  const job = readJob(cwd, jobId, env);
  if (!job) return null;
  const next = { ...job, ...patch, id: job.id, updatedAt: nowIso() };
  writeAtomic(resolveJobFile(cwd, job.id, env), next);
  return next;
}

export function transitionJob(cwd, jobId, expectedStatuses, nextStatus, patch = {}, env = process.env) {
  const job = readJob(cwd, jobId, env);
  if (!job) {
    return { transitioned: false, reason: "missing" };
  }
  const expected = new Set(expectedStatuses);
  if (!expected.has(job.status)) {
    return { transitioned: false, reason: "status", job };
  }
  const next = {
    ...job,
    ...patch,
    status: nextStatus,
    updatedAt: nowIso(),
    ...(TERMINAL_JOB_STATUSES.has(nextStatus) ? { completedAt: patch.completedAt ?? nowIso() } : {}),
  };
  writeAtomic(resolveJobFile(cwd, job.id, env), next);
  return { transitioned: true, job: next };
}

export function findActiveJob(cwd, { harnessId = null, ownerSessionId = null } = {}, env = process.env) {
  return listJobs(cwd, env).find((job) => {
    if (!ACTIVE_JOB_STATUSES.has(job.status)) return false;
    if (harnessId && job.harnessId !== harnessId) return false;
    if (ownerSessionId && job.ownerSessionId !== ownerSessionId) return false;
    return true;
  }) ?? null;
}

export function cleanupOldJobs(cwd, { maxTerminalJobs = 100 } = {}, env = process.env) {
  const terminal = listJobs(cwd, env).filter((job) => TERMINAL_JOB_STATUSES.has(job.status));
  for (const job of terminal.slice(maxTerminalJobs)) {
    try { fs.unlinkSync(resolveJobFile(cwd, job.id, env)); } catch {}
    try { fs.unlinkSync(resolveJobLogFile(cwd, job.id, env)); } catch {}
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withJobStoreLock(cwd, env, fn, options = {}) {
  ensureStateDir(cwd, env);
  const lockName = sanitizeId(options.name ?? "job-store", "lock name");
  const lockDir = path.join(resolveLockDir(cwd, env), `${lockName}.lock`);
  const timeoutMs = options.timeoutMs ?? 5000;
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  const staleMs = options.staleMs ?? 30_000;
  const deadline = Date.now() + timeoutMs;
  let locked = false;

  while (!locked) {
    try {
      fs.mkdirSync(lockDir, { mode: 0o700 });
      fs.writeFileSync(path.join(lockDir, "owner.json"), JSON.stringify({
        pid: process.pid,
        createdAt: nowIso(),
      }), { encoding: "utf8", mode: 0o600 });
      locked = true;
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const stat = fs.statSync(lockDir);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.rmSync(lockDir, { recursive: true, force: true });
          continue;
        }
      } catch {}
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for Every Harness job store lock: ${lockName}`);
      }
      await sleep(pollIntervalMs);
    }
  }

  try {
    return await fn();
  } finally {
    if (locked) {
      try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch {}
    }
  }
}
