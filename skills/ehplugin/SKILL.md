---
name: ehplugin
description: "Use when the agent should delegate work to an installed external agent harness, inspect an existing Every Harness mailbox, or cancel active delegated work. Teaches the agent to use the `ehplugin` CLI with run/status/cancel."
---

# Every Harness Agent CLI

Every Harness is an agent-internal tool. Do not ask the user to type `$every-harness:*` commands. When delegation is useful, run the local CLI yourself.

## CLI

Use:

```bash
ehplugin run --harness <id> [--background] [--write|--read-only] [--model <model>] [--effort <effort>] [--prompt-file <path>] <task text>
ehplugin status [--harness <id>] [--all] [--wait]
ehplugin cancel [--harness <id>]
```

## When To Use

Use `ehplugin run` when a separate harness should execute a scoped task, such as implementation, review, exploration, or a model-specific pass.

Use `ehplugin status` when you need to inspect active or completed delegated work.

Use `ehplugin cancel` when delegated work is stale, wrong, or explicitly stopped by the user.

## Rules

- Choose the concrete harness with `--harness`; do not rely on hidden defaults.
- Preserve the user's intent in the task text. Add only the context needed for the target harness to execute safely.
- Use `--write` only when the delegated harness should modify files.
- Use `--background` only when you intend to continue locally and check back with `ehplugin status`.
- Keep user-facing summaries short: report the harness used, outcome, and any follow-up work.
- Do not expose internal job IDs, process IDs, log paths, or stored mailbox records unless the user explicitly asks for internals.
