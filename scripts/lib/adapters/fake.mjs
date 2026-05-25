import { setTimeout as delay } from "node:timers/promises";

export function createFakeAdapter(options = {}) {
  return {
    id: options.id ?? "fake",
    aliases: options.aliases ?? [],
    displayName: options.displayName ?? "Fake Harness",
    defaultModel: "fake-model",
    normalizeModel(input) {
      return input || "fake-model";
    },
    normalizeEffort(input) {
      return input || null;
    },
    async checkAvailability() {
      return { available: options.available !== false, detail: options.availableDetail ?? "Fake harness available." };
    },
    async checkAuth() {
      return { loggedIn: options.loggedIn !== false, detail: options.authDetail ?? "Fake harness authenticated." };
    },
    async runTurn(request, callbacks = {}) {
      callbacks.onProgress?.({ message: "Fake harness is starting.", phase: "starting" });
      if (options.delayMs) await delay(options.delayMs);
      callbacks.onProgress?.({ message: "Fake harness is responding.", phase: "responding" });
      if (request.prompt?.includes("FAIL") || options.fail) {
        throw new Error(options.failReason ?? "Fake harness failure.");
      }
      if (request.prompt?.includes("TOOL")) {
        callbacks.onProgress?.({ message: "Running tool.", phase: "tool" });
      }
      return {
        exitStatus: 0,
        sessionId: options.sessionId ?? "fake-session",
        finalText: options.finalText ?? `Fake result: ${request.prompt ?? ""}`.trim(),
        structuredOutput: null,
        touchedFiles: options.touchedFiles ?? [],
        providerMetadata: { fake: true },
      };
    },
    async cancel() {
      return { cancelled: true, detail: "Fake harness cancelled." };
    },
    async runReview(request) {
      const reviewedText = String(request.prompt ?? "").split(/\n\n/).at(-1) ?? "";
      const text = /\bBLOCK\b/i.test(reviewedText) ? "BLOCK: fake review blocked." : "ALLOW: fake review passed.";
      return { exitStatus: 0, sessionId: "fake-review", finalText: text };
    },
  };
}

export const fakeAdapter = createFakeAdapter();
