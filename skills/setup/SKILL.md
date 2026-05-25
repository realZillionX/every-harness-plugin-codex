---
name: setup
description: "Check Every Harness adapter readiness and optionally toggle the stop-time review gate. Args: --harness <id>, --enable-review-gate, --disable-review-gate."
---

# Every Harness Setup

Use this skill when the user wants to verify harness adapter readiness, hook configuration, or review gate settings.

Raw slash-command arguments:
`$ARGUMENTS`

Workflow:
- First run the machine-readable probe:
  `node "<installed-plugin-root>/scripts/every-harness-companion.mjs" setup --json <arguments>`
- If setup reports missing hooks, run:
  `node "<installed-plugin-root>/scripts/install-hooks.mjs"`
- Hook setup must enable `[features].hooks`，not deprecated `[features].codex_hooks`。
- After any repair, rerun the final user-facing command without `--json`:
  `node "<installed-plugin-root>/scripts/every-harness-companion.mjs" setup <arguments>`

Output:
- Present the final non-JSON setup output.
- Preserve authentication guidance if an adapter reports missing auth.
