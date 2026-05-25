# Every Harness Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL：Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Codex plugin that delegates to multiple external agent harnesses through one mailbox runtime.

**Architecture:** Implement `MailboxRuntime` once and connect harness-specific behavior through `HarnessAdapter` implementations. Start with a fake adapter for tests, then port `gemini-acp` and `claude-cli`。

**Tech Stack:** Node.js ESM, `node:test`，Codex plugin manifest, Codex skills, Codex lifecycle hooks.

---

## Planned File Structure

- Create `.codex-plugin/plugin.json`：plugin manifest.
- Create `package.json`：package metadata, scripts, files, Node version.
- Create `README.md`：usage, install, privacy, development.
- Create `CHANGELOG.md`、`LICENSE`、`NOTICE`：release metadata.
- Create `skills/run/SKILL.md`、`skills/status/SKILL.md`、`skills/cancel/SKILL.md`、`skills/setup/SKILL.md`。
- Create `scripts/every-harness-companion.mjs`：CLI dispatcher.
- Create `scripts/lib/runtime/args.mjs`：argument parsing.
- Create `scripts/lib/runtime/job-store.mjs`：workspace-scoped job state and CAS.
- Create `scripts/lib/runtime/mailbox-runtime.mjs`：common command flow.
- Create `scripts/lib/runtime/render.mjs`：sanitized output.
- Create `scripts/lib/runtime/process-control.mjs`：PID identity and termination.
- Create `scripts/lib/runtime/codex-config.mjs`：`[features].hooks` config repair.
- Create `scripts/lib/runtime/hooks.mjs`：hook shared helpers.
- Create `scripts/lib/adapters/registry.mjs`：adapter registration and selection.
- Create `scripts/lib/adapters/fake.mjs`：deterministic test adapter.
- Create `scripts/lib/adapters/gemini-acp.mjs`：Gemini ACP adapter.
- Create `scripts/lib/adapters/claude-cli.mjs`：Claude Code CLI adapter.
- Create `hooks/hooks.json`、`hooks/session-lifecycle-hook.mjs`、`hooks/unread-result-hook.mjs`、`hooks/stop-review-gate-hook.mjs`。
- Create `tests/*.test.mjs`：unit and integration tests.

## Task 1：Scaffold Plugin Package

**Files:**
- Create：`.codex-plugin/plugin.json`
- Create：`package.json`
- Create：`README.md`
- Create：`CHANGELOG.md`
- Create：`LICENSE`
- Create：`NOTICE`

- [ ] Create `.codex-plugin/plugin.json` with `name: "every-harness"`，`version: "0.1.0"`，`skills: "./skills/"`，and `hooks: "./hooks/hooks.json"`。
- [ ] Create `package.json` with ESM enabled and scripts：`test`、`lint`、`typecheck`、`check`、`pack:dry-run`。
- [ ] Add README sections：purpose, requirements, quick start, public commands, adapters, hooks, privacy, development.
- [ ] Run：`node -e 'JSON.parse(require("fs").readFileSync(".codex-plugin/plugin.json","utf8")); JSON.parse(require("fs").readFileSync("package.json","utf8"));'`
- [ ] Expected：the command exits with code `0`。

## Task 2：Create Public Skills

**Files:**
- Create：`skills/run/SKILL.md`
- Create：`skills/status/SKILL.md`
- Create：`skills/cancel/SKILL.md`
- Create：`skills/setup/SKILL.md`

- [ ] Add `run` skill instructions that call `node "<installed-plugin-root>/scripts/every-harness-companion.mjs" run <arguments>`。
- [ ] Add `status` skill instructions that call the companion `status` command.
- [ ] Add `cancel` skill instructions that call the companion `cancel` command.
- [ ] Add `setup` skill instructions that call `setup --json` first, install or repair hooks when needed, then run final user-facing `setup`。
- [ ] Include the explicit rule：hook setup must enable `[features].hooks`，not `[features].codex_hooks`。
- [ ] Run：`rg -n "codex_hooks|every-harness-companion|features\\.hooks" skills`
- [ ] Expected：only the deprecation warning text mentions `codex_hooks`，and each skill references the companion.

## Task 3：Implement Runtime Argument Parsing

**Files:**
- Create：`scripts/lib/runtime/args.mjs`
- Create：`tests/args.test.mjs`

- [ ] Write failing tests for raw slash-command argument splitting, `--harness` parsing, boolean flags, value flags, aliases, and `--prompt-file`。
- [ ] Implement `splitRawArgumentString()` and `parseArgs()` using a deterministic tokenizer that preserves quoted text.
- [ ] Run：`node --test tests/args.test.mjs`
- [ ] Expected：all parser tests pass.

## Task 4：Implement Job Store

**Files:**
- Create：`scripts/lib/runtime/job-store.mjs`
- Create：`tests/job-store.test.mjs`

- [ ] Write tests using a temporary `PLUGIN_DATA` directory.
- [ ] Implement workspace hash resolution from canonical workspace paths.
- [ ] Implement `createJob()`、`readJob()`、`listJobs()`、`patchJob()`、`transitionJob()`、`cleanupOldJobs()`。
- [ ] Add tests for active status filtering, terminal status sorting, CAS transition success, and CAS transition failure.
- [ ] Run：`node --test tests/job-store.test.mjs`
- [ ] Expected：job files stay under the temporary data root and tests pass.

## Task 5：Implement Renderer Sanitization

**Files:**
- Create：`scripts/lib/runtime/render.mjs`
- Create：`tests/render.test.mjs`

- [ ] Write tests proving public text and public JSON omit `pid`、`pidIdentity`、`logFile`、`providerMetadata`、raw internal request payloads.
- [ ] Implement mailbox text rendering for `idle`、`running`、`completed`、`failed`、`cancelled`。
- [ ] Implement JSON payload rendering with the same sanitization boundary.
- [ ] Run：`node --test tests/render.test.mjs`
- [ ] Expected：public output never includes private fields.

## Task 6：Implement Adapter Registry And Fake Adapter

**Files:**
- Create：`scripts/lib/adapters/registry.mjs`
- Create：`scripts/lib/adapters/fake.mjs`
- Create：`tests/adapters.test.mjs`

- [ ] Define the `HarnessAdapter` runtime contract in JSDoc typedefs.
- [ ] Implement registry functions：`registerAdapter()`、`getAdapter()`、`listAdapters()`、`resolveHarnessSelection()`。
- [ ] Implement a fake adapter with controllable success, failure, progress, delay, and cancellation behavior.
- [ ] Test unknown harness, single available default, multi-harness ambiguity, model passthrough, and fake cancellation.
- [ ] Run：`node --test tests/adapters.test.mjs`
- [ ] Expected：adapter registry behavior is deterministic.

## Task 7：Implement Mailbox Runtime With Fake Adapter

**Files:**
- Create：`scripts/lib/runtime/mailbox-runtime.mjs`
- Create：`scripts/every-harness-companion.mjs`
- Create：`tests/mailbox-runtime.test.mjs`

- [ ] Implement `setup` flow against fake adapter availability and auth.
- [ ] Implement foreground `run` with fake adapter progress and final result.
- [ ] Implement background job queue and worker command with fake adapter.
- [ ] Implement `status`、`status --wait`、`status --all`。
- [ ] Implement `cancel` for queued and running jobs.
- [ ] Run：`node --test tests/mailbox-runtime.test.mjs`
- [ ] Expected：foreground, background, wait, and cancel tests pass without real Gemini or Claude Code.

## Task 8：Implement Hook Config Repair

**Files:**
- Create：`scripts/lib/runtime/codex-config.mjs`
- Create：`tests/codex-config.test.mjs`

- [ ] Write tests for empty config, existing `[features]` without hooks, `hooks = false`，`hooks = true`，and deprecated `codex_hooks = true`。
- [ ] Implement `ensureCodexHooksEnabled()` so output contains `[features]` and `hooks = true` exactly once.
- [ ] Ensure the function removes deprecated `codex_hooks` lines.
- [ ] Run：`node --test tests/codex-config.test.mjs`
- [ ] Expected：no generated config contains `codex_hooks`。

## Task 9：Implement Hooks

**Files:**
- Create：`hooks/hooks.json`
- Create：`hooks/session-lifecycle-hook.mjs`
- Create：`hooks/unread-result-hook.mjs`
- Create：`hooks/stop-review-gate-hook.mjs`
- Create：`scripts/lib/runtime/hooks.mjs`
- Create：`tests/hooks.test.mjs`

- [ ] Add bundled hook definitions for `SessionStart`、`SessionEnd`、`UserPromptSubmit`、`Stop`。
- [ ] Implement session routing update on `SessionStart`。
- [ ] Implement active job cleanup on `SessionEnd`。
- [ ] Implement unread background result notification on `UserPromptSubmit`。
- [ ] Implement optional review gate on `Stop` through the selected review-capable adapter.
- [ ] Run：`node --test tests/hooks.test.mjs`
- [ ] Expected：hooks parse JSON input and emit valid JSON output for each event.

## Task 10：Port Gemini ACP Adapter

**Files:**
- Create：`scripts/lib/adapters/gemini-acp.mjs`
- Create：`tests/gemini-acp.test.mjs`

- [ ] Port ACP flag detection from the existing Gemini plugin.
- [ ] Port ACP client lifecycle and session calls.
- [ ] Normalize Gemini model aliases and default model.
- [ ] Make permission auto-approval configurable and visible in setup output.
- [ ] Implement `cancel()` with ACP `session/cancel` first and process fallback second.
- [ ] Test with a fake ACP process that emits `agent_message_chunk` and `tool_call` updates.
- [ ] Run：`node --test tests/gemini-acp.test.mjs`
- [ ] Expected：Gemini adapter tests pass without requiring real Gemini credentials.

## Task 11：Port Claude CLI Adapter

**Files:**
- Create：`scripts/lib/adapters/claude-cli.mjs`
- Create：`tests/claude-cli.test.mjs`

- [ ] Port Claude availability and auth probes.
- [ ] Port model and effort normalization.
- [ ] Port stream-json parser with chunk boundary tests.
- [ ] Port sandbox settings and read-only tool whitelist.
- [ ] Port detached process execution and process-group cancellation.
- [ ] Test text stream, tool use, API retry, structured output, parse errors, and terminal result validation.
- [ ] Run：`node --test tests/claude-cli.test.mjs`
- [ ] Expected：Claude adapter tests pass without requiring real Claude auth.

## Task 12：Install And Marketplace Flow

**Files:**
- Create：`scripts/local-plugin-install.mjs`
- Create：`scripts/install-hooks.mjs`
- Create：`scripts/installer-cli.mjs`
- Create：`tests/install.test.mjs`

- [ ] Implement local install into `~/.codex/plugins/every-harness`。
- [ ] Generate or update personal marketplace entry under `~/.agents/plugins/marketplace.json`。
- [ ] Install wrapped skills and prompts if this project keeps that compatibility layer.
- [ ] Install or expose bundled hooks and repair `[features].hooks`。
- [ ] Test with temporary `HOME`、`CODEX_HOME`、and marketplace paths.
- [ ] Run：`node --test tests/install.test.mjs`
- [ ] Expected：install tests do not touch the real user config.

## Task 13：End-To-End Smoke Commands

**Files:**
- Modify：`README.md`
- Modify：`package.json`

- [ ] Add `npm run smoke:fake` that runs setup, foreground run, background run, status wait, and cancel using the fake adapter.
- [ ] Add optional `npm run smoke:gemini` guarded by real `gemini` availability.
- [ ] Add optional `npm run smoke:claude` guarded by real `claude` availability.
- [ ] Run：`npm run smoke:fake`
- [ ] Expected：fake smoke exits with code `0`。

## Task 14：Final Verification

**Files:**
- Modify：`README.md`
- Modify：`CHANGELOG.md`
- Modify：`AGENTS.md`

- [ ] Update README with exact user-facing commands and adapter support matrix.
- [ ] Update CHANGELOG with `0.1.0` initial release notes.
- [ ] Update `AGENTS.md` Repository Analysis to reflect actual implemented files.
- [ ] Run：`npm run check`
- [ ] Run：`npm pack --dry-run`
- [ ] Expected：checks pass and package contents include manifest, skills, hooks, scripts, schemas, docs, and metadata.

## Implementation Order

Build in this order：Tasks 1-8 first with fake adapter only, then Tasks 9-11, then installer and smoke tests. This keeps the generic runtime testable before porting real harness behavior.
