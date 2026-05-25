import { appendFileSync } from "node:fs";
import process from "node:process";
import readline from "node:readline";

const logPath = process.env.FAKE_ACP_LOG ?? "";
const sessionId = process.env.FAKE_ACP_SESSION_ID ?? "fake-acp-session";
const sessions = new Map();
const pendingPrompts = new Map();
let nextServerRequestId = 10_000;

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  if (!line.trim()) return;

  let message;
  try {
    message = JSON.parse(line);
  } catch (error) {
    writeLog("invalid", { line, error: error.message });
    return;
  }

  writeLog("in", message);
  if (message.method !== undefined && message.id !== undefined) {
    handleRequest(message);
    return;
  }
  if (message.method !== undefined) {
    handleNotification(message);
    return;
  }
  if (message.id !== undefined) {
    handleResponse(message);
  }
});

rl.on("close", () => {
  process.exit(0);
});

function handleRequest(message) {
  switch (message.method) {
    case "initialize":
      send({
        jsonrpc: "2.0",
        id: message.id,
        result: {
          protocolVersion: 1,
          serverInfo: { name: "fake-acp-agent", version: "0.1.0" },
          capabilities: {},
        },
      });
      break;

    case "session/new":
      sessions.set(sessionId, {
        cwd: message.params?.cwd ?? null,
        modeId: null,
        modelId: null,
        cancelled: false,
      });
      send({ jsonrpc: "2.0", id: message.id, result: { sessionId } });
      break;

    case "session/set_mode":
      getSession(message.params?.sessionId).modeId = message.params?.modeId ?? null;
      send({ jsonrpc: "2.0", id: message.id, result: {} });
      break;

    case "session/set_model":
      getSession(message.params?.sessionId).modelId = message.params?.modelId ?? null;
      send({ jsonrpc: "2.0", id: message.id, result: {} });
      break;

    case "session/prompt":
      requestPermissionBeforePrompt(message);
      break;

    default:
      send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: `Unsupported fake ACP method: ${message.method}` },
      });
      break;
  }
}

function handleNotification(message) {
  if (message.method !== "session/cancel") return;

  const targetSessionId = message.params?.sessionId ?? sessionId;
  getSession(targetSessionId).cancelled = true;
}

function handleResponse(message) {
  const pending = pendingPrompts.get(message.id);
  if (!pending) return;
  pendingPrompts.delete(message.id);

  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: pending.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "fake " },
      },
    },
  });
  send({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: pending.sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "ACP response" },
      },
    },
  });

  const session = getSession(pending.sessionId);
  send({
    jsonrpc: "2.0",
    id: pending.promptRequestId,
    result: {
      text: `fallback result for ${extractPromptText(pending.prompt)}`,
      structuredOutput: {
        modeId: session.modeId,
        modelId: session.modelId,
        permissionResponse: message.result ?? null,
      },
    },
  });
}

function requestPermissionBeforePrompt(message) {
  const promptSessionId = message.params?.sessionId ?? sessionId;
  const permissionRequestId = nextServerRequestId++;
  pendingPrompts.set(permissionRequestId, {
    promptRequestId: message.id,
    sessionId: promptSessionId,
    prompt: message.params?.prompt ?? [],
  });
  send({
    jsonrpc: "2.0",
    id: permissionRequestId,
    method: "session/request_permission",
    params: {
      sessionId: promptSessionId,
      description: "Fake ACP permission request",
    },
  });
}

function getSession(targetSessionId) {
  const key = targetSessionId ?? sessionId;
  if (!sessions.has(key)) {
    sessions.set(key, {
      cwd: null,
      modeId: null,
      modelId: null,
      cancelled: false,
    });
  }
  return sessions.get(key);
}

function extractPromptText(prompt) {
  if (!Array.isArray(prompt)) return "";
  return prompt
    .map((part) => String(part?.text ?? ""))
    .join("")
    .trim();
}

function send(message) {
  writeLog("out", message);
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeLog(direction, message) {
  if (!logPath) return;
  appendFileSync(logPath, `${JSON.stringify({ direction, message })}\n`);
}
