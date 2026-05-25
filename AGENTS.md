# To-Do Tasks

- [/] Review the planning package before implementation.
  - Acceptance criteria：the user reviews `docs/superpowers/specs/2026-05-26-every-harness-design.md` and `docs/superpowers/plans/2026-05-26-every-harness-implementation-plan.md`，then explicitly approves or requests changes.
- [ ] Start implementation only after the design is approved.
  - Acceptance criteria：the repository contains a validated Codex plugin scaffold, shared mailbox runtime, at least `gemini-acp` and `claude-cli` adapters, tests, and install docs; `npm run check` passes.

# Project Overview

`every-harness-plugin-codex` aims to let a Codex Agent delegate work to agents running inside other harnesses, regardless of the model behind those agents. The core proposition is to keep Codex as the planner and coordinator while external harnesses provide scoped execution through a small, auditable mailbox protocol.

The initial evidence comes from the installed `gemini` and `cc` plugins. Both already expose the same public workflow：`run`、`status`、`cancel`、`setup`。Their reusable parts are job state, workspace isolation, background workers, status rendering, hook notifications, and review gate flow. Their non-reusable parts are harness protocol details：Gemini uses ACP sessions, while Claude Code uses `claude -p` with `stream-json` output.

The planned architecture is `MailboxRuntime + HarnessAdapter`。`MailboxRuntime` owns common Codex-facing behavior. Each `HarnessAdapter` owns availability checks, auth checks, model and effort normalization, execution, progress parsing, cancellation, and optional review behavior.

Hook support is a first-class requirement. All new hook setup must use `[features].hooks` and must not write deprecated `[features].codex_hooks`。

# Repository Analysis

The repository currently starts as a planning workspace on `main`。It has the planning documents committed and no implementation source yet.

Current planned entry points：

- `.codex-plugin/plugin.json`：Codex plugin manifest for `every-harness`。
- `skills/run/SKILL.md`：public execution entry point, likely `$every-harness:run --harness <id> ...`。
- `skills/status/SKILL.md`：sanitized mailbox status。
- `skills/cancel/SKILL.md`：active job cancellation。
- `skills/setup/SKILL.md`：adapter readiness and hook setup。
- `scripts/every-harness-companion.mjs`：companion CLI that dispatches to shared command handlers。
- `scripts/lib/runtime/`：mailbox runtime, job store, renderer, hook integration, process control, installer helpers。
- `scripts/lib/adapters/`：built-in harness adapters, initially `gemini-acp` and `claude-cli`。
- `hooks/hooks.json` and `hooks/*.mjs`：plugin-bundled lifecycle hooks for session routing, unread result notification, and optional stop review gate。

Reference sources inspected：

- Installed Gemini plugin：`/Users/zillionx/.codex/plugins/cache/local-plugins/gemini/1.0.6`。
- Installed Claude Code plugin：`/Users/zillionx/.codex/plugins/cache/local-plugins/cc/2.0.0`。
- Official Codex plugin docs：`https://developers.openai.com/codex/plugins/build`。
- Official Codex hooks docs：`https://developers.openai.com/codex/hooks`。
