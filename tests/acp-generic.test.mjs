import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { createGenericAcpAdapter, normalizeAcpProgressUpdate } from "../scripts/lib/adapters/acp-generic.mjs";
import {
  BUILTIN_ACP_HARNESSES,
  BUILTIN_CLI_HEADLESS_HARNESSES,
  PLANNED_HARNESSES,
  createBuiltinAcpAdapters,
  createPlannedHarnessAdapters,
} from "../scripts/lib/adapters/builtin-harnesses.mjs";

const fakeAcpAgentPath = fileURLToPath(new URL("./fixtures/fake-acp-agent.mjs", import.meta.url));

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

test("generic ACP adapter runs through spawned fake ACP process", async (t) => {
  const fixture = await createFakeAcpWorkspace(t, "spawn-session");
  const adapter = createSpawnedFakeAcpAdapter({ initTimeoutMs: 2000 });
  const progress = [];
  const spawns = [];

  const result = await adapter.runTurn({
    cwd: fixture.cwd,
    env: fixture.env,
    prompt: "do real spawn",
    model: "fake-model",
    mode: "write",
  }, {
    onProgress: (event) => progress.push(event),
    onSpawn: (event) => spawns.push(event),
  });

  assert.equal(Number.isFinite(spawns[0]?.pid), true);
  assert.equal(result.finalText, "fake ACP response");
  assert.equal(result.sessionId, "spawn-session");
  assert.equal(result.threadId, "spawn-session");
  assert.equal(result.providerMetadata.harness, "fake-acp");
  assert.deepEqual(result.structuredOutput, {
    modeId: "default",
    modelId: "fake-model",
    permissionResponse: {
      outcome: {
        outcome: "success",
        optionId: "proceed_once",
      },
    },
  });
  assert.deepEqual(progress, [
    {
      message: "Agent is responding.",
      phase: "responding",
      threadId: "spawn-session",
    },
    {
      message: "Agent is responding.",
      phase: "responding",
      threadId: "spawn-session",
    },
  ]);

  const log = await readRpcLog(fixture.logPath);
  const incomingRequests = log
    .filter((entry) => entry.direction === "in" && entry.message.method && entry.message.id !== undefined)
    .map((entry) => entry.message);
  assert.deepEqual(incomingRequests.map((message) => message.method), [
    "initialize",
    "session/new",
    "session/set_mode",
    "session/set_model",
    "session/prompt",
  ]);
  assert.deepEqual(incomingRequests[4].params, {
    sessionId: "spawn-session",
    prompt: [{ type: "text", text: "do real spawn" }],
  });
  assert.deepEqual(
    log.find((entry) => entry.direction === "in" && entry.message.id === 10_000)?.message.result,
    {
      outcome: {
        outcome: "success",
        optionId: "proceed_once",
      },
    },
  );
});

test("generic ACP adapter cancel sends session/cancel notification to spawned process", async (t) => {
  const fixture = await createFakeAcpWorkspace(t, "cancel-session");
  const adapter = createSpawnedFakeAcpAdapter({
    initTimeoutMs: 2000,
    cancelDeliveryDelayMs: 10,
  });

  const result = await adapter.cancel({
    cwd: fixture.cwd,
    env: fixture.env,
    sessionId: "cancel-session",
  });

  assert.equal(result.cancelled, true);
  const log = await waitForRpcLog(fixture.logPath, (entries) =>
    entries.some((entry) => entry.direction === "in" && entry.message.method === "session/cancel"),
  );
  assert.equal(
    log.some((entry) => entry.direction === "in" && entry.message.method === "initialize"),
    true,
  );
  assert.deepEqual(
    log.find((entry) => entry.direction === "in" && entry.message.method === "session/cancel")?.message.params,
    { sessionId: "cancel-session" },
  );
});

test("built-in ACP harness catalog includes user-requested harnesses", () => {
  const ids = new Set(BUILTIN_ACP_HARNESSES.map((definition) => definition.id));
  for (const id of [
    "opencode",
    "openclaw",
    "qoder",
    "trae",
    "copilot",
    "cursor",
    "kiro",
  ]) {
    assert.equal(ids.has(id), true, `${id} missing from catalog`);
  }
  const adapters = createBuiltinAcpAdapters({
    spawnSyncImpl: () => ({ status: 1, stderr: "not installed" }),
  });
  assert.ok(adapters.every((adapter) => adapter.protocol === "acp"));
});

test("native headless catalog includes non-ACP requested harnesses", () => {
  const ids = new Set(BUILTIN_CLI_HEADLESS_HARNESSES.map((definition) => definition.id));
  assert.equal(ids.has("antigravity"), true);
  assert.equal(ids.has("codewhale"), true);
  assert.equal(ids.has("kimi-code"), true);
  const codewhale = BUILTIN_CLI_HEADLESS_HARNESSES.find((definition) => definition.id === "codewhale");
  assert.ok(codewhale.aliases.includes("deepseek-tui"));
});

test("catalog tracks planned but unverified harnesses explicitly", async () => {
  assert.equal(PLANNED_HARNESSES.some((definition) => definition.id === "pi-coding-agent"), true);
  const [adapter] = createPlannedHarnessAdapters();
  assert.equal(adapter.id, "pi-coding-agent");
  assert.equal((await adapter.checkAvailability()).available, false);
  await assert.rejects(() => adapter.runTurn(), /not runnable yet/);
});

function createSpawnedFakeAcpAdapter(options = {}) {
  return createGenericAcpAdapter({
    id: "fake-acp",
    displayName: "Fake ACP",
    command: process.execPath,
    args: [fakeAcpAgentPath],
  }, options);
}

async function createFakeAcpWorkspace(t, sessionId) {
  const cwd = await mkdtemp(join(tmpdir(), "acp-generic-"));
  const logPath = join(cwd, "rpc.ndjson");
  t.after(async () => {
    await rm(cwd, { recursive: true, force: true });
  });
  return {
    cwd,
    logPath,
    env: {
      ...process.env,
      FAKE_ACP_LOG: logPath,
      FAKE_ACP_SESSION_ID: sessionId,
    },
  };
}

async function readRpcLog(logPath) {
  try {
    const text = await readFile(logPath, "utf8");
    return text
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function waitForRpcLog(logPath, predicate) {
  const deadline = Date.now() + 1000;
  let entries = [];
  while (Date.now() < deadline) {
    entries = await readRpcLog(logPath);
    if (predicate(entries)) return entries;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for fake ACP log: ${JSON.stringify(entries)}`);
}
