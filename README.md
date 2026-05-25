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

## Adapters

Initial adapter targets：

- `fake`：deterministic local adapter for tests and smoke checks.
- `gemini-acp`：Gemini CLI through ACP.
- `claude-cli`：Claude Code CLI through `claude -p` stream JSON.

The runtime is model-agnostic. Model and effort flags are passed through adapter-specific normalization.

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
