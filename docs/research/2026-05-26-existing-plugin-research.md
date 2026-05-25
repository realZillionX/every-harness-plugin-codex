# Existing Plugin Research

Date：2026-05-26

Scope：read-only analysis of the installed local plugins used as current facts for `gemini-plugin-codex` and `cc-plugin-codex`。

## Source Availability

The historical Gemini working directories point to `/Users/zillionx/gemini-plugin-codex` and `/Users/zillionx/cc-plugin-codex`，but those directories are not present on this machine. The usable sources are the installed plugin copies：

- Gemini：`/Users/zillionx/.codex/plugins/cache/local-plugins/gemini/1.0.6`
- Claude Code：`/Users/zillionx/.codex/plugins/cache/local-plugins/cc/2.0.0`

The installed runtime copies also exist at：

- `/Users/zillionx/.codex/plugins/gemini`
- `/Users/zillionx/.codex/plugins/cc`

Neither installed copy is currently a Git repository. The cache packages also do not include the `tests/` directory even though both `package.json` files define test scripts.

## Common Plugin Shape

Both plugins share the same Codex-facing design：

- `.codex-plugin/plugin.json` declares plugin metadata and `skills: "./skills/"`。
- `skills/run`、`skills/status`、`skills/cancel`、`skills/setup` are the only recommended public Agent entry points。
- `scripts/*-companion.mjs` owns the companion CLI.
- `scripts/lib/` owns state, rendering, process, config, install, and harness-specific execution helpers.
- `hooks/hooks.json` registers `SessionStart`、`SessionEnd`、`Stop`、`UserPromptSubmit` hooks.
- `schemas/review-output.schema.json` supports structured review output.
- Normal public output is intentionally sanitized：foreground `run` returns the delegated final reply, but background completion and status output stay mailbox-only.

This shape is the main reuse target. The future project should avoid duplicating one full plugin per harness and instead make the harness-specific layer a narrow adapter.

## Gemini Plugin Findings

Gemini public manifest：`/Users/zillionx/.codex/plugins/cache/local-plugins/gemini/1.0.6/.codex-plugin/plugin.json`。

Gemini uses a companion CLI at `scripts/gemini-companion.mjs` with public subcommands `setup`、`run`、`status`、`cancel`。Legacy `review`、`task`、`result` paths remain internal and are not the ordinary public interface.

Gemini execution is ACP-based：

- `scripts/lib/acp-lifecycle.mjs` detects `--acp` versus `--experimental-acp` and spawns `gemini --acp`。
- `scripts/lib/acp-client.mjs` implements JSON-RPC calls such as `initialize`、`session/new`、`session/load`、`session/prompt`、`session/cancel`、`session/set_mode`、`session/set_model`。
- `scripts/lib/gemini.mjs` creates or resumes a session, listens for `agent_message_chunk` and `tool_call` updates, calls `client.prompt()`，then shuts the client down.

Gemini-specific assumptions：

- Binary name is `gemini`。
- Availability and auth checks currently revolve around `gemini --version`，which is weak for real auth validation.
- Model aliases are Gemini-specific, with default `gemini-3.1-pro-preview`。
- Write permission maps to ACP mode：`default` for write, `plan` for read-only.
- Non-plan permission requests are automatically approved with Gemini’s nested permission response shape.
- Review gate expects `ALLOW:` or `BLOCK:` text.
- Public skills hard-code the installed runtime path `/Users/zillionx/.codex/plugins/gemini`。

## Claude Code Plugin Findings

Claude Code public manifest：`/Users/zillionx/.codex/plugins/cache/local-plugins/cc/2.0.0/.codex-plugin/plugin.json`。

Claude Code uses a companion CLI at `scripts/claude-companion.mjs` with the same public subcommands：`setup`、`run`、`status`、`cancel`。

Claude execution is CLI-stream based：

- `scripts/lib/claude-cli.mjs` spawns `claude -p` for each invocation.
- It uses `--output-format stream-json`、`--verbose`、`--include-partial-messages` for progress and final output.
- `StreamParser` handles Claude event shapes such as `stream_event`、`system`、`result`、`session_id`、`structured_output`。
- Cancellation uses detached process groups and PID identity validation.

Claude-specific assumptions：

- Binary name is `claude`。
- Auth check is `claude auth status` unless `ANTHROPIC_API_KEY` is present.
- Model aliases are Claude-specific：`sonnet` and `haiku`。
- Effort values are Claude-specific：`low`、`medium`、`high`、`max`，with aliases from older naming.
- Read-only behavior relies on Claude sandbox settings and `allowedTools` strings.
- Tool progress and touched file detection depend on Claude tool names and stream event shapes.
- Public skills hard-code the installed runtime path `/Users/zillionx/.codex/plugins/cc`。

## Shared Runtime Candidates

These pieces should become harness-neutral：

- `JobStore`：workspace hash isolation, job files, logs, CAS transitions, current session marker, cleanup.
- `MailboxCommands`：common `setup`、`run`、`status`、`cancel` command parsing and flow.
- `BackgroundWorker`：queued jobs, worker spawn, worker request payload loading, terminal state recording.
- `MailboxRenderer`：compact human and JSON output that never leaks internal job IDs, log paths, PIDs, or raw stored results unless explicitly requested by a trusted internal command.
- `HookBridge`：session lifecycle, unread result notification, stop review gate entry point.
- `Installer`：marketplace registration, skill wrappers, hook installation, version sync.
- `ProcessControl`：PID identity, process group termination, cross-platform fallback.
- `CodexConfig`：enable `[features].hooks` and remove any deprecated `[features].codex_hooks` entries.

## Harness Adapter Boundary

A harness adapter should own only the moving parts that differ by harness：

```ts
interface HarnessAdapter {
  id: string;
  displayName: string;
  defaultModel?: string;

  checkAvailability(cwd: string): Promise<Availability>;
  checkAuth(cwd: string): Promise<AuthStatus>;
  normalizeModel(input?: string): string | undefined;
  normalizeEffort?(input?: string): string | undefined;

  runTurn(request: RunRequest, callbacks: RunCallbacks): Promise<RunResult>;
  cancel(request: CancelRequest): Promise<CancelResult>;

  runReview?(request: ReviewRequest, callbacks: RunCallbacks): Promise<RunResult>;
  sanitizeProgress(raw: unknown): ProgressEvent;
}
```

`RunResult` should normalize all harness outputs to：

- `exitStatus`
- `sessionId`
- `finalText`
- `structuredOutput`
- `touchedFiles`
- `progressSummary`
- `providerMetadata` for private storage only

## Official Codex Plugin And Hook Constraints

Official Codex plugin docs state that a plugin manifest lives at `.codex-plugin/plugin.json`，can point to `skills`、`mcpServers`、`apps`、`hooks`，and keeps component paths relative to the plugin root. Plugins can also include a default `hooks/hooks.json` file.

Official hook docs state that Codex can load plugin-bundled hooks, hook paths resolve relative to the plugin root, and plugin hook commands receive `PLUGIN_ROOT` and `PLUGIN_DATA`。Plugin-bundled hooks use the same trust review flow as non-managed hooks.

The current Hook feature flag must be `[features].hooks`。The deprecated `[features].codex_hooks` key must not be generated. The existing local Codex config already has：

```toml
[features]
hooks = true
```

## Risks

- Generality risk：a truly arbitrary Harness still needs either a native adapter or a standard command profile. “Any Harness” should mean adapter-extensible, not magic inference of unknown protocols.
- Security risk：Gemini auto-approves permission requests outside plan mode. A generic runtime must make permission policy explicit per adapter.
- Auth risk：adapter readiness must distinguish binary presence from real ability to run an agent turn.
- Protocol drift risk：Gemini ACP and Claude stream-json can change independently.
- Cancellation risk：session cancellation and process cancellation have different guarantees by harness.
- State migration risk：combining two plugin namespaces into one `every-harness` namespace needs an explicit migration or a clean break.
- Hook trust risk：plugin-bundled hooks may need user review before running; setup output must be clear and must not assume hook execution before trust.
- Packaging risk：hard-coded installed paths should be eliminated or generated at install time.

## Research Conclusion

The right integration path is not “merge two companion files”。It is to extract a shared mailbox runtime and reimplement Gemini and Claude Code as first-class adapters. After that, new harnesses can be added by implementing a narrow adapter contract or, for simpler CLIs, by declaring a command adapter profile.
