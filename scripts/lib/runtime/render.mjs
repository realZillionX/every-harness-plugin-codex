const PRIVATE_KEYS = new Set([
  "pid",
  "pidIdentity",
  "logFile",
  "providerMetadata",
  "processRef",
  "request",
]);

const SECRET_PATTERNS = [
  {
    pattern: /(["']?\bAUTHORIZATION["']?\s*[:=]\s*)(["']?)(?:Bearer\s+)?[^"',;\n}]+/gi,
    replacement: "$1$2[REDACTED]$2",
  },
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
    replacement: "Bearer [REDACTED]",
  },
  {
    pattern: /(["']?\b[A-Z0-9_-]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|AUTHORIZATION|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN)[A-Z0-9_-]*["']?\s*[:=]\s*)(["']?)([^"',\s;}]+)/gi,
    replacement: "$1$2[REDACTED]$2",
  },
  {
    pattern: /\bsk-[A-Za-z0-9_-]{12,}\b/g,
    replacement: "[REDACTED]",
  },
];

export function redactSecrets(text) {
  return SECRET_PATTERNS.reduce(
    (current, { pattern, replacement }) => current.replace(pattern, replacement),
    String(text ?? ""),
  );
}

export function sanitizePublic(value) {
  if (Array.isArray(value)) return value.map(sanitizePublic);
  if (typeof value === "string") return redactSecrets(value);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, nested] of Object.entries(value)) {
    if (PRIVATE_KEYS.has(key)) continue;
    out[key] = sanitizePublic(nested);
  }
  return out;
}

export function publicJobPayload(job) {
  if (!job) {
    return { status: "idle" };
  }
  return sanitizePublic({
    harnessId: job.harnessId,
    status: job.status,
    phase: job.phase ?? null,
    summary: job.summary ?? null,
    progress: job.progress ?? null,
    errorMessage: job.errorMessage ?? null,
    result: job.result ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt ?? null,
  });
}

export function renderMailboxJob(job) {
  const payload = publicJobPayload(job);
  if (payload.status === "idle") {
    return "Every Harness mailbox is idle.\n";
  }
  const lines = [
    `Every Harness ${payload.harnessId ?? "job"}: ${payload.status}`,
  ];
  if (payload.phase) lines.push(`Phase: ${payload.phase}`);
  if (payload.progress) lines.push(`Progress: ${payload.progress}`);
  if (payload.summary) lines.push(`Summary: ${payload.summary}`);
  if (payload.errorMessage) lines.push(`Reason: ${payload.errorMessage}`);
  if (payload.result?.finalText) lines.push(`Result:\n${payload.result.finalText}`);
  return `${lines.join("\n")}\n`;
}

export function renderStatus(jobs, { all = false } = {}) {
  if (!jobs.length) return "Every Harness mailbox is idle.\n";
  const selected = all ? jobs : jobs.slice(0, 1);
  return selected.map(renderMailboxJob).join("");
}

export function renderJson(value) {
  return `${JSON.stringify(sanitizePublic(value), null, 2)}\n`;
}
