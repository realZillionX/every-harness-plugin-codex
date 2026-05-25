import { spawn as nodeSpawn, spawnSync } from "node:child_process";
import readline from "node:readline";

const DEFAULT_INIT_TIMEOUT_MS = 30_000;
const DEFAULT_CANCEL_DELIVERY_DELAY_MS = 50;
const PERMISSION_APPROVAL_RESPONSE = Object.freeze({
  outcome: Object.freeze({
    outcome: "success",
    optionId: "proceed_once",
  }),
});

let nextRpcId = 1;

export function createGenericAcpAdapter(definition, options = {}) {
  validateAcpDefinition(definition);
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
  const createClientImpl =
    options.createClient ??
    ((context = {}) => spawnAcpClient(definition, { ...context, spawnImpl }));

  async function checkAvailability(context = {}) {
    const probe = definition.probe ?? {
      command: definition.command,
      args: definition.probeArgs ?? ["--version"],
    };
    try {
      const result = spawnSyncImpl(probe.command, probe.args ?? [], {
        cwd: context.cwd,
        env: context.env,
        encoding: "utf8",
        timeout: definition.probeTimeoutMs ?? 5000,
      });
      if (result.error) {
        return availabilityUnavailable(definition, result.error.message);
      }
      if (result.status !== 0 && definition.requiresSuccessfulProbe !== false) {
        return availabilityUnavailable(
          definition,
          firstMeaningfulLine(result.stderr) ?? firstMeaningfulLine(result.stdout) ?? `probe exited with ${result.status}`,
        );
      }
      return {
        available: true,
        detail: probe.successDetail ?? firstMeaningfulLine(result.stdout) ?? firstMeaningfulLine(result.stderr) ?? `${definition.displayName} probe succeeded.`,
        install: definition.install ?? null,
      };
    } catch (error) {
      return availabilityUnavailable(definition, error instanceof Error ? error.message : String(error));
    }
  }

  async function checkAuth(context = {}) {
    const env = context.env ?? process.env;
    const envKeys = definition.auth?.envKeys ?? [];
    const foundEnvKeys = envKeys.filter((key) => Boolean(env[key]));
    if (envKeys.length > 0) {
      return {
        loggedIn: foundEnvKeys.length > 0,
        confidence: foundEnvKeys.length > 0 ? "env" : "unknown",
        detail: foundEnvKeys.length > 0
          ? `Auth environment detected: ${foundEnvKeys.join(", ")}.`
          : `No auth environment detected. Configure one of: ${envKeys.join(", ")}.`,
      };
    }
    return {
      loggedIn: null,
      confidence: "unknown",
      detail: definition.auth?.detail ?? "Authentication is delegated to the harness CLI.",
    };
  }

  async function runTurn(request = {}, callbacks = {}) {
    const prompt = String(request.prompt ?? "").trim();
    if (!prompt) throw new Error(`${definition.displayName} ACP adapter requires a prompt.`);
    const client = await createClientImpl({
      cwd: request.cwd ?? process.cwd(),
      env: request.env ?? process.env,
      initTimeoutMs: request.initTimeoutMs ?? definition.initTimeoutMs ?? options.initTimeoutMs,
    });
    callbacks.onSpawn?.({ pid: client.pid });

    const chunks = [];
    let sessionId = request.resumeSessionId ?? request.sessionId ?? null;
    try {
      if (sessionId) {
        await optionalRequest(client, "loadSession", [sessionId, request.cwd ?? process.cwd(), []]);
      } else {
        const session = await client.newSession(request.cwd ?? process.cwd(), []);
        sessionId = typeof session === "string" ? session : session?.sessionId;
      }
      if (!sessionId) throw new Error(`${definition.displayName} ACP did not return a session id.`);

      await optionalRequest(client, "setMode", [sessionId, resolveModeId(request)]);
      if (request.model) await optionalRequest(client, "setModel", [sessionId, request.model]);
      installPermissionHandler(client, request);

      const removeUpdate = client.onUpdate?.((params) => {
        const event = normalizeAcpProgressUpdate(params, sessionId);
        if (!event) return;
        if (event.text) chunks.push(event.text);
        callbacks.onProgress?.(stripPrivateProgressFields(event));
      });
      try {
        const result = await client.prompt(sessionId, [{ type: "text", text: prompt }]);
        const finalText = chunks.join("").trim() || extractAcpResultText(result);
        return {
          finalText,
          sessionId,
          threadId: sessionId,
          structuredOutput: result?.structuredOutput ?? result?.structured_output ?? null,
          touchedFiles: [],
          providerMetadata: {
            acpSessionId: sessionId,
            harness: definition.id,
            command: definition.command,
          },
        };
      } finally {
        removeUpdate?.();
      }
    } finally {
      if (request.shutdown !== false) await client.shutdown?.();
    }
  }

  async function cancel(request = {}) {
    const sessionId =
      request.sessionId ??
      request.threadId ??
      request.providerMetadata?.acpSessionId ??
      request.providerMetadata?.sessionId ??
      null;
    if (!sessionId) {
      return { cancelled: false, detail: `No ${definition.displayName} ACP session id is available.` };
    }
    try {
      const client = await createClientImpl({
        cwd: request.cwd ?? process.cwd(),
        env: request.env ?? process.env,
      });
      client.cancel(sessionId);
      const deliveryDelayMs =
        request.cancelDeliveryDelayMs ??
        options.cancelDeliveryDelayMs ??
        DEFAULT_CANCEL_DELIVERY_DELAY_MS;
      if (deliveryDelayMs > 0) await sleep(deliveryDelayMs);
      await client.shutdown?.({ phase1Ms: 100, phase2Ms: 500 });
      return { cancelled: true, detail: "ACP session/cancel delivered." };
    } catch (error) {
      return {
        cancelled: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    id: definition.id,
    aliases: definition.aliases ?? [],
    displayName: definition.displayName,
    defaultModel: definition.defaultModel ?? null,
    maturity: definition.maturity ?? "experimental",
    protocol: "acp",
    install: definition.install ?? null,
    checkAvailability,
    checkAuth,
    normalizeModel(input) {
      return String(input ?? "").trim() || definition.defaultModel || undefined;
    },
    normalizeEffort(input) {
      return String(input ?? "").trim() || undefined;
    },
    runTurn,
    cancel,
  };
}

export function normalizeAcpProgressUpdate(params, expectedSessionId = null) {
  if (expectedSessionId && params?.sessionId !== expectedSessionId) return null;
  const update = params?.update;
  if (!update || typeof update !== "object") return null;
  if (update.sessionUpdate === "agent_message_chunk" && typeof update.content?.text === "string") {
    return {
      message: "Agent is responding.",
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

class JsonRpcAcpClient {
  #proc;
  #rl = null;
  #pending = new Map();
  #updateHandlers = new Set();
  #serverRequestHandlers = new Map();
  #closed = false;

  constructor(proc) {
    this.#proc = proc;
    proc.stdin?.on?.("error", (error) => this.#onExit(null, error));
    if (proc.stdout) {
      this.#rl = readline.createInterface({ input: proc.stdout, crlfDelay: Infinity });
      this.#rl.on("line", (line) => this.#onLine(line));
    }
    proc.on?.("error", (error) => this.#onExit(null, error));
    proc.on?.("exit", (code) => this.#onExit(code));
  }

  get pid() {
    return this.#proc.pid;
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
      clientInfo: { name: "every-harness-acp", version: "0.2.0" },
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
    return this.#request("session/prompt", { sessionId, prompt: parts });
  }

  cancel(sessionId) {
    this.#notify("session/cancel", { sessionId });
  }

  async shutdown(options = {}) {
    if (this.#closed) return;
    this.#closed = true;
    const phase1Ms = options.phase1Ms ?? 100;
    const phase2Ms = options.phase2Ms ?? 1000;
    await new Promise((resolve) => {
      let done = false;
      let termTimer;
      let killTimer;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(termTimer);
        clearTimeout(killTimer);
        this.#rl?.close();
        try {
          this.#proc.stdout?.destroy?.();
        } catch {}
        try {
          this.#proc.stderr?.destroy?.();
        } catch {}
        resolve();
      };
      this.#proc.once?.("exit", finish);
      try {
        this.#proc.stdin?.end?.();
      } catch {}
      termTimer = setTimeout(() => {
        try {
          this.#proc.kill?.("SIGTERM");
        } catch {}
        killTimer = setTimeout(() => {
          try {
            this.#proc.kill?.("SIGKILL");
          } catch {}
          finish();
        }, phase2Ms);
      }, phase1Ms);
    });
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
    if (this.#closed) return;
    try {
      this.#proc.stdin?.write?.(`${JSON.stringify(message)}\n`);
    } catch {}
  }

  #onLine(line) {
    if (!String(line).trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    if (message.method === "session/update" && message.id === undefined) {
      for (const handler of this.#updateHandlers) handler(message.params);
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
        .then((result) => this.#send({ jsonrpc: "2.0", id: message.id, result }))
        .catch((error) =>
          this.#send({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: -32000, message: error instanceof Error ? error.message : String(error) },
          }),
        );
      return;
    }

    if (message.id !== undefined) {
      const pending = this.#pending.get(message.id);
      if (!pending) return;
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

  #onExit(code, reason = null) {
    if (this.#closed) return;
    this.#closed = true;
    const error = reason instanceof Error
      ? reason
      : new Error(`ACP process exited unexpectedly (code ${code})`);
    if (!error.code) error.code = "ACP_PROCESS_EXIT";
    error.exitCode = code;
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
  }

  killImmediately(reason) {
    if (this.#closed) return;
    this.#closed = true;
    const error = reason instanceof Error ? reason : new Error(String(reason));
    for (const pending of this.#pending.values()) pending.reject(error);
    this.#pending.clear();
    this.#rl?.close();
    try {
      this.#proc.stdin?.destroy?.();
    } catch {}
    try {
      this.#proc.stdout?.destroy?.();
    } catch {}
    try {
      this.#proc.stderr?.destroy?.();
    } catch {}
    try {
      this.#proc.kill?.("SIGKILL");
    } catch {}
  }
}

async function spawnAcpClient(definition, options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const proc = options.spawnImpl(definition.command, definition.args ?? [], {
    cwd,
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const client = new JsonRpcAcpClient(proc);
  installDefaultHandlers(client, definition);
  try {
    await withTimeout(
      client.initialize(),
      options.initTimeoutMs ?? DEFAULT_INIT_TIMEOUT_MS,
      `${definition.displayName} ACP initialize timed out.`,
    );
  } catch (error) {
    client.killImmediately(error);
    throw error;
  }
  return client;
}

function installDefaultHandlers(client, definition) {
  client.onServerRequest("session/request_permission", async () =>
    definition.permissions?.autoApprove === false
      ? { approved: false }
      : JSON.parse(JSON.stringify(PERMISSION_APPROVAL_RESPONSE)),
  );
}

function installPermissionHandler(client, request) {
  client.onServerRequest("session/request_permission", async () =>
    resolveModeId(request) === "plan"
      ? { approved: false }
      : JSON.parse(JSON.stringify(PERMISSION_APPROVAL_RESPONSE)),
  );
}

function validateAcpDefinition(definition) {
  if (!definition?.id) throw new Error("ACP harness definition requires id.");
  if (!definition?.displayName) throw new Error(`ACP harness ${definition.id} requires displayName.`);
  if (!definition?.command) throw new Error(`ACP harness ${definition.id} requires command.`);
}

function resolveModeId(request) {
  const mode = String(request.mode ?? request.permissionMode ?? "").toLowerCase();
  return mode === "read-only" || mode === "readonly" || mode === "read" || mode === "plan"
    ? "plan"
    : "default";
}

async function optionalRequest(client, method, args) {
  try {
    return await client[method](...args);
  } catch {
    return null;
  }
}

function extractAcpResultText(result) {
  if (typeof result?.finalText === "string") return result.finalText.trim();
  if (typeof result?.text === "string") return result.text.trim();
  if (typeof result?.content?.text === "string") return result.content.text.trim();
  return "";
}

function stripPrivateProgressFields(event) {
  const { text: _text, ...publicEvent } = event;
  return publicEvent;
}

function availabilityUnavailable(definition, detail) {
  return {
    available: false,
    detail: `${definition.displayName} unavailable: ${detail}`,
    install: definition.install ?? null,
  };
}

function firstMeaningfulLine(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutHandle));
}
