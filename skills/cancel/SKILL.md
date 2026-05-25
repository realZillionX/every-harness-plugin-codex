---
name: cancel
description: "Cancel the active Every Harness mailbox process. Args: --harness <id>."
---

# Every Harness Cancel

Use this skill when the user wants to stop active delegated harness work.

Raw slash-command arguments:
`$ARGUMENTS`

Execution:
- Run:
  `node "<installed-plugin-root>/scripts/every-harness-companion.mjs" cancel <arguments>`
- Forward `--harness` when supplied.
- Keep output sanitized.
