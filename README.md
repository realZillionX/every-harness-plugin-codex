# Every Harness Plugin for Codex

Delegate Codex work to external agent harnesses through one mailbox runtime.

Codex remains the planner and coordinator. A selected harness adapter owns scoped execution. The plugin owns local state, progress rendering, cancellation, and hooks.

## Public Commands

| Command | Purpose |
| --- | --- |
| `$every-harness:run` | Start one delegated harness request |
| `$every-harness:status` | Show sanitized mailbox state |
| `$every-harness:cancel` | Cancel the active delegated job |
| `$every-harness:setup` | Check adapter readiness and hook configuration |

Typical use：

```text
$every-harness:run --harness gemini-acp inspect the current diff
$every-harness:run --harness claude-cli --write fix the failing parser test
$every-harness:status --all
$every-harness:cancel --harness gemini-acp
```

## Built-In Harnesses

Every Harness is intended to cover real coding-agent harnesses, not only provide an abstract adapter API. Current built-in targets：

- `fake`：deterministic local adapter for tests and smoke checks.
- `gemini-acp` / `gemini-cli`：Gemini CLI through ACP.
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

## Hooks

The plugin bundles lifecycle hooks for session routing, unread background result notices, and optional stop-time review gates. Hook setup must enable `[features].hooks` in `config.toml`。The deprecated `[features].codex_hooks` key is not generated.

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
