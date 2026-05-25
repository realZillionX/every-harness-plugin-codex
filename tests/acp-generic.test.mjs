import assert from "node:assert/strict";
import test from "node:test";

import { createGenericAcpAdapter, normalizeAcpProgressUpdate } from "../scripts/lib/adapters/acp-generic.mjs";
import {
  BUILTIN_ACP_HARNESSES,
  PLANNED_HARNESSES,
  createBuiltinAcpAdapters,
  createPlannedHarnessAdapters,
} from "../scripts/lib/adapters/builtin-harnesses.mjs";

test("normalizes generic ACP progress events", () => {
  assert.deepEqual(
    normalizeAcpProgressUpdate({
      sessionId: "s-1",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { text: "hello" },
      },
    }, "s-1"),
    {
      message: "Agent is responding.",
      phase: "responding",
      text: "hello",
      threadId: "s-1",
    },
  );
  assert.equal(normalizeAcpProgressUpdate({ sessionId: "other", update: { sessionUpdate: "tool_call" } }, "s-1"), null);
});

test("generic ACP adapter runs through injected client", async () => {
  const calls = [];
  let updateHandler = null;
  const adapter = createGenericAcpAdapter({
    id: "test-acp",
    displayName: "Test ACP",
    command: "test-agent",
    args: ["--acp"],
  }, {
    createClient: async () => ({
      pid: 1234,
      onUpdate(handler) {
        updateHandler = handler;
        return () => calls.push(["removeUpdate"]);
      },
      onServerRequest(method) {
        calls.push(["onServerRequest", method]);
      },
      async newSession(cwd, mcpServers) {
        calls.push(["newSession", cwd, mcpServers]);
        return { sessionId: "s-1" };
      },
      async setMode(sessionId, modeId) {
        calls.push(["setMode", sessionId, modeId]);
      },
      async setModel(sessionId, model) {
        calls.push(["setModel", sessionId, model]);
      },
      async prompt(sessionId, parts) {
        calls.push(["prompt", sessionId, parts]);
        updateHandler({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { text: "final text" },
          },
        });
        return {};
      },
      async shutdown() {
        calls.push(["shutdown"]);
      },
    }),
  });
  const progress = [];
  const result = await adapter.runTurn({
    cwd: "/tmp/work",
    prompt: "do it",
    model: "custom-model",
    mode: "write",
  }, {
    onProgress: (event) => progress.push(event),
  });

  assert.equal(result.finalText, "final text");
  assert.equal(result.sessionId, "s-1");
  assert.equal(result.providerMetadata.harness, "test-acp");
  assert.deepEqual(progress, [{
    message: "Agent is responding.",
    phase: "responding",
    threadId: "s-1",
  }]);
  assert.deepEqual(calls, [
    ["newSession", "/tmp/work", []],
    ["setMode", "s-1", "default"],
    ["setModel", "s-1", "custom-model"],
    ["onServerRequest", "session/request_permission"],
    ["prompt", "s-1", [{ type: "text", text: "do it" }]],
    ["removeUpdate"],
    ["shutdown"],
  ]);
});

test("built-in ACP harness catalog includes user-requested harnesses", () => {
  const ids = new Set(BUILTIN_ACP_HARNESSES.map((definition) => definition.id));
  for (const id of [
    "opencode",
    "openclaw",
    "deepseek-tui",
    "kimi-code",
    "qoder-cli",
    "trae-cli",
    "qwen-code",
    "copilot-cli",
    "cursor-agent",
    "iflow-cli",
    "kiro-cli",
    "kilocode-cli",
    "factory-droid",
    "pi-coding-agent",
  ]) {
    assert.equal(ids.has(id), true, `${id} missing from catalog`);
  }
  const adapters = createBuiltinAcpAdapters({
    spawnSyncImpl: () => ({ status: 1, stderr: "not installed" }),
  });
  assert.ok(adapters.every((adapter) => adapter.protocol === "acp"));
});

test("catalog tracks planned but unverified harnesses explicitly", async () => {
  assert.equal(PLANNED_HARNESSES.some((definition) => definition.id === "antigravity-cli"), true);
  const [adapter] = createPlannedHarnessAdapters();
  assert.equal(adapter.id, "antigravity-cli");
  assert.equal((await adapter.checkAvailability()).available, false);
  await assert.rejects(() => adapter.runTurn(), /not runnable yet/);
});
