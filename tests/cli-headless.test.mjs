import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  CliHeadlessStreamJsonParser,
  buildCliHeadlessArgs,
  createCliHeadlessAdapter,
} from "../scripts/lib/adapters/cli-headless.mjs";

function createFakeProcess({ pid = 4321, stdout = "", stderr = "", code = 0 } = {}) {
  const proc = new EventEmitter();
  proc.pid = pid;
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.unref = () => {};

  queueMicrotask(() => {
    if (stdout) {
      proc.stdout.write(stdout);
    }
    proc.stdout.end();
    if (stderr) {
      proc.stderr.write(stderr);
    }
    proc.stderr.end();
    proc.emit("close", code);
  });

  return proc;
}

function jsonLine(value) {
  return `${JSON.stringify(value)}\n`;
}

test("buildCliHeadlessArgs supports fixed args, model flag, and prompt append", () => {
  assert.deepEqual(
    buildCliHeadlessArgs("do work", {
      command: "agy",
      args: ["--print"],
      modelFlag: "--model",
      model: "fast",
    }),
    ["--print", "--model", "fast", "do work"],
  );

  assert.deepEqual(
    buildCliHeadlessArgs("do work", {
      command: "tool",
      args: ["exec", "{prompt}", "--model={model}"],
      model: "custom",
    }),
    ["exec", "do work", "--model=custom"],
  );
});

test("text stdout mode returns finalText and provider metadata", async () => {
  const calls = [];
  const adapter = createCliHeadlessAdapter(
    {
      id: "agy",
      aliases: ["antigravity"],
      displayName: "Antigravity",
      command: "agy",
      args: ["--print"],
      modelFlag: "--model",
      outputMode: "text",
    },
    {
      spawnImpl(command, args, options) {
        calls.push({ command, args, options });
        return createFakeProcess({
          stdout: "plain answer\n",
        });
      },
    },
  );

  const result = await adapter.runTurn({
    cwd: "/tmp/work",
    env: { TOKEN: "x" },
    prompt: "Explain",
    model: "m-1",
  });

  assert.equal(result.status, "completed");
  assert.equal(result.finalText, "plain answer\n");
  assert.equal(result.structuredOutput, null);
  assert.equal(result.providerMetadata.harness, "agy");
  assert.equal(result.providerMetadata.outputMode, "text");
  assert.deepEqual(calls[0].args, ["--print", "--model", "m-1", "Explain"]);
  assert.equal(calls[0].options.cwd, "/tmp/work");
  assert.equal(calls[0].options.env.TOKEN, "x");
});

test("stream-json mode combines multiple event text shapes", async () => {
  const progress = [];
  const adapter = createCliHeadlessAdapter(
    {
      id: "kimi-code",
      displayName: "Kimi Code",
      command: "kimi",
      args: ["-p", "--output-format", "stream-json"],
      outputMode: "stream-json",
    },
    {
      spawnImpl() {
        return createFakeProcess({
          stdout: [
            jsonLine({ type: "assistant", sessionId: "s-1", message: { content: [{ type: "text", text: "hello " }] } }),
            jsonLine({ type: "message", content: "world" }),
            jsonLine({ delta: { text: "!" } }),
            jsonLine({ type: "metadata", usage: { inputTokens: 12 } }),
            jsonLine({ type: "done", structured_output: { files: ["a.js"] } }),
          ].join(""),
        });
      },
    },
  );

  const result = await adapter.runTurn(
    { prompt: "write code" },
    { onProgress: (event) => progress.push(event) },
  );

  assert.equal(result.status, "completed");
  assert.equal(result.finalText, "hello world!");
  assert.equal(result.sessionId, "s-1");
  assert.deepEqual(
    progress.map((event) => event.text),
    ["hello ", "world", "!"],
  );
  assert.deepEqual(result.structuredOutput.files, ["a.js"]);
  assert.deepEqual(result.structuredOutput.events, [
    { type: "metadata", usage: { inputTokens: 12 } },
    { type: "done", structured_output: { files: ["a.js"] } },
  ]);
  assert.deepEqual(result.structuredOutput.parseErrors, []);
});

test("stream-json parser keeps unrecognized and invalid JSON lines", () => {
  const parser = new CliHeadlessStreamJsonParser();
  const events = parser.feed([
    "not-json\n",
    jsonLine({ type: "message", text: "ok" }),
    jsonLine({ type: "usage", total: 5 }),
  ].join(""));

  assert.equal(events.length, 1);
  assert.equal(events[0].text, "ok");
  assert.equal(parser.state.finalText, "ok");
  assert.equal(parser.state.events.length, 2);
  assert.equal(parser.state.events[0].type, "parse_error");
  assert.deepEqual(parser.state.events[1], { type: "usage", total: 5 });
});

test("non-zero exit code returns failed result with stderr", async () => {
  const adapter = createCliHeadlessAdapter(
    {
      id: "codewhale",
      displayName: "CodeWhale",
      command: "codewhale",
      args: ["exec", "--output-format", "stream-json"],
      outputMode: "stream-json",
    },
    {
      spawnImpl() {
        return createFakeProcess({
          stdout: jsonLine({ type: "message", text: "partial" }),
          stderr: "bad credentials\n",
          code: 7,
        });
      },
    },
  );

  const result = await adapter.runTurn({ prompt: "ship it" });

  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, 7);
  assert.equal(result.finalText, "partial");
  assert.equal(result.stderr, "bad credentials\n");
});

test("availability probe uses injected spawnSync implementation", async () => {
  const calls = [];
  const adapter = createCliHeadlessAdapter(
    {
      id: "headless",
      displayName: "Headless CLI",
      command: ["headless", "agent"],
      probeArgs: ["--version"],
    },
    {
      spawnSyncImpl(command, args, options) {
        calls.push({ command, args, options });
        return { status: 0, stdout: "headless 1.2.3\n", stderr: "" };
      },
    },
  );

  const availability = await adapter.checkAvailability({
    cwd: "/tmp/project",
    env: { PATH: "/bin" },
  });

  assert.equal(availability.available, true);
  assert.equal(availability.detail, "headless 1.2.3");
  assert.equal(calls[0].command, "headless");
  assert.deepEqual(calls[0].args, ["--version"]);
  assert.equal(calls[0].options.cwd, "/tmp/project");
  assert.deepEqual(calls[0].options.env, { PATH: "/bin" });
});

test("cancel terminates process refs and explains session-only cancellation", async () => {
  const killed = [];
  const adapter = createCliHeadlessAdapter(
    {
      id: "session-only",
      displayName: "Session Only CLI",
      command: "session-only",
    },
    {
      killImpl(pid, signal) {
        killed.push([pid, signal]);
      },
    },
  );

  assert.deepEqual(await adapter.cancel({ processRef: { pid: 100 } }), {
    cancelled: true,
    status: "cancelled",
  });
  assert.deepEqual(killed, [[-100, "SIGTERM"]]);

  const stalePid = await adapter.cancel({ processRef: { pid: 100, pidIdentity: "stale" } });
  assert.equal(stalePid.cancelled, false);
  assert.match(stalePid.detail, /identity did not match/);
  assert.deepEqual(killed, [[-100, "SIGTERM"]]);

  const sessionOnly = await adapter.cancel({ sessionId: "s-1" });
  assert.equal(sessionOnly.cancelled, false);
  assert.match(sessionOnly.detail, /does not expose protocol-level cancellation/);
});
