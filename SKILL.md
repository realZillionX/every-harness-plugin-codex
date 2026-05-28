---
name: every-harness
description: "Use when Codex should delegate scoped work to an installed external agent harness, inspect an Every Harness mailbox, or cancel active delegated work through the `every-harness` CLI."
---

# Every Harness Skill

`every-harness` is the local CLI for delegating bounded Codex work to another installed harness. This Skill is a Codex playbook: run the CLI yourself when delegation is useful, and keep the user-facing summary short.

Every Harness does not register slash commands, MCP servers, hooks, or hidden defaults. The CLI is the source of truth for command syntax:

```bash
every-harness --help
every-harness run --help
every-harness status --help
every-harness cancel --help
```

## Execution Model

- Codex remains the planner and coordinator.
- The selected harness owns the scoped task passed to `run`.
- Every Harness owns the local mailbox, status rendering, cancellation, and adapter routing.
- External harness CLIs must already be installed and authenticated on the machine.

## Common Commands

```bash
every-harness run --harness <id> [--background] [--write|--read-only] [--model <model>] [--effort <effort>] [--prompt-file <path>] <task text>
every-harness status [--harness <id>] [--all] [--wait]
every-harness cancel [--harness <id>]
```

## When To Use

Use `every-harness run` when a separate harness should execute a scoped implementation, review, exploration, or model-specific pass.

Use `every-harness status` when you need to inspect active or completed delegated work.

Use `every-harness cancel` when delegated work is stale, wrong, or explicitly stopped by the user.

## Rules

- Choose the concrete harness with `--harness`; do not rely on hidden defaults.
- Preserve the user's intent in the task text. Add only the context needed for the target harness to execute safely.
- Use `--write` only when the delegated harness should modify files.
- Use `--background` only when you intend to continue locally and check back with `every-harness status`.
- Keep user-facing summaries short: report the harness used, outcome, and any follow-up work.
- Do not expose internal job IDs, process IDs, log paths, or stored mailbox records unless the user explicitly asks for internals.
