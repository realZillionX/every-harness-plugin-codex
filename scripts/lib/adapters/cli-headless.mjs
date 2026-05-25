import { spawn as nodeSpawn, spawnSync as nodeSpawnSync } from "node:child_process";
import process from "node:process";

const DEFAULT_AVAILABILITY_TIMEOUT_MS = 5000;
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024;
const DEFAULT_MAX_UNKNOWN_EVENTS = 100;

function normalizeOptionalString(value) {
  if (value == null) {
    return undefined;
  }
  const normalized = String(value).trim();
  return normalized || undefined;
}

function firstMeaningfulLine(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function sliceTextTailByBytes(text, maxBytes) {
  const normalized = typeof text === "string" ? text : String(text ?? "");
  if (!normalized || maxBytes <= 0) {
    return "";
  }
  if (Buffer.byteLength(normalized, "utf8") <= maxBytes) {
    return normalized;
  }

  let low = 0;
  let high = normalized.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (Buffer.byteLength(normalized.slice(mid), "utf8") > maxBytes) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return normalized.slice(low);
}

function appendTextTail(existing, chunk, maxBytes) {
  return sliceTextTailByBytes(`${existing ?? ""}${chunk ?? ""}`, maxBytes);
}

function resolveCommand(command) {
  if (Array.isArray(command) && command.length > 0) {
    const [bin, ...prefixArgs] = command.map(String);
    return { bin, prefixArgs };
  }
  return { bin: String(command ?? ""), prefixArgs: [] };
}

function pushBoundedTail(list, value, maxEntries) {
  list.push(value);
  if (list.length > maxEntries) {
    list.splice(0, list.length - maxEntries);
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value ?? {}, key);
}

function replaceTemplate(value, variables) {
  if (typeof value !== "string") {
    return String(value);
  }
  return value.replaceAll("{prompt}", variables.prompt).replaceAll("{model}", variables.model ?? "");
}

function maybePushModelArg(args, model, definition) {
  if (!model || !definition.modelFlag) {
    return;
  }
  if (Array.isArray(definition.modelFlag)) {
    args.push(...definition.modelFlag.map(String), String(model));
    return;
  }
  args.push(String(definition.modelFlag), String(model));
}

export function buildCliHeadlessArgs(prompt, options = {}) {
  const definition = options.definition ?? options;
  const normalizedPrompt = String(prompt ?? "");
  const model = normalizeOptionalString(options.model);

  if (typeof definition.buildArgs === "function") {
    return definition.buildArgs({
      ...options.request,
      prompt: normalizedPrompt,
      model,
    }).map(String);
  }

  const configuredArgs =
    typeof definition.args === "function"
      ? definition.args({ ...options.request, prompt: normalizedPrompt, model })
      : definition.args ?? [];
  const args = [];
  let hasPromptTemplate = false;
  let hasModelTemplate = false;

  for (const arg of configuredArgs) {
    const raw = String(arg);
    hasPromptTemplate ||= raw.includes("{prompt}");
    hasModelTemplate ||= raw.includes("{model}");
    args.push(replaceTemplate(raw, { prompt: normalizedPrompt, model }));
  }

  if (!hasModelTemplate) {
    maybePushModelArg(args, model, definition);
  }

  if (
    definition.promptPlacement !== "stdin" &&
    definition.promptPlacement !== "none" &&
    !hasPromptTemplate
  ) {
    if (definition.promptSeparator) {
      args.push(String(definition.promptSeparator));
    }
    args.push(normalizedPrompt);
  }

  return args;
}

export class CliHeadlessStreamJsonParser {
  constructor(options = {}) {
    this.buffer = "";
    this.maxUnknownEvents = options.maxUnknownEvents ?? DEFAULT_MAX_UNKNOWN_EVENTS;
    this.state = {
      finalText: "",
      structuredOutput: null,
      sessionId: null,
      events: [],
      parseErrors: [],
    };
  }

  feed(chunk) {
    this.buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk ?? "");
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines.map((line) => this.#parseLine(line)).filter(Boolean);
  }

  flush() {
    if (!this.buffer.trim()) {
      this.buffer = "";
      return [];
    }
    const event = this.#parseLine(this.buffer);
    this.buffer = "";
    return event ? [event] : [];
  }

  #parseLine(line) {
    if (!line.trim()) {
      return null;
    }

    try {
      const event = JSON.parse(line);
      this.#captureSessionId(event);
      this.#captureStructuredOutput(event);

      const text = extractStreamJsonText(event);
      if (text) {
        this.state.finalText += text;
        return {
          kind: "text",
          text,
          message: text,
          phase: "responding",
          threadId: this.state.sessionId,
        };
      }

      pushBoundedTail(this.state.events, event, this.maxUnknownEvents);
      return null;
    } catch (error) {
      const parseError = {
        line: line.slice(0, 200),
        error: error instanceof Error ? error.message : String(error),
      };
      pushBoundedTail(this.state.parseErrors, parseError, this.maxUnknownEvents);
      pushBoundedTail(
        this.state.events,
        { type: "parse_error", ...parseError },
        this.maxUnknownEvents,
      );
      return null;
    }
  }

  #captureSessionId(event) {
    const sessionId =
      event?.sessionId ??
      event?.session_id ??
      event?.threadId ??
      event?.thread_id ??
      event?.message?.sessionId ??
      event?.message?.session_id ??
      null;
    if (sessionId && !this.state.sessionId) {
      this.state.sessionId = String(sessionId);
    }
  }

  #captureStructuredOutput(event) {
    if (hasOwn(event, "structuredOutput")) {
      this.state.structuredOutput = event.structuredOutput ?? null;
    } else if (hasOwn(event, "structured_output")) {
      this.state.structuredOutput = event.structured_output ?? null;
    }
  }
}

export function extractStreamJsonText(event) {
  if (!event || typeof event !== "object") {
    return "";
  }

  const chunks = [];
  collectText(event, chunks, new Set());
  return chunks.join("");
}

function collectText(value, chunks, seen) {
  if (value == null) {
    return;
  }
  if (typeof value === "string") {
    return;
  }
  if (typeof value !== "object") {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (typeof value.text === "string") {
    chunks.push(value.text);
  }
  if (typeof value.content === "string") {
    chunks.push(value.content);
  }
  if (typeof value.delta === "string") {
    chunks.push(value.delta);
  }

  for (const key of ["delta", "content", "message", "assistant", "choice"]) {
    const child = value[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        collectText(item, chunks, seen);
      }
    } else {
      collectText(child, chunks, seen);
    }
  }

  if (Array.isArray(value.choices)) {
    for (const choice of value.choices) {
      collectText(choice, chunks, seen);
    }
  }
}

export function createCliHeadlessAdapter(definition, options = {}) {
  validateDefinition(definition);

  const command = resolveCommand(definition.command);
  const spawnImpl = options.spawnImpl ?? nodeSpawn;
  const spawnSyncImpl = options.spawnSyncImpl ?? nodeSpawnSync;
  const killImpl = options.killImpl ?? process.kill.bind(process);
  const baseEnv = options.env ?? process.env;
  const outputMode = definition.outputMode ?? "text";

  function commandArgs(args) {
    return [...command.prefixArgs, ...args];
  }

  async function checkAvailability(context = {}) {
    const probe = definition.probe ?? {
      command: command.bin,
      args: definition.probeArgs ?? ["--version"],
    };
    try {
      const result = spawnSyncImpl(probe.command, probe.args ?? [], {
        cwd: context.cwd,
        env: context.env ?? baseEnv,
        encoding: "utf8",
        timeout:
          definition.probeTimeoutMs ??
          options.availabilityTimeoutMs ??
          DEFAULT_AVAILABILITY_TIMEOUT_MS,
      });
      if (result?.error) {
        return availabilityUnavailable(definition, result.error.message);
      }
      if (result?.status !== 0 && definition.requiresSuccessfulProbe !== false) {
        return availabilityUnavailable(
          definition,
          firstMeaningfulLine(result?.stderr) ??
            firstMeaningfulLine(result?.stdout) ??
            `probe exited with ${result?.status ?? "unknown"}`,
        );
      }
      return {
        available: true,
        detail:
          firstMeaningfulLine(result?.stdout) ??
          firstMeaningfulLine(result?.stderr) ??
          `${definition.displayName} probe succeeded.`,
        install: definition.install ?? null,
      };
    } catch (error) {
      return availabilityUnavailable(
        definition,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async function checkAuth(context = {}) {
    const env = context.env ?? baseEnv;
    const envKeys = definition.auth?.envKeys ?? [];
    const foundEnvKeys = envKeys.filter((key) => Boolean(env[key]));
    if (envKeys.length > 0) {
      return {
        loggedIn: foundEnvKeys.length > 0,
        authenticated: foundEnvKeys.length > 0,
        confidence: foundEnvKeys.length > 0 ? "env" : "unknown",
        detail:
          foundEnvKeys.length > 0
            ? `Auth environment detected: ${foundEnvKeys.join(", ")}.`
            : `No auth environment detected. Configure one of: ${envKeys.join(", ")}.`,
      };
    }
    return {
      loggedIn: null,
      authenticated: null,
      confidence: "unknown",
      detail: definition.auth?.detail ?? "Authentication is delegated to the harness CLI.",
    };
  }

  async function runTurn(request = {}, callbacks = {}) {
    const prompt = String(request.prompt ?? "");
    if (!prompt.trim()) {
      throw new Error(`${definition.displayName} CLI adapter requires a prompt.`);
    }

    const args = buildCliHeadlessArgs(prompt, {
      definition,
      model: request.model ?? definition.defaultModel,
      request,
    });
    const cwd = request.cwd ?? process.cwd();
    const env = { ...baseEnv, ...(definition.env ?? {}), ...(request.env ?? {}) };

    return new Promise((resolve) => {
      let settled = false;
      const child = spawnImpl(command.bin, commandArgs(args), {
        cwd,
        env,
        detached: definition.detached ?? true,
        stdio: [
          definition.promptPlacement === "stdin" ? "pipe" : "ignore",
          "pipe",
          "pipe",
        ],
      });

      callbacks.onSpawn?.({ pid: child.pid });

      let stdout = "";
      let stderr = "";
      const parser =
        outputMode === "stream-json"
          ? new CliHeadlessStreamJsonParser({
              maxUnknownEvents: definition.maxUnknownEvents,
            })
          : null;

      child.stdout?.setEncoding?.("utf8");
      child.stdout?.on?.("data", (chunk) => {
        if (parser) {
          for (const event of parser.feed(chunk)) {
            callbacks.onProgress?.(event);
          }
          return;
        }
        stdout += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk ?? "");
      });

      child.stderr?.setEncoding?.("utf8");
      child.stderr?.on?.("data", (chunk) => {
        stderr = appendTextTail(
          stderr,
          chunk,
          definition.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES,
        );
      });

      child.on?.("close", (code) => {
        if (settled) {
          return;
        }
        settled = true;
        if (parser) {
          for (const event of parser.flush()) {
            callbacks.onProgress?.(event);
          }
        }

        const finalText = parser ? parser.state.finalText : stdout;
        const structuredOutput = parser
          ? {
              ...(parser.state.structuredOutput ?? {}),
              events: parser.state.events,
              parseErrors: parser.state.parseErrors,
            }
          : null;
        const status = code === 0 ? "completed" : "failed";
        resolve({
          status,
          exitCode: code,
          finalText,
          finalMessage: finalText,
          output: finalText,
          structuredOutput,
          sessionId: parser?.state.sessionId ?? null,
          threadId: parser?.state.sessionId ?? null,
          stderr,
          pid: child.pid,
          processRef: Number.isFinite(Number(child.pid))
            ? { pid: Number(child.pid), pidIdentity: null }
            : null,
          providerMetadata: {
            harness: definition.id,
            command: command.bin,
            args,
            outputMode,
            model: normalizeOptionalString(request.model ?? definition.defaultModel) ?? null,
          },
        });
      });

      child.on?.("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({
          status: "failed",
          exitCode: -1,
          finalText: "",
          finalMessage: "",
          output: "",
          structuredOutput: parser
            ? { events: parser.state.events, parseErrors: parser.state.parseErrors }
            : null,
          sessionId: parser?.state.sessionId ?? null,
          threadId: parser?.state.sessionId ?? null,
          stderr: error instanceof Error ? error.message : String(error),
          pid: child.pid,
          processRef: Number.isFinite(Number(child.pid))
            ? { pid: Number(child.pid), pidIdentity: null }
            : null,
          providerMetadata: {
            harness: definition.id,
            command: command.bin,
            args,
            outputMode,
            model: normalizeOptionalString(request.model ?? definition.defaultModel) ?? null,
          },
        });
      });

      if (definition.promptPlacement === "stdin") {
        child.stdin?.end?.(prompt);
      }
      if (request.background) {
        child.unref?.();
      }
    });
  }

  async function cancel(request = {}) {
    const pid = Number(request.pid ?? request.processRef?.pid ?? request.providerMetadata?.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
      const sessionId =
        request.sessionId ??
        request.threadId ??
        request.providerMetadata?.sessionId ??
        request.providerMetadata?.threadId ??
        null;
      if (sessionId) {
        return {
          cancelled: false,
          status: "failed",
          detail: `${definition.displayName} does not expose protocol-level cancellation for session ${sessionId}; provide a process id to terminate the running CLI.`,
        };
      }
      return {
        cancelled: false,
        status: "failed",
        detail: `missing ${definition.displayName} process id`,
      };
    }

    try {
      killImpl(definition.detached === false ? pid : -pid, request.signal ?? "SIGTERM");
      return { cancelled: true, status: "cancelled" };
    } catch (error) {
      if (error?.code === "ESRCH") {
        return {
          cancelled: true,
          status: "cancelled",
          detail: "process already exited",
        };
      }
      return {
        cancelled: false,
        status: "failed",
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
    protocol: definition.protocol ?? "cli-headless",
    source: definition.source ?? null,
    outputMode,
    install: definition.install ?? null,
    checkAvailability,
    checkAuth,
    normalizeModel(input) {
      return normalizeOptionalString(input) ?? definition.defaultModel ?? undefined;
    },
    buildArgs(prompt, request = {}) {
      return buildCliHeadlessArgs(prompt, { definition, model: request.model, request });
    },
    runTurn,
    cancel,
  };
}

function availabilityUnavailable(definition, detail) {
  return {
    available: false,
    detail: detail || `${definition.displayName} CLI unavailable.`,
    install: definition.install ?? null,
  };
}

function validateDefinition(definition) {
  if (!definition || typeof definition !== "object") {
    throw new TypeError("CLI headless adapter definition is required.");
  }
  for (const key of ["id", "displayName", "command"]) {
    if (!normalizeOptionalString(definition[key])) {
      throw new TypeError(`CLI headless adapter definition requires ${key}.`);
    }
  }
  const outputMode = definition.outputMode ?? "text";
  if (!["text", "stream-json"].includes(outputMode)) {
    throw new TypeError(`Unsupported CLI headless output mode: ${outputMode}`);
  }
}
