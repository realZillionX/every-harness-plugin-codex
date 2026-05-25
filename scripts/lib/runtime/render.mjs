const PRIVATE_KEYS = new Set([
  "pid",
  "pidIdentity",
  "logFile",
  "providerMetadata",
  "processRef",
  "request",
]);

export function sanitizePublic(value) {
  if (Array.isArray(value)) return value.map(sanitizePublic);
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

export function renderSetupReport(report) {
  const lines = ["Every Harness setup"];
  for (const adapter of report.adapters ?? []) {
    const availability = adapter.availability?.available ? "available" : "unavailable";
    const auth = adapter.auth?.loggedIn === true
      ? "authenticated"
      : adapter.auth?.loggedIn === false
        ? "auth needed"
        : "auth unknown";
    const metadata = [adapter.protocol, adapter.maturity].filter(Boolean).join(", ");
    lines.push(`- ${adapter.id}: ${availability}, ${auth}${metadata ? ` (${metadata})` : ""}`);
    if (adapter.availability?.detail) lines.push(`  availability: ${adapter.availability.detail}`);
    if (adapter.auth?.detail) lines.push(`  auth: ${adapter.auth.detail}`);
    if (!adapter.availability?.available && (adapter.availability?.install || adapter.install)) {
      lines.push(`  install: ${adapter.availability?.install ?? adapter.install}`);
    }
  }
  if (report.hooks?.enabled) {
    lines.push("Hooks: enabled via [features].hooks");
  } else if (report.hooks?.detail) {
    lines.push(`Hooks: ${report.hooks.detail}`);
  }
  if (report.reviewGate != null) {
    lines.push(`Review gate: ${report.reviewGate ? "enabled" : "disabled"}`);
  }
  return `${lines.join("\n")}\n`;
}

export function renderJson(value) {
  return `${JSON.stringify(sanitizePublic(value), null, 2)}\n`;
}
