---
name: run
description: "Run one external harness execution request through the Every Harness mailbox protocol. Args: --harness <id>, --wait, --background, --write, --read-only, --model <model>, --effort <effort>, --prompt-file <path>, [task text]."
---

# Every Harness Run

Use this skill when the user wants Codex to delegate a scoped task to another harness.

Raw slash-command arguments:
`$ARGUMENTS`

Supported public arguments:
- `--harness <id>`
- `--wait`
- `--background`
- `--write`
- `--read-only`
- `--model <model>`
- `--effort <effort>`
- `--prompt-file <path>`
- free-text task text

Execution:
- If the user did not provide task text or `--prompt-file`, ask what the harness should do.
- Run the companion runtime as the execution boundary:
  `node "<installed-plugin-root>/scripts/every-harness-companion.mjs" run <arguments>`
- Preserve harness, task text, model, effort, write, read-only, prompt-file, wait, and background arguments.
- Do not call a raw external harness CLI as the normal path.

Output:
- Keep normal output to mailbox state plus the final harness reply for foreground completion.
- Do not expose job IDs, process IDs, session IDs, log paths, resume commands, or internal routing flags in ordinary output.
- On failure, surface a short actionable reason and direct setup/authentication problems to `$every-harness:setup`.
