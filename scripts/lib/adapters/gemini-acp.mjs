import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import readline from "node:readline";

export const MODELS = Object.freeze({
  FLASH_2_5: "gemini-2.5-flash",
  PRO_2_5: "gemini-2.5-pro",
  FLASH_3: "gemini-3-flash-preview",
  PRO_3: "gemini-3-pro-preview",
  PRO_3_1: "gemini-3.1-pro-preview",
});

export const DEFAULT_MODEL = MODELS.PRO_3_1;

export const MODEL_ALIASES = new Map([
  ["flash", MODELS.FLASH_2_5],
  ["pro", MODELS.PRO_2_5],
  ["flash-3", MODELS.FLASH_3],
  ["pro-3", MODELS.PRO_3],
  ["pro-3.1", MODELS.PRO_3_1],
]);

const ACP_INIT_TIMEOUT_MS = 30_000;
const CANCEL_DELIVERY_DELAY_MS = 200;
const PERMISSION_APPROVAL_RESPONSE = Object.freeze({
  outcome: Object.freeze({
    outcome: "success",
    optionId: "proceed_once",
  }),
});

let nextRpcId = 1;

export function resolveGeminiModel(input) {
  if (input == null) {
    return DEFAULT_MODEL;
  }
  const normalized = String(input).trim();
  if (!normalized) {
    return DEFAULT_MODEL;
  }
  return MODEL_ALIASES.get(normalized.toLowerCase()) ?? normalized;
}

export function detectAcpFlagFromVersion(version) {
  const normalized = String(version ?? "").trim();
  const match = normalized.match(/(\d+)\.(\d+)(?:\.\d+)?/);
  if (!match) {
    return "--acp";
  }

  const major = Number.parseInt(match[1], 10);
  const minor = Number.parseInt(match[2], 10);
  if (major === 0 && minor < 33) {
    return "--experimental-acp";
  }
  return "--acp";
}

export function resolveGeminiPermissionPolicy(request = {}, options = {}) {
  const modeId = resolveModeId(request);
  const autoApprove =
    modeId !== "plan" &&
    request.autoApprovePermissions !== false &&
    options.autoApprovePermissions !== false;

  return {
    modeId,
    autoApprove,
    requestPermissionResponse: autoApprove
      ? cloneJson(PERMISSION_APPROVAL_RESPONSE)
      : { approved: false },
    summary: autoApprove
      ? "Permission requests are auto-approved once in write mode."
      : "Permission requests are not auto-approved in read-only plan mode.",
  };
}

export function describeGeminiPermissionPolicies(options = {}) {
  return {
    write: resolveGeminiPermissionPolicy({ mode: "write" }, options),
    readOnly: resolveGeminiPermissionPolicy({ mode: "read-only" }, options),
  };
}

export function normalizeGeminiProgressUpdate(params, expectedSessionId = null) {
  if (expectedSessionId && params?.sessionId !== expectedSessionId) {
    return null;
  }

  const update = params?.update;
  if (!update || typeof update !== "object") {
    return null;
  }

  if (
    update.sessionUpdate === "agent_message_chunk" &&
    typeof update.content?.text === "string" &&
    update.content.text.length > 0
  ) {
    return {
      message: "Gemini is responding.",
      phase: "responding",
      text: update.content.text,
      threadId: params.sessionId ?? null,
    };
  }

  if (update.sessionUpdate === "tool_call") {
    return {
      message: "Running tool.",
      phase: "tool",
      threadId: params.sessionId ?? null,
    };
  }

  return null;
}

export async function detectAcpFlag(options = {}) {
  if (options.version != null) {
    return detectAcpFlagFromVersion(options.version);
  }

  const binary = options.binary ?? "gemini";
  const runCommandImpl = options.runCommandImpl ?? defaultRunCommand;
  const result = await runCommandImpl(binary, ["--version"], {
    cwd: options.cwd,
    env: options.env,
    timeoutMs: 2000,
  });

  if (result?.status === 0) {
    return detectAcpFlagFromVersion(result.stdout);
  }
  return "--acp";
}

export function createGeminiAcpAdapter(options = {}) {
  const binary = options.binary ?? "gemini";
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  const runCommandImpl = options.runCommandImpl ?? defaultRunCommand;
  const sleepImpl = options.sleepImpl ?? sleep;
  const terminateProcessTreeImpl =
    options.terminateProcessTreeImpl ?? terminateProcessTree;
  const createClientImpl =
    options.createClient ??
    ((clientOptions = {}) =>
      spawnGeminiAcpClient({
        ...clientOptions,
        binary,
        spawnImpl,
        runCommandImpl,
      }));

  async function checkAvailability(context = {}) {
    const result = await runCommandImpl(binary, ["--version"], {
      cwd: context.cwd,
      env: context.env,
      timeoutMs: 2000,
    });

    if (result?.error) {
      return {
        available: false,
        detail: `gemini CLI unavailable: ${result.error.message}`,
      };
    }
    if (result?.status !== 0) {
      return {
        available: false,
        detail:
          firstMeaningfulLine(result?.stderr) ??
          firstMeaningfulLine(result?.stdout) ??
          `gemini --version exited with ${result?.status ?? "unknown"}`,
      };
    }

    const version = String(result?.stdout ?? result?.stderr ?? "").trim();
    return {
      available: true,
      version,
      acpFlag: detectAcpFlagFromVersion(version),
      detail: "Gemini CLI available.",
    };
  }

  async function checkAuth(context = {}) {
    const availability = await checkAvailability(context);
    return {
      authenticated: availability.available,
      loggedIn: availability.available,
      confidence: "binary-only",
      detail: availability.available
        ? "Gemini auth is not prevalidated; runtime uses GOOGLE_API_KEY or Application Default Credentials."
        : "Gemini auth cannot be checked because the CLI is unavailable.",
      permissionPolicies: describeGeminiPermissionPolicies(options),
    };
  }

  async function runTurn(request = {}, callbacks = {}) {
    const cwd = request.cwd ?? process.cwd();
    const env = request.env ?? process.env;
    const prompt = String(request.prompt ?? "");
    if (!prompt.trim()) {
      throw new Error("Gemini ACP adapter requires a prompt.");
    }

    const model = resolveGeminiModel(request.model);
    const permissionPolicy = resolveGeminiPermissionPolicy(request, options);
    const client = await createClientImpl({
      binary,
      cwd,
      env,
      initTimeoutMs: request.initTimeoutMs ?? options.initTimeoutMs,
    });
    if (Number.isFinite(client.pid)) {
      callbacks.onSpawn?.({ pid: client.pid });
    }

    let sessionId = request.resumeSessionId ?? request.sessionId ?? null;
    const mcpServers = Array.isArray(request.mcpServers) ? request.mcpServers : [];

    try {
      if (sessionId) {
        await client.loadSession(sessionId, cwd, mcpServers);
      } else {
        const session = await client.newSession(cwd, mcpServers);
        sessionId = typeof session === "string" ? session : session?.sessionId;
      }

      if (!sessionId) {
        throw new Error("Gemini ACP did not return a session id.");
      }

      await client.setMode(sessionId, permissionPolicy.modeId);
      if (model) {
        await client.setModel(sessionId, model);
      }

      installPermissionHandler(client, permissionPolicy);

      const chunks = [];
      const removeUpdate = client.onUpdate?.((params) => {
        const event = normalizeGeminiProgressUpdate(params, sessionId);
        if (!event) {
          return;
        }
        if (event.text) {
          chunks.push(event.text);
        }
        emitProgress(callbacks, stripPrivateProgressFields(event));
      });

      try {
        const result = await client.prompt(sessionId, [
          { type: "text", text: prompt },
        ]);
        const finalText = chunks.join("");
        return {
          finalText,
          output: finalText,
          stopReason: result?.stopReason ?? "unknown",
          sessionId,
          threadId: sessionId,
          providerMetadata: {
            geminiSessionId: sessionId,
            model,
            modeId: permissionPolicy.modeId,
            permissionAutoApproval: permissionPolicy.autoApprove,
          },
          ...(Number.isFinite(client.pid)
            ? { processRef: { pid: client.pid } }
            : {}),
        };
      } finally {
        removeUpdate?.();
      }
    } finally {
      if (request.shutdown !== false) {
        await client.shutdown?.();
      }
    }
  }

  async function cancel(request = {}) {
    const cwd = request.cwd ?? process.cwd();
    const env = request.env ?? process.env;
    const sessionId = resolveSessionId(request);
    const processRef = request.processRef ?? request.providerMetadata?.processRef ?? {};
    const pid = toFinitePid(request.pid ?? processRef.pid);
    const pidIdentity = request.pidIdentity ?? processRef.pidIdentity ?? null;
    const steps = [];

    let sessionCancelDelivered = false;
    if (sessionId) {
      try {
        const client = await createClientImpl({ binary, cwd, env });
        client.cancel(sessionId);
        sessionCancelDelivered = true;
        steps.push({
          method: "session/cancel",
          target: sessionId,
          delivered: true,
        });
        await sleepImpl(options.cancelDeliveryDelayMs ?? CANCEL_DELIVERY_DELAY_MS);
        await client.shutdown?.({ phase1Ms: 0, phase2Ms: 500 });
      } catch (error) {
        steps.push({
          method: "session/cancel",
          target: sessionId,
          delivered: false,
          error: errorMessage(error),
        });
      }
    }

    let processCancelDelivered = false;
    if (pid) {
      if (options.requirePidIdentity !== false && !pidIdentity) {
        steps.push({
          method: "process",
          target: pid,
          delivered: false,
          error: "Refusing to cancel a stored process without a PID identity.",
        });
      } else {
        try {
          const result = await terminateProcessTreeImpl(pid, {
            cwd,
            env,
            pidIdentity,
          });
          processCancelDelivered = Boolean(result?.delivered);
          steps.push({
            method: result?.method ?? "process",
            target: pid,
            delivered: processCancelDelivered,
          });
        } catch (error) {
          steps.push({
            method: "process",
            target: pid,
            delivered: false,
            error: errorMessage(error),
          });
        }
      }
    }

    const attempted = steps.length > 0;
    const cancelled = sessionCancelDelivered || processCancelDelivered;
    return {
      cancelled,
      status: cancelled ? "cancelled" : "cancel_failed",
      note: attempted
        ? summarizeCancelSteps(steps)
        : "No Gemini session or process reference to cancel.",
      steps,
    };
  }

  return {
    id: "gemini-acp",
    aliases: ["gemini", "gemini-cli"],
    displayName: "Gemini ACP",
    defaultModel: DEFAULT_MODEL,
    models: MODELS,
    modelAliases: MODEL_ALIASES,
    permissionPolicies: describeGeminiPermissionPolicies(options),
    checkAvailability,
    checkAuth,
    normalizeModel: resolveGeminiModel,
    normalizeEffort(input) {
      const normalized = String(input ?? "").trim();
      return normalized || undefined;
    },
    describePermissionPolicy(request = {}) {
      return resolveGeminiPermissionPolicy(request, options);
    },
    runTurn,
    cancel,
  };
}

class AcpClient {
  #proc;
  #rl = null;
  #pending = new Map();
  #updateHandlers = new Set();
  #serverRequestHandlers = new Map();
  #closed = false;

  constructor(proc) {
    this.#proc = proc;
    proc.stdin?.on?.("error", () => this.#onExit(1));
    if (proc.stdout) {
      this.#rl = readline.createInterface({
        input: proc.stdout,
        crlfDelay: Infinity,
      });
      this.#rl.on("line", (line) => this.#onLine(line));
    }
    proc.on?.("exit", (code) => this.#onExit(code));
  }

  onUpdate(handler) {
    this.#updateHandlers.add(handler);
    return () => this.#updateHandlers.delete(handler);
  }

  onServerRequest(method, handler) {
    this.#serverRequestHandlers.set(method, handler);
  }

  async initialize() {
    return this.#request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "every-harness-gemini-acp", version: "0.1.0" },
      clientCapabilities: {},
    });
  }

  async newSession(cwd, mcpServers = []) {
    return this.#request("session/new", { cwd, mcpServers });
  }

  async loadSession(sessionId, cwd, mcpServers = []) {
    return this.#request("session/load", { sessionId, cwd, mcpServers });
  }

  async setMode(sessionId, modeId) {
    return this.#request("session/set_mode", { sessionId, modeId });
  }

  async setModel(sessionId, modelId) {
    return this.#request("session/set_model", { sessionId, modelId });
  }

  async prompt(sessionId, parts) {
    return this.#request("session/prompt", {
      sessionId,
      prompt: parts.map((part) => ({
        type: "text",
        text: String(part.text ?? ""),
      })),
    });
  }

  cancel(sessionId) {
    this.#notify("session/cancel", { sessionId });
  }

  async shutdown(options = {}) {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#rl?.close();
    try {
      this.#proc.stdin?.end?.();
    } catch {}

    const phase1Ms = options.phase1Ms ?? 100;
    const phase2Ms = options.phase2Ms ?? 1500;
    await new Promise((resolve) => {
      let resolved = false;
      const finish = () => {
        if (resolved) {
          return;
        }
        resolved = true;
        try {
          this.#proc.stdout?.destroy?.();
        } catch {}
        try {
          this.#proc.stderr?.destroy?.();
        } catch {}
        resolve();
      };

      const exitHandler = () => finish();
      this.#proc.once?.("exit", exitHandler);
      const termTimer = setTimeout(() => {
        try {
          this.#proc.kill?.("SIGTERM");
        } catch {}
        const killTimer = setTimeout(() => {
          try {
            this.#proc.kill?.("SIGKILL");
          } catch {}
          finish();
        }, phase2Ms);
        this.#proc.once?.("exit", () => {
          clearTimeout(killTimer);
          finish();
        });
      }, phase1Ms);
      this.#proc.once?.("exit", () => {
        clearTimeout(termTimer);
        finish();
      });
    });
  }

  killImmediately(reason) {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    const error = reason instanceof Error ? reason : new Error(String(reason));
    for (const { reject } of this.#pending.values()) {
      reject(error);
    }
    this.#pending.clear();
    this.#rl?.close();
    try {
      this.#proc.kill?.("SIGKILL");
    } catch {}
  }

  get pid() {
    return this.#proc.pid;
  }

  #request(method, params) {
    const id = nextRpcId++;
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#send({ jsonrpc: "2.0", id, method, params });
    });
  }

  #notify(method, params) {
    this.#send({ jsonrpc: "2.0", method, params });
  }

  #send(message) {
    if (this.#closed) {
      return;
    }
    try {
      this.#proc.stdin?.write?.(`${JSON.stringify(message)}\n`);
    } catch {}
  }

  #onLine(line) {
    if (!String(line).trim()) {
      return;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message.method === "session/update" && message.id === undefined) {
      for (const handler of this.#updateHandlers) {
        handler(message.params);
      }
      return;
    }

    if (message.method !== undefined && message.id !== undefined) {
      const handler = this.#serverRequestHandlers.get(message.method);
      if (!handler) {
        this.#send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not found" },
        });
        return;
      }

      Promise.resolve()
        .then(() => handler(message.params))
        .then((result) =>
          this.#send({ jsonrpc: "2.0", id: message.id, result }),
        )
        .catch((error) =>
          this.#send({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32000, message: errorMessage(error) },
          }),
        );
      return;
    }

    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) {
        return;
      }
      this.#pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message);
        error.code = message.error.code;
        error.data = message.error.data;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
    }
  }

  #onExit(code) {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    const error = new Error(`ACP process exited unexpectedly (code ${code})`);
    error.code = "ACP_PROCESS_EXIT";
    error.exitCode = code;
    for (const { reject } of this.#pending.values()) {
      reject(error);
    }
    this.#pending.clear();
  }
}

async function spawnGeminiAcpClient(options = {}) {
  const binary = options.binary ?? "gemini";
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const flag = await detectAcpFlag({
    binary,
    cwd,
    env,
    runCommandImpl: options.runCommandImpl,
  });

  const proc = options.spawnImpl(binary, [flag], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const client = new AcpClient(proc);
  installDefaultHandlers(client);

  const initTimeoutMs = options.initTimeoutMs ?? ACP_INIT_TIMEOUT_MS;
  try {
    await withTimeout(
      client.initialize(),
      initTimeoutMs,
      `ACP initialize timed out after ${Math.round(initTimeoutMs / 1000)}s`,
    );
  } catch (error) {
    client.killImmediately(error);
    throw error;
  }
  return client;
}

function installDefaultHandlers(client) {
  client.onServerRequest("fs/read_text_file", async ({ path }) => {
    return { content: await readFile(path, "utf8") };
  });
  client.onServerRequest("fs/write_text_file", async ({ path, content }) => {
    await writeFile(path, String(content ?? ""), "utf8");
    return {};
  });
  client.onServerRequest("session/request_permission", async () => ({
    approved: false,
  }));
}

function installPermissionHandler(client, permissionPolicy) {
  client.onServerRequest("session/request_permission", async () =>
    cloneJson(permissionPolicy.requestPermissionResponse),
  );
}

function resolveModeId(request) {
  if (request.modeId) {
    return String(request.modeId).trim();
  }

  const mode = String(
    request.mode ?? request.permissionMode ?? request.accessMode ?? "",
  )
    .trim()
    .toLowerCase();

  if (mode === "plan" || mode === "read-only" || mode === "readonly") {
    return "plan";
  }
  return "default";
}

function emitProgress(callbacks, event) {
  callbacks.onProgress?.(event);
  callbacks.progress?.(event);
}

function stripPrivateProgressFields(event) {
  const { text: _text, ...publicEvent } = event;
  return publicEvent;
}

function resolveSessionId(request) {
  return (
    request.sessionId ??
    request.threadId ??
    request.providerMetadata?.geminiSessionId ??
    request.providerMetadata?.sessionId ??
    null
  );
}

function toFinitePid(value) {
  const pid = Number(value);
  return Number.isFinite(pid) && pid > 0 ? pid : null;
}

function summarizeCancelSteps(steps) {
  const delivered = steps.find((step) => step.delivered);
  if (delivered) {
    return `${delivered.method} delivered.`;
  }
  return steps
    .map((step) => step.error)
    .filter(Boolean)
    .join(" ") || "Cancel request was not delivered.";
}

function terminateProcessTree(pid, options = {}) {
  const killImpl = options.killImpl ?? process.kill.bind(process);
  try {
    killImpl(-pid, "SIGTERM");
    return { attempted: true, delivered: true, method: "process-group" };
  } catch (error) {
    if (error?.code !== "ESRCH") {
      try {
        killImpl(pid, "SIGTERM");
        return { attempted: true, delivered: true, method: "process" };
      } catch (innerError) {
        if (innerError?.code === "ESRCH") {
          return { attempted: true, delivered: false, method: "process" };
        }
        throw innerError;
      }
    }
    return { attempted: true, delivered: false, method: "process-group" };
  }
}

function defaultRunCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    input: options.input,
    maxBuffer: options.maxBuffer,
    stdio: options.stdio ?? "pipe",
    shell: false,
  });

  return {
    command,
    args,
    status: result.status ?? 0,
    signal: result.signal ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? null,
  };
}

function firstMeaningfulLine(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() =>
    clearTimeout(timeoutHandle),
  );
}
