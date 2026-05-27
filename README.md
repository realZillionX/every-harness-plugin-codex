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

Installers expose `ehplugin` as the CLI. The local plugin installer places a shim at `~/.local/bin/ehplugin`。

```bash
ehplugin run --harness antigravity-cli inspect the current diff
ehplugin run --harness claude-cli --write fix the failing parser test
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

- `fake`：deterministic local adapter for tests and smoke checks.
- `claude-cli` / `claude-code`：Claude Code through `claude -p` stream JSON.
- `antigravity-cli`：Google Antigravity CLI through limited `agy --print` text headless execution.
- `opencode`：OpenCode through ACP.
- `openclaw`：OpenClaw through ACP.
- `codewhale` / `deepseek-tui`：community CodeWhale for DeepSeek-style coding through `stream-json` or ACP. This is not an official DeepSeek CLI.
- `kimi-code`：Kimi Code through `kimi -p --output-format stream-json`; legacy `kimi acp` belongs to older `kimi-cli` research only.
- `qoder-cli`：Qoder CLI through ACP.
- `trae-cli`：official Trae CLI through `traecli acp serve`; `--print --json` is the native fallback.
- `qwen-code`：Qwen Code through ACP.
- `copilot-cli`：GitHub Copilot CLI through ACP.
- `cursor-agent`：Cursor Agent through ACP.
- `iflow-cli`：iFlow CLI through ACP.
- `kiro-cli`：Kiro CLI through ACP.
- `kilocode-cli`：Kilo Code CLI through ACP.
- `factory-droid`：Factory Droid through ACP.
- `pi-acp-bridge`：community `pi-acp` bridge through ACP.

Official Pi Coding Agent is tracked separately as `pi-coding-agent` and needs a dedicated `pi --mode rpc` / `pi --mode json` adapter before it should be considered runnable.

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
