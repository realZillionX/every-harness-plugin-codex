---
name: status
description: "Show sanitized Every Harness mailbox state. Args: --harness <id>, --all, --wait."
---

# Every Harness Status

Use this skill when the user wants current or completed external harness mailbox state.

Raw slash-command arguments:
`$ARGUMENTS`

Execution:
- Run:
  `node "<installed-plugin-root>/scripts/every-harness-companion.mjs" status <arguments>`
- Forward `--harness`、`--all`、and `--wait` when supplied.
- Keep output sanitized; do not expose internal job IDs, log paths, PIDs, or raw stored job records.
