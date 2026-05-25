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

const SETUP_MATURITY_ORDER = ["stable", "experimental", "planned"];
const SETUP_MATURITY_LABELS = {
  stable: "Stable harnesses",
  experimental: "Experimental harnesses",
  planned: "Planned harnesses (catalog only, not runnable)",
  other: "Other harnesses",
};

function setupMaturity(adapter) {
  const maturity = String(adapter.maturity ?? "stable").trim().toLowerCase();
  if (SETUP_MATURITY_ORDER.includes(maturity)) return maturity;
  return "other";
}

function setupProtocol(adapter) {
  return adapter.protocol ?? adapter.availability?.protocol ?? null;
}

function setupSource(adapter) {
  return adapter.source ?? adapter.availability?.source ?? null;
}

function setupInstall(adapter) {
  return adapter.availability?.install ?? adapter.install ?? null;
}

function renderSetupAdapter(lines, adapter) {
  const maturity = setupMaturity(adapter);
  const protocol = setupProtocol(adapter);
  const source = setupSource(adapter);
  const install = setupInstall(adapter);
  const protocolSuffix = protocol ? ` (protocol: ${protocol})` : "";

  if (maturity === "planned") {
    lines.push(`- ${adapter.id}: planned, not runnable${protocolSuffix}`);
    if (adapter.aliases?.length) lines.push(`  aliases: ${adapter.aliases.join(", ")}`);
    if (adapter.availability?.detail) lines.push(`  reason: ${adapter.availability.detail}`);
    if (source) lines.push(`  source: ${source}`);
    if (install) lines.push(`  install: ${install}`);
    return;
  }

  const availability = adapter.availability?.available ? "available" : "unavailable";
  const auth = adapter.auth?.loggedIn === true
    ? "authenticated"
    : adapter.auth?.loggedIn === false
      ? "auth needed"
      : "auth unknown";
  lines.push(`- ${adapter.id}: ${availability}, ${auth}${protocolSuffix}`);
  if (adapter.aliases?.length) lines.push(`  aliases: ${adapter.aliases.join(", ")}`);
  if (source) lines.push(`  source: ${source}`);
  if (adapter.availability?.detail) lines.push(`  availability: ${adapter.availability.detail}`);
  if (adapter.auth?.detail) lines.push(`  auth: ${adapter.auth.detail}`);
  if (!adapter.availability?.available && install) {
    lines.push(`  install: ${install}`);
  }
}

export function renderSetupReport(report) {
  const lines = ["Every Harness setup"];
  const groups = new Map();
  for (const adapter of report.adapters ?? []) {
    const maturity = setupMaturity(adapter);
    const list = groups.get(maturity) ?? [];
    list.push(adapter);
    groups.set(maturity, list);
  }
  for (const maturity of [...SETUP_MATURITY_ORDER, "other"]) {
    const adapters = groups.get(maturity) ?? [];
    if (!adapters.length) continue;
    lines.push(SETUP_MATURITY_LABELS[maturity]);
    for (const adapter of adapters) {
      renderSetupAdapter(lines, adapter);
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
