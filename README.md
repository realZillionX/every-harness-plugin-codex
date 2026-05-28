# Every Harness Plugin for Codex

Every Harness is a small Codex plugin that gives the agent one local CLI for delegating work to other agent harnesses.

This is not a user-facing slash-command toolkit. The plugin provides one Skill that teaches Codex how to use `ehplugin` when delegation is useful. The only public CLI surface is:

```bash
ehplugin run --harness <id> [options] <task text>
ehplugin status [options]
ehplugin cancel [options]
```

Codex remains the planner and coordinator. A selected harness owns scoped execution. `ehplugin` owns the local mailbox state, status rendering, cancellation, and adapter routing.

## CLI

`ehplugin` is the only public CLI.

```bash
ehplugin run --harness antigravity inspect the current diff
ehplugin run --harness claude-code --write fix the failing parser test
ehplugin run --harness kimi-code --background summarize this repo
ehplugin status --all
ehplugin cancel --harness kimi-code
```

Supported `run` options:

- `--harness <id>`
- `--background`
- `--write`
- `--read-only`
- `--model <model>`
- `--effort <effort>`
- `--prompt-file <path>`
- free-text task text

Supported `status` options:

- `--harness <id>`
- `--all`
- `--wait`

Supported `cancel` options:

- `--harness <id>`

## Built-In Harnesses

Every external harness is invoked through that harness's CLI entry. The public `--harness` name is the product-facing name; the CLI entry is the command that the adapter launches.

| Harness | `--harness` | CLI entry |
| --- | --- | --- |
| Claude Code | `claude-code` | `claude` |
| Antigravity | `antigravity` | `agy` |
| OpenCode | `opencode` | `opencode` / `npx opencode-ai` |
| OpenClaw | `openclaw` | `openclaw` |
| CodeWhale | `codewhale` | `codewhale` |
| Kimi Code | `kimi-code` | `kimi` |
| Qoder | `qoder` | `qodercli` |
| TRAE | `trae` | `traecli` |
| GitHub Copilot | `copilot` | `copilot` |
| Cursor | `cursor` | `cursor-agent` |
| Kiro | `kiro` | `kiro-cli` |
| Pi Coding Agent | `pi-coding-agent` | `pi` |

`fake` is an internal deterministic adapter for tests and smoke checks, not an external harness CLI.

Official Pi Coding Agent is tracked as planned and needs a dedicated `pi --mode rpc` / `pi --mode json` adapter before it should be considered runnable.

Antigravity support is deliberately limited to text headless mode because ACP、JSON、and streaming contracts are not confirmed.

See [docs/research/2026-05-26-harness-catalog.md](docs/research/2026-05-26-harness-catalog.md) for the current source matrix.

## Development

```bash
npm test
npm run check
npm run smoke:fake
npm pack --dry-run
```

## Privacy

The plugin stores mailbox metadata locally under Codex plugin data storage. External prompts, selected repository context, and command output are sent only to the selected harness adapter and the harness CLI or protocol it controls.

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
