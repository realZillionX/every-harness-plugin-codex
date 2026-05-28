import assert from "node:assert/strict";
import test from "node:test";

import {
  CLAUDE_READ_ONLY_TOOLS,
  MODEL_ALIASES,
  StreamParser,
  buildClaudeArgs,
  createClaudeCodeAdapter,
  resolveClaudeEffort,
  resolveClaudeModel,
  validateClaudeTurnCompletion,
} from "../scripts/lib/adapters/claude-code.mjs";

function jsonLine(value) {
  return `${JSON.stringify(value)}\n`;
}

test("resolves Claude model aliases and preserves explicit model names", () => {
  assert.equal(MODEL_ALIASES.get("sonnet"), "claude-sonnet-4-6");
  assert.equal(MODEL_ALIASES.get("haiku"), "claude-haiku-4-5");
  assert.equal(resolveClaudeModel("sonnet"), "claude-sonnet-4-6");
  assert.equal(resolveClaudeModel("Haiku"), "claude-haiku-4-5");
  assert.equal(resolveClaudeModel(" claude-custom-model "), "claude-custom-model");
  assert.equal(resolveClaudeModel(""), undefined);
  assert.equal(resolveClaudeModel(null), undefined);
});

test("resolves Claude effort values and fallback aliases", () => {
  assert.equal(resolveClaudeEffort("low"), "low");
  assert.equal(resolveClaudeEffort("MEDIUM"), "medium");
  assert.equal(resolveClaudeEffort("high"), "high");
  assert.equal(resolveClaudeEffort("max"), "max");
  assert.equal(resolveClaudeEffort("none"), "low");
  assert.equal(resolveClaudeEffort("minimal"), "low");
  assert.equal(resolveClaudeEffort("xhigh"), "max");
  assert.equal(resolveClaudeEffort(undefined), undefined);
  assert.throws(
    () => resolveClaudeEffort("extreme"),
    /Unsupported Claude effort "extreme"/
  );
});

test("StreamParser buffers stream-json chunk boundaries", () => {
  const parser = new StreamParser();
  const line = jsonLine({
    type: "stream_event",
    session_id: "session-1",
    event: {
      type: "content_block_delta",
      delta: { type: "text_delta", text: "hello" },
    },
  });

  assert.deepEqual(parser.feed(line.slice(0, 17)), []);
  const events = parser.feed(line.slice(17));

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "text");
  assert.equal(events[0].text, "hello");
  assert.equal(events[0].phase, "responding");
  assert.equal(events[0].threadId, "session-1");
  assert.equal(parser.state.finalMessage, "hello");
  assert.equal(parser.state.sessionId, "session-1");
});

test("StreamParser emits text, tool, retry, and result events", () => {
  const parser = new StreamParser();
  const events = parser.feed([
    jsonLine({
      type: "system",
      session_id: "session-2",
      subtype: "api_retry",
    }),
    jsonLine({
      type: "stream_event",
      event: {
        type: "content_block_start",
        content_block: {
          type: "tool_use",
          name: "Write",
          input: { file_path: "src/example.txt" },
        },
      },
    }),
    jsonLine({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "draft answer" },
      },
    }),
    jsonLine({
      type: "result",
      session_id: "session-2",
      result: "final answer",
    }),
  ].join(""));

  assert.deepEqual(
    events.map((event) => event.kind),
    ["retry", "tool", "text", "result"]
  );
  assert.equal(events[0].phase, "retry");
  assert.equal(events[1].tool, "Write");
  assert.deepEqual(events[1].touchedFiles, ["src/example.txt"]);
  assert.equal(events[2].text, "draft answer");
  assert.equal(events[3].finalMessage, "final answer");
  assert.equal(parser.state.finalMessage, "final answer");
  assert.deepEqual(parser.state.toolUses, [
    { tool: "Write", input: { file_path: "src/example.txt" } },
  ]);
  assert.deepEqual(parser.state.touchedFiles, ["src/example.txt"]);
  assert.equal(parser.state.receivedTerminalEvent, true);
});

test("StreamParser captures structured_output on terminal result", () => {
  const parser = new StreamParser();
  const events = parser.feed(jsonLine({
    type: "result",
    session_id: "session-3",
    result: "",
    structured_output: {
      status: "ok",
      files: ["tests/claude-code.test.mjs"],
    },
  }));

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "result");
  assert.deepEqual(events[0].structuredOutput, {
    status: "ok",
    files: ["tests/claude-code.test.mjs"],
  });
  assert.deepEqual(parser.state.structuredOutput, {
    status: "ok",
    files: ["tests/claude-code.test.mjs"],
  });
});

test("StreamParser tolerates parse errors and continues parsing later lines", () => {
  const parser = new StreamParser();
  const events = parser.feed([
    "{\"type\":\"stream_event\",bad json}\n",
    jsonLine({
      type: "stream_event",
      event: {
        type: "content_block_delta",
        delta: { type: "text_delta", text: "still parsed" },
      },
    }),
  ].join(""));

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "text");
  assert.equal(events[0].text, "still parsed");
  assert.equal(parser.state.unresolvedParseErrors, 1);
  assert.equal(parser.state.parseErrors.length, 1);
  assert.equal(
    validateClaudeTurnCompletion(parser.state, 0).status,
    "unknown"
  );
});

test("StreamParser reads assistant message content events", () => {
  const parser = new StreamParser();
  const events = parser.feed(jsonLine({
    type: "assistant",
    session_id: "session-4",
    message: {
      content: [{ type: "text", text: "assistant text" }],
    },
  }));

  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "text");
  assert.equal(events[0].text, "assistant text");
  assert.equal(parser.state.finalMessage, "assistant text");
});

test("buildClaudeArgs creates stream-json Claude Code arguments", () => {
  const args = buildClaudeArgs("do the task", {
    model: "sonnet",
    effort: "minimal",
    noSessionPersistence: true,
    sessionId: "session-id",
    resumeSessionId: "resume-id",
    allowedTools: ["Read", "Grep"],
    maxTurns: 3,
    jsonSchema: { type: "object", additionalProperties: false },
    systemPrompt: "system text",
    permissionMode: "acceptEdits",
    settingsFile: "/tmp/settings.json",
  });

  assert.deepEqual(args.slice(0, 5), [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  ]);
  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), [
    "--model",
    "claude-sonnet-4-6",
  ]);
  assert.deepEqual(args.slice(args.indexOf("--effort"), args.indexOf("--effort") + 2), [
    "--effort",
    "low",
  ]);
  assert.ok(args.includes("--no-session-persistence"));
  assert.deepEqual(args.slice(args.indexOf("--session-id"), args.indexOf("--session-id") + 2), [
    "--session-id",
    "session-id",
  ]);
  assert.deepEqual(args.slice(args.indexOf("--resume"), args.indexOf("--resume") + 2), [
    "--resume",
    "resume-id",
  ]);
  assert.equal(
    args.filter((value) => value === "--allowedTools").length,
    2
  );
  assert.deepEqual(args.slice(args.indexOf("--max-turns"), args.indexOf("--max-turns") + 2), [
    "--max-turns",
    "3",
  ]);
  assert.equal(
    JSON.parse(args[args.indexOf("--json-schema") + 1]).additionalProperties,
    false
  );
  assert.deepEqual(args.slice(args.indexOf("--system-prompt"), args.indexOf("--system-prompt") + 2), [
    "--system-prompt",
    "system text",
  ]);
  assert.deepEqual(args.slice(args.indexOf("--permission-mode"), args.indexOf("--permission-mode") + 2), [
    "--permission-mode",
    "acceptEdits",
  ]);
  assert.deepEqual(args.slice(args.indexOf("--settings"), args.indexOf("--settings") + 2), [
    "--settings",
    "/tmp/settings.json",
  ]);
  assert.equal(args.at(-2), "--");
  assert.equal(args.at(-1), "do the task");
});

test("buildClaudeArgs supports non-stream output and read-only tool defaults", () => {
  const jsonArgs = buildClaudeArgs("task", { outputFormat: "json" });
  assert.deepEqual(jsonArgs.slice(0, 3), ["-p", "--output-format", "json"]);
  assert.equal(jsonArgs.includes("--verbose"), false);

  const readOnlyArgs = buildClaudeArgs("inspect", { mode: "read-only" });
  assert.equal(
    readOnlyArgs.filter((value) => value === "--allowedTools").length,
    CLAUDE_READ_ONLY_TOOLS.length
  );
  assert.ok(readOnlyArgs.includes("Read"));
  assert.ok(readOnlyArgs.includes("Grep"));
});

test("createClaudeCodeAdapter exposes contract and uses injected probes", async () => {
  const calls = [];
  const adapter = createClaudeCodeAdapter({
    command: ["fake-claude", "--wrapped"],
    spawnSyncImpl(command, args) {
      calls.push({ command, args });
      if (args.at(-1) === "--version") {
        return { status: 0, stdout: "Claude Code 1.2.3\n", stderr: "" };
      }
      return { status: 0, stdout: "authenticated\n", stderr: "" };
    },
  });

  assert.equal(adapter.id, "claude-code");
  assert.equal(adapter.displayName, "Claude Code");
  assert.equal(adapter.normalizeModel("sonnet"), "claude-sonnet-4-6");
  assert.equal(adapter.normalizeEffort("xhigh"), "max");

  assert.deepEqual(await adapter.checkAvailability({ cwd: "/tmp" }), {
    available: true,
    detail: "Claude Code 1.2.3",
  });
  assert.deepEqual(await adapter.checkAuth({ cwd: "/tmp" }), {
    available: true,
    loggedIn: true,
    detail: "authenticated",
  });
  assert.deepEqual(calls, [
    { command: "fake-claude", args: ["--wrapped", "--version"] },
    { command: "fake-claude", args: ["--wrapped", "auth", "status"] },
  ]);

  const apiKeyAdapter = createClaudeCodeAdapter({
    spawnSyncImpl() {
      throw new Error("auth probe should not run with an API key");
    },
  });
  assert.deepEqual(
    await apiKeyAdapter.checkAuth({ env: { ANTHROPIC_API_KEY: "test-key" } }),
    { available: true, loggedIn: true, detail: "API key configured" }
  );
});
