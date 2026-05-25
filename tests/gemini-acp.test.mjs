import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_MODEL,
  MODEL_ALIASES,
  MODELS,
  createGeminiAcpAdapter,
  describeGeminiPermissionPolicies,
  detectAcpFlagFromVersion,
  normalizeGeminiProgressUpdate,
  resolveGeminiModel,
} from "../scripts/lib/adapters/gemini-acp.mjs";

test("resolves Gemini model aliases and defaults", () => {
  assert.equal(DEFAULT_MODEL, MODELS.PRO_3_1);
  assert.equal(resolveGeminiModel(), DEFAULT_MODEL);
  assert.equal(resolveGeminiModel(""), DEFAULT_MODEL);
  assert.equal(resolveGeminiModel("pro"), MODELS.PRO_2_5);
  assert.equal(resolveGeminiModel("PRO"), MODELS.PRO_2_5);
  assert.equal(resolveGeminiModel("flash"), MODELS.FLASH_2_5);
  assert.equal(resolveGeminiModel("flash-3"), MODELS.FLASH_3);
  assert.equal(resolveGeminiModel("pro-3"), MODELS.PRO_3);
  assert.equal(resolveGeminiModel("pro-3.1"), MODELS.PRO_3_1);
  assert.equal(resolveGeminiModel("gemini-custom"), "gemini-custom");
  assert.equal(MODEL_ALIASES.get("pro-3.1"), MODELS.PRO_3_1);
});

test("detects ACP flag from Gemini CLI versions", () => {
  assert.equal(detectAcpFlagFromVersion("0.32.9"), "--experimental-acp");
  assert.equal(detectAcpFlagFromVersion("gemini 0.32.1"), "--experimental-acp");
  assert.equal(detectAcpFlagFromVersion("0.33.0"), "--acp");
  assert.equal(detectAcpFlagFromVersion("1.0.0"), "--acp");
  assert.equal(detectAcpFlagFromVersion("not a version"), "--acp");
});

test("normalizes ACP progress updates and ignores unrelated sessions", async () => {
  assert.deepEqual(
    normalizeGeminiProgressUpdate(
      {
        sessionId: "s-1",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { text: "hello" },
        },
      },
      "s-1",
    ),
    {
      message: "Gemini is responding.",
      phase: "responding",
      text: "hello",
      threadId: "s-1",
    },
  );

  assert.deepEqual(
    normalizeGeminiProgressUpdate(
      {
        sessionId: "s-1",
        update: { sessionUpdate: "tool_call", toolCallId: "tool-1" },
      },
      "s-1",
    ),
    {
      message: "Running tool.",
      phase: "tool",
      threadId: "s-1",
    },
  );

  assert.equal(
    normalizeGeminiProgressUpdate(
      {
        sessionId: "other",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { text: "ignored" },
        },
      },
      "s-1",
    ),
    null,
  );

  const calls = [];
  const progress = [];
  const fakeClient = createFakeAcpClient({
    calls,
    onPrompt(sessionId, emit) {
      emit({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { text: "hello " },
        },
      });
      emit({ sessionId, update: { sessionUpdate: "tool_call" } });
      emit({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { text: "world" },
        },
      });
      emit({
        sessionId: "other",
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { text: "ignored" },
        },
      });
    },
  });

  const adapter = createGeminiAcpAdapter({
    createClient: async () => fakeClient,
  });

  const result = await adapter.runTurn(
    {
      cwd: "/tmp/work",
      prompt: "Do the thing",
      model: "pro",
      mode: "write",
    },
    { onProgress: (event) => progress.push(event) },
  );

  assert.equal(result.output, "hello world");
  assert.equal(result.threadId, "s-1");
  assert.equal(result.providerMetadata.model, MODELS.PRO_2_5);
  assert.deepEqual(progress, [
    {
      message: "Gemini is responding.",
      phase: "responding",
      threadId: "s-1",
    },
    { message: "Running tool.", phase: "tool", threadId: "s-1" },
    {
      message: "Gemini is responding.",
      phase: "responding",
      threadId: "s-1",
    },
  ]);
  assert.deepEqual(calls, [
    ["newSession", "/tmp/work", []],
    ["setMode", "s-1", "default"],
    ["setModel", "s-1", MODELS.PRO_2_5],
    ["onServerRequest", "session/request_permission"],
    ["prompt", "s-1", [{ type: "text", text: "Do the thing" }]],
    ["removeUpdate"],
    ["shutdown", undefined],
  ]);
});

test("expresses permission auto-approval policy explicitly", async () => {
  const policies = describeGeminiPermissionPolicies();
  assert.equal(policies.write.modeId, "default");
  assert.equal(policies.write.autoApprove, true);
  assert.deepEqual(policies.write.requestPermissionResponse, {
    outcome: { outcome: "success", optionId: "proceed_once" },
  });
  assert.equal(policies.readOnly.modeId, "plan");
  assert.equal(policies.readOnly.autoApprove, false);
  assert.deepEqual(policies.readOnly.requestPermissionResponse, {
    approved: false,
  });

  const permissionHandlers = new Map();
  const adapter = createGeminiAcpAdapter({
    createClient: async () =>
      createFakeAcpClient({
        permissionHandlers,
      }),
    runCommandImpl: async () => ({
      status: 0,
      stdout: "0.33.0\n",
      stderr: "",
    }),
  });

  const auth = await adapter.checkAuth({ cwd: "/tmp/work" });
  assert.equal(auth.confidence, "binary-only");
  assert.equal(auth.permissionPolicies.write.autoApprove, true);

  await adapter.runTurn({
    cwd: "/tmp/work",
    prompt: "edit a file",
    mode: "write",
  });
  assert.deepEqual(
    await permissionHandlers.get("session/request_permission")({
      description: "Write file",
    }),
    { outcome: { outcome: "success", optionId: "proceed_once" } },
  );

  await adapter.runTurn({
    cwd: "/tmp/work",
    prompt: "inspect only",
    mode: "read-only",
  });
  assert.deepEqual(
    await permissionHandlers.get("session/request_permission")({
      description: "Write file",
    }),
    { approved: false },
  );
});

test("cancel sends ACP session cancel before process fallback", async () => {
  const calls = [];
  const adapter = createGeminiAcpAdapter({
    createClient: async () => ({
      cancel(sessionId) {
        calls.push(["session/cancel", sessionId]);
      },
      async shutdown(options) {
        calls.push(["shutdown", options]);
      },
    }),
    sleepImpl: async (ms) => {
      calls.push(["sleep", ms]);
    },
    terminateProcessTreeImpl: async (pid, options) => {
      calls.push(["process", pid, options.pidIdentity]);
      return { delivered: true, method: "process-group" };
    },
  });

  const result = await adapter.cancel({
    sessionId: "s-1",
    processRef: { pid: 1234, pidIdentity: "start-time" },
  });

  assert.equal(result.cancelled, true);
  assert.deepEqual(result.steps.map((step) => step.method), [
    "session/cancel",
    "process-group",
  ]);
  assert.deepEqual(calls, [
    ["session/cancel", "s-1"],
    ["sleep", 200],
    ["shutdown", { phase1Ms: 0, phase2Ms: 500 }],
    ["process", 1234, "start-time"],
  ]);
});

test("cancel still falls back to process termination when session cancel fails", async () => {
  const calls = [];
  const adapter = createGeminiAcpAdapter({
    createClient: async () => ({
      cancel(sessionId) {
        calls.push(["session/cancel", sessionId]);
        throw new Error("session gone");
      },
    }),
    sleepImpl: async () => {
      calls.push(["sleep"]);
    },
    terminateProcessTreeImpl: async (pid) => {
      calls.push(["process", pid]);
      return { delivered: true, method: "process-group" };
    },
  });

  const result = await adapter.cancel({
    sessionId: "s-1",
    processRef: { pid: 999, pidIdentity: "start-time" },
  });

  assert.equal(result.cancelled, true);
  assert.deepEqual(result.steps.map((step) => step.method), [
    "session/cancel",
    "process-group",
  ]);
  assert.deepEqual(calls, [
    ["session/cancel", "s-1"],
    ["process", 999],
  ]);
});

function createFakeAcpClient(options = {}) {
  let updateHandler = null;
  const calls = options.calls ?? [];
  const permissionHandlers = options.permissionHandlers ?? new Map();

  return {
    pid: options.pid ?? 4321,
    onUpdate(handler) {
      updateHandler = handler;
      return () => calls.push(["removeUpdate"]);
    },
    onServerRequest(method, handler) {
      permissionHandlers.set(method, handler);
      calls.push(["onServerRequest", method]);
    },
    async newSession(cwd, mcpServers) {
      calls.push(["newSession", cwd, mcpServers]);
      return { sessionId: options.sessionId ?? "s-1" };
    },
    async loadSession(sessionId, cwd, mcpServers) {
      calls.push(["loadSession", sessionId, cwd, mcpServers]);
      return {};
    },
    async setMode(sessionId, modeId) {
      calls.push(["setMode", sessionId, modeId]);
    },
    async setModel(sessionId, model) {
      calls.push(["setModel", sessionId, model]);
    },
    async prompt(sessionId, parts) {
      calls.push(["prompt", sessionId, parts]);
      options.onPrompt?.(sessionId, (params) => updateHandler?.(params));
      return { stopReason: "end_turn" };
    },
    async shutdown(shutdownOptions) {
      calls.push(["shutdown", shutdownOptions]);
    },
  };
}
