import { spawn, spawnSync } from "node:child_process";
import { getProcessIdentity, validateProcessIdentity } from "../runtime/process-control.mjs";

const CLAUDE_BIN = "claude";
const DEFAULT_AVAILABILITY_TIMEOUT_MS = 10_000;
const MAX_STREAM_PARSER_UNKNOWN_EVENTS = 50;
const MAX_STREAM_PARSER_PARSE_ERRORS = 50;
const MAX_STREAM_PARSER_TOOL_USES = 256;
const MAX_STREAM_PARSER_TOUCHED_FILES = 256;
const MAX_STDERR_BYTES = 64 * 1024;

export const MODEL_ALIASES = new Map([
  ["sonnet", "claude-sonnet-4-6"],
  ["haiku", "claude-haiku-4-5"],
]);

export const EFFORT_ALIASES = new Map([
  ["none", "low"],
  ["minimal", "low"],
  ["xhigh", "max"],
]);

export const VALID_EFFORTS = new Set(["low", "medium", "high", "max"]);

export const CLAUDE_READ_ONLY_TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git show:*)",
  "Bash(git blame:*)",
  "Bash(git rev-parse:*)",
  "Bash(git branch:*)",
  "Bash(git ls-files:*)",
  "Bash(git merge-base:*)",
  "Bash(git describe:*)",
  "Bash(git shortlog:*)",
  "Bash(git cat-file:*)",
  "Bash(git tag --list:*)",
  "Bash(git stash list:*)",
  "Bash(git config --get:*)",
  "WebSearch",
  "WebFetch",
  "Agent(explore,plan)",
];

function pushBoundedTail(list, value, maxEntries) {
  list.push(value);
  if (list.length > maxEntries) {
    list.splice(0, list.length - maxEntries);
  }
}

function pushUniqueBoundedTail(list, value, maxEntries) {
  if (!value || list.includes(value)) {
    return;
  }
  pushBoundedTail(list, value, maxEntries);
}

function normalizeOptionalString(value) {
  if (value == null) {
    return undefined;
  }
  const normalized = String(value).trim();
  return normalized || undefined;
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

function mergeTerminalResultText(existingText, terminalText) {
  const existing = typeof existingText === "string" ? existingText : "";
  const terminal = typeof terminalText === "string" ? terminalText : "";

  if (!terminal) {
    return existing;
  }
  if (!existing) {
    return terminal;
  }
  if (existing.endsWith(terminal) && existing.length > terminal.length) {
    return existing;
  }
  return terminal;
}

function stringifyCliJson(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function resolveCommand(command) {
  if (Array.isArray(command) && command.length > 0) {
    const [bin, ...prefixArgs] = command.map(String);
    return { bin, prefixArgs };
  }
  return { bin: command ? String(command) : CLAUDE_BIN, prefixArgs: [] };
}

export function resolveClaudeModel(model) {
  const normalized = normalizeOptionalString(model);
  if (!normalized) {
    return undefined;
  }
  return MODEL_ALIASES.get(normalized.toLowerCase()) ?? normalized;
}

export function resolveClaudeEffort(effort) {
  const normalized = normalizeOptionalString(effort)?.toLowerCase();
  if (!normalized) {
    return undefined;
  }
  const resolved = EFFORT_ALIASES.get(normalized) ?? normalized;
  if (VALID_EFFORTS.has(resolved)) {
    return resolved;
  }
  throw new Error(
    `Unsupported Claude effort "${effort}". Use one of: ${[...VALID_EFFORTS].join(", ")}.`
  );
}

function isReadOnlyMode(mode) {
  return ["read", "read-only", "readonly", "plan"].includes(String(mode ?? "").toLowerCase());
}

export class StreamParser {
  constructor() {
    this.buffer = "";
    this.state = {
      sessionId: null,
      finalMessage: "",
      structuredOutput: null,
      receivedTerminalEvent: false,
      unknownEvents: [],
      parseErrors: [],
      unresolvedParseErrors: 0,
      toolUses: [],
      touchedFiles: [],
    };
  }

  feed(chunk) {
    this.buffer += Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk ?? "");
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";
    return lines.map((line) => this._parseLine(line)).filter(Boolean);
  }

  flush() {
    if (!this.buffer.trim()) {
      this.buffer = "";
      return [];
    }
    const event = this._parseLine(this.buffer);
    this.buffer = "";
    return event ? [event] : [];
  }

  _parseLine(line) {
    if (!line.trim()) {
      return null;
    }

    try {
      const event = JSON.parse(line);
      this._captureSessionId(event);

      switch (event.type) {
        case "stream_event":
          return this._handleStreamEvent(event);
        case "assistant":
          return this._handleAssistantEvent(event);
        case "system":
          return this._handleSystemEvent(event);
        case "result":
          return this._handleResultEvent(event);
        default:
          pushBoundedTail(
            this.state.unknownEvents,
            { type: event.type ?? null, at: Date.now() },
            MAX_STREAM_PARSER_UNKNOWN_EVENTS
          );
          return null;
      }
    } catch (error) {
      this.state.unresolvedParseErrors += 1;
      pushBoundedTail(
        this.state.parseErrors,
        {
          line: line.slice(0, 200),
          error: error instanceof Error ? error.message : String(error),
        },
        MAX_STREAM_PARSER_PARSE_ERRORS
      );
      return null;
    }
  }

  _captureSessionId(event) {
    const sessionId = event?.session_id ?? event?.sessionId ?? event?.message?.session_id;
    if (sessionId && !this.state.sessionId) {
      this.state.sessionId = sessionId;
    }
  }

  _handleStreamEvent(event) {
    const inner = event.event;
    const directDelta = inner?.delta;
    if (directDelta?.type === "text_delta" && directDelta.text) {
      return this._recordText(directDelta.text);
    }

    if (inner?.type === "content_block_delta") {
      const blockDelta = inner.delta;
      if (blockDelta?.type === "text_delta" && blockDelta.text) {
        return this._recordText(blockDelta.text);
      }
      if (blockDelta?.type === "thinking_delta" && blockDelta.thinking) {
        return {
          kind: "thinking",
          message: blockDelta.thinking,
          phase: "responding",
          threadId: this.state.sessionId,
        };
      }
    }

    if (inner?.type === "content_block_start") {
      return this._recordContentBlock(inner.content_block);
    }
    return null;
  }

  _handleAssistantEvent(event) {
    const content = Array.isArray(event.message?.content) ? event.message.content : [];
    const emitted = [];
    for (const block of content) {
      if (block?.type === "text" && block.text) {
        emitted.push(this._recordText(block.text));
      } else if (block?.type === "tool_use") {
        emitted.push(this._recordToolUse(block.name, block.input));
      }
    }
    return emitted.filter(Boolean).at(-1) ?? null;
  }

  _handleSystemEvent(event) {
    if (event.subtype === "api_retry") {
      return {
        kind: "retry",
        subtype: "api_retry",
        message: "API retry in progress",
        phase: "retry",
        threadId: this.state.sessionId,
      };
    }
    return null;
  }

  _handleResultEvent(event) {
    this.state.receivedTerminalEvent = true;
    this._captureSessionId(event);
    if (Object.prototype.hasOwnProperty.call(event, "result")) {
      this.state.finalMessage = mergeTerminalResultText(
        this.state.finalMessage,
        event.result
      );
    }
    if (Object.prototype.hasOwnProperty.call(event, "structured_output")) {
      this.state.structuredOutput = event.structured_output ?? null;
    }
    return {
      kind: "result",
      message: this.state.finalMessage,
      finalMessage: this.state.finalMessage,
      structuredOutput: this.state.structuredOutput,
      phase: "done",
      threadId: this.state.sessionId,
    };
  }

  _recordContentBlock(block) {
    if (block?.type !== "tool_use") {
      return null;
    }
    return this._recordToolUse(block.name, block.input);
  }

  _recordText(text) {
    this.state.finalMessage += text;
    return {
      kind: "text",
      text,
      message: text,
      phase: "responding",
      threadId: this.state.sessionId,
    };
  }

  _recordToolUse(tool, input) {
    pushBoundedTail(
      this.state.toolUses,
      { tool, input },
      MAX_STREAM_PARSER_TOOL_USES
    );
    if (tool === "Write" || tool === "Edit" || tool === "MultiEdit") {
      pushUniqueBoundedTail(
        this.state.touchedFiles,
        input?.file_path ?? input?.path ?? null,
        MAX_STREAM_PARSER_TOUCHED_FILES
      );
    }
    return {
      kind: "tool",
      tool,
      input,
      message: tool ? `Using tool: ${tool}` : "Using tool.",
      phase: "tool",
      threadId: this.state.sessionId,
      touchedFiles: [...this.state.touchedFiles],
    };
  }
}

export function validateClaudeTurnCompletion(state, exitCode) {
  if (exitCode !== 0) {
    return { status: "failed", exitCode };
  }
  if (state.unresolvedParseErrors > 0) {
    return {
      status: "unknown",
      warning: `${state.unresolvedParseErrors} unrecovered parse errors`,
    };
  }
  if (!state.receivedTerminalEvent) {
    return {
      status: "unknown",
      warning: "No terminal result event received despite exit code 0",
    };
  }
  return { status: "completed" };
}

export function buildClaudeArgs(prompt, options = {}) {
  const args = ["-p"];
  const outputFormat = options.outputFormat ?? "stream-json";

  if (outputFormat === "stream-json") {
    args.push(
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages"
    );
  } else {
    args.push("--output-format", outputFormat);
  }

  if (options.noSessionPersistence) {
    args.push("--no-session-persistence");
  }
  if (options.model) {
    args.push("--model", resolveClaudeModel(options.model));
  }
  if (options.effort) {
    args.push("--effort", resolveClaudeEffort(options.effort));
  }
  if (options.sessionId) {
    args.push("--session-id", String(options.sessionId));
  }
  if (options.resumeSessionId) {
    args.push("--resume", String(options.resumeSessionId));
  }

  const allowedTools =
    options.allowedTools ?? (isReadOnlyMode(options.mode) || options.readOnly ? CLAUDE_READ_ONLY_TOOLS : null);
  if (Array.isArray(allowedTools)) {
    for (const tool of allowedTools) {
      args.push("--allowedTools", String(tool));
    }
  }

  if (options.maxTurns) {
    args.push("--max-turns", String(options.maxTurns));
  }
  if (options.jsonSchema) {
    args.push("--json-schema", stringifyCliJson(options.jsonSchema));
  }
  if (options.systemPrompt) {
    args.push("--system-prompt", String(options.systemPrompt));
  }
  if (options.permissionMode) {
    args.push("--permission-mode", String(options.permissionMode));
  }
  if (options.settingsFile) {
    args.push("--settings", String(options.settingsFile));
  }

  args.push("--", String(prompt ?? ""));
  return args;
}

export function createClaudeCodeAdapter(options = {}) {
  const command = resolveCommand(options.command);
  const spawnImpl = options.spawnImpl ?? spawn;
  const spawnSyncImpl = options.spawnSyncImpl ?? spawnSync;
  const killImpl = options.killImpl ?? process.kill.bind(process);
  const env = options.env ?? process.env;

  function commandArgs(args) {
    return [...command.prefixArgs, ...args];
  }

  async function checkAvailability(context = {}) {
    try {
      const result = spawnSyncImpl(command.bin, commandArgs(["--version"]), {
        cwd: context.cwd,
        encoding: "utf8",
        timeout: options.availabilityTimeoutMs ?? DEFAULT_AVAILABILITY_TIMEOUT_MS,
        env: context.env ?? env,
      });
      if (result.status !== 0) {
        return {
          available: false,
          detail: (result.stderr || result.stdout || "claude CLI returned a non-zero status").trim(),
        };
      }
      return {
        available: true,
        detail: (result.stdout || result.stderr || "claude CLI available").trim(),
      };
    } catch {
      return { available: false, detail: "claude CLI not found in PATH" };
    }
  }

  async function checkAuth(context = {}) {
    const authEnv = context.env ?? env;
    if (authEnv.ANTHROPIC_API_KEY) {
      return { available: true, loggedIn: true, detail: "API key configured" };
    }

    try {
      const result = spawnSyncImpl(command.bin, commandArgs(["auth", "status"]), {
        cwd: context.cwd,
        encoding: "utf8",
        timeout: options.availabilityTimeoutMs ?? DEFAULT_AVAILABILITY_TIMEOUT_MS,
        env: authEnv,
      });
      if (result.status !== 0) {
        return {
          available: true,
          loggedIn: false,
          detail: (result.stderr || result.stdout || "not authenticated").trim(),
        };
      }
      return { available: true, loggedIn: true, detail: "authenticated" };
    } catch {
      return {
        available: true,
        loggedIn: false,
        detail: "not authenticated - run `claude auth login`",
      };
    }
  }

  async function runTurn(request = {}, callbacks = {}) {
    const args = buildClaudeArgs(request.prompt, {
      outputFormat: "stream-json",
      ...request,
    });

    return new Promise((resolve) => {
      const child = spawnImpl(command.bin, commandArgs(args), {
        cwd: request.cwd,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: request.env ?? env,
      });
      const pidIdentity = getProcessIdentity(child.pid);
      callbacks.onSpawn?.({ pid: child.pid, pidIdentity });

      const parser = new StreamParser();
      let stderr = "";

      child.stdout?.setEncoding?.("utf8");
      child.stdout?.on?.("data", (chunk) => {
        for (const event of parser.feed(chunk)) {
          callbacks.onProgress?.(event);
        }
      });

      child.stderr?.setEncoding?.("utf8");
      child.stderr?.on?.("data", (chunk) => {
        stderr = appendTextTail(stderr, chunk, MAX_STDERR_BYTES);
      });

      child.on("close", (code) => {
        for (const event of parser.flush()) {
          callbacks.onProgress?.(event);
        }
        const validation = validateClaudeTurnCompletion(parser.state, code ?? 1);
        resolve({
          status: validation.status,
          warning: validation.warning,
          exitCode: code,
          sessionId: parser.state.sessionId,
          finalText: parser.state.finalMessage,
          finalMessage: parser.state.finalMessage,
          structuredOutput: parser.state.structuredOutput,
          toolUses: parser.state.toolUses,
          touchedFiles: parser.state.touchedFiles,
          stderr,
          pid: child.pid,
          processRef: Number.isFinite(Number(child.pid)) ? { pid: Number(child.pid), pidIdentity } : null,
        });
      });

      child.on("error", (error) => {
        resolve({
          status: "failed",
          exitCode: -1,
          sessionId: null,
          finalText: "",
          finalMessage: "",
          structuredOutput: null,
          toolUses: [],
          touchedFiles: [],
          stderr: error instanceof Error ? error.message : String(error),
          pid: child.pid,
        });
      });

      if (request.background) {
        child.unref?.();
      }
    });
  }

  async function cancel(request = {}) {
    const pid = Number(request.pid ?? request.processRef?.pid);
    if (!Number.isInteger(pid) || pid <= 0) {
      return { cancelled: false, status: "failed", detail: "missing Claude process id" };
    }
    try {
      const identity = request.pidIdentity ?? request.processRef?.pidIdentity ?? null;
      if (!validateProcessIdentity(pid, identity)) {
        return {
          cancelled: false,
          status: "failed",
          detail: `Claude process identity did not match; refusing to terminate PID ${pid}.`,
        };
      }
      killImpl(-pid, request.signal ?? "SIGTERM");
      return { cancelled: true, status: "cancelled" };
    } catch (error) {
      if (error?.code === "ESRCH") {
        return { cancelled: true, status: "cancelled", detail: "process already exited" };
      }
      return {
        cancelled: false,
        status: "failed",
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    id: "claude-code",
    aliases: ["claude"],
    displayName: "Claude Code",
    defaultModel: MODEL_ALIASES.get("sonnet"),
    checkAvailability,
    checkAuth,
    normalizeModel: resolveClaudeModel,
    normalizeEffort: resolveClaudeEffort,
    buildArgs: buildClaudeArgs,
    runTurn,
    cancel,
  };
}
