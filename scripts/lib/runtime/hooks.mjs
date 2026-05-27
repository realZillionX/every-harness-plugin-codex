import {
  listJobs,
  patchJob,
  readConfig,
  setCurrentSession,
} from "./job-store.mjs";

export function parseHookInput(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return {};
  return JSON.parse(raw);
}

export function handleSessionStart(input, { cwd = process.cwd(), env = process.env } = {}) {
  const sessionId = input.session_id ?? input.sessionId ?? input.turn_id ?? env.CODEX_SESSION_ID ?? null;
  if (sessionId) {
    setCurrentSession(cwd, String(sessionId).replace(/[^\w.-]/g, "_"), env);
  }
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: "Every Harness mailbox routing is active.",
    },
  };
}

export function handleUnreadResult(_input, { cwd = process.cwd(), env = process.env } = {}) {
  const unread = listJobs(cwd, env).filter((job) =>
    ["completed", "failed", "cancelled", "cancel_failed"].includes(job.status) && !job.viewed
  );
  for (const job of unread) {
    patchJob(cwd, job.id, { viewed: true }, env);
  }
  if (!unread.length) {
    return { continue: true, suppressOutput: true };
  }
  return {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: `Every Harness has ${unread.length} unread background result${unread.length === 1 ? "" : "s"}. Run $every-harness:status --all to inspect sanitized summaries.`,
    },
  };
}

export async function handleStopReview(input, { cwd = process.cwd(), env = process.env, adapters = [] } = {}) {
  const config = readConfig(cwd, env);
  if (!config.stopReviewGate) {
    return { continue: true, suppressOutput: true };
  }
  const adapter = adapters.find((candidate) => typeof candidate.runReview === "function");
  if (!adapter) {
    return {
      continue: true,
      systemMessage: "Every Harness review gate is enabled, but no review-capable adapter is configured.",
    };
  }
  const result = await adapter.runReview({
    cwd,
    prompt: `Review the previous Codex response and answer ALLOW: or BLOCK:.\n\n${input.last_assistant_message ?? ""}`,
  }, {});
  const finalText = String(result.finalText ?? "");
  if (/^\s*BLOCK:/i.test(finalText)) {
    return {
      decision: "block",
      reason: finalText.replace(/^\s*BLOCK:\s*/i, "").trim() || "Every Harness review gate blocked continuation.",
    };
  }
  return { continue: true, suppressOutput: true };
}
