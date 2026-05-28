# Harness Catalog Research

This repository is not meant to expose only an abstract harness interface. The product target is concrete coverage for the common coding-agent harnesses that users already run from terminals or TUIs. The adapter architecture should follow from those real harnesses.

## Current Integration Strategy

The first scalable integration path is Agent Client Protocol (ACP). Several newer coding harnesses expose ACP endpoints, which lets Codex control them through JSON-RPC instead of brittle TUI automation. Harnesses with stable `--print`、`stream-json`、or other headless modes can keep native adapters when native output is richer than ACP.

Current implementation stance：

- Claude Code：keep the dedicated `claude-code` adapter because `claude -p --output-format stream-json` exposes mature non-interactive execution, session IDs, partial messages, tool events, and structured output.
- ACP-capable harnesses：register first-class built-in ACP adapters, not a user-defined “generic interface” only.
- Headless native harnesses：prefer the richer native contract when it exists. For example, Kimi Code uses `kimi -p --output-format stream-json`.
- Interactive-only or unclear harnesses：catalog them explicitly, but do not pretend they are safely automatable until a stable headless or ACP contract is verified.

## Built-In Harness Targets

| Harness | Adapter ID | Command Path | Status |
| --- | --- | --- | --- |
| Claude Code | `claude-code` | `claude -p --output-format stream-json` | Dedicated adapter implemented |
| OpenCode | `opencode` | `opencode acp`; `opencode run --format json`; `opencode serve` | Generic ACP adapter implemented; native JSON path needs dedicated follow-up |
| OpenClaw | `openclaw` | `openclaw acp` | Generic ACP adapter implemented |
| DeepSeek TUI semantic target | `deepseek-tui` | no official DeepSeek CLI found | Alias to community CodeWhale only; do not present as official DeepSeek support |
| CodeWhale community bridge | `codewhale` | `codewhale exec --auto --output-format stream-json`; `codewhale serve --acp` | Native stream JSON adapter implemented for the community implementation |
| Kimi Code | `kimi-code` | `kimi -p --output-format stream-json` | Native stream JSON adapter implemented |
| Qoder | `qoder` | `qodercli --acp` | Generic ACP adapter implemented |
| TRAE | `trae` | `traecli acp serve`; `traecli --print --json` | Official ACP entry confirmed; native JSON fallback tracked |
| GitHub Copilot | `copilot` | `copilot --acp --stdio` | Generic ACP adapter implemented |
| Cursor | `cursor` | `cursor-agent acp` | Generic ACP adapter implemented |
| Kiro | `kiro` | `kiro-cli acp` | Generic ACP adapter implemented |
| Pi Coding Agent | `pi-coding-agent` | `pi --mode rpc` / `pi --mode json` | Planned dedicated native adapter |
| Antigravity | `antigravity` | `agy --print` / `agy -p` | Limited text headless adapter implemented; ACP、JSON、and streaming contracts are not confirmed |

## Local Environment Findings

On the current machine：

- `claude` exists at `/Users/zillionx/.local/bin/claude` and reports version `2.1.114`。Its help confirms `-p/--print`、`--output-format text|json|stream-json`、`--include-partial-messages`、`--session-id`、`--resume`、and `--permission-mode`。
- `opencode`、`openclaw`、`deepseek`、`codewhale`、`kimi`、`trae`、`qodercli`、`copilot`、`cursor-agent`、`kiro-cli`、and `agy` are not currently installed on this machine.

## Source Notes

- Anthropic Claude Code npm metadata：`@anthropic-ai/claude-code` provides the `claude` binary and links to `https://github.com/anthropics/claude-code`。
- Qoder CLI npm metadata：`@qoder-ai/qodercli` provides the `qodercli` binary and links to `https://github.com/nicepkg/qodercli`；Qoder docs also expose CLI and ACP documentation at `https://docs.qoder.com/cli/acp`。
- ACP ecosystem references include the Agent Client Protocol SDK at `https://github.com/agentclientprotocol/typescript-sdk` and the `acpx` agent list at `https://acpx.sh/agents.html`。The `acpx` registry confirms ACP command shapes for OpenClaw、Cursor、Copilot、Qoder、Kiro、OpenCode and Trae.
- Official Pi Coding Agent public quickstart describes `@earendil-works/pi-coding-agent` with `pi --mode rpc` / `pi --mode json` integration modes, so it should get a dedicated adapter when promoted beyond planned.
- Official TRAE CLI docs identify `traecli acp serve` as the ACP entry and `--print --json` as a non-interactive fallback. The public `bytedance/trae-agent` repository is useful research context, but should not be treated as the stable production adapter target.
- DeepSeek official CLI research did not find a vendor-supported coding CLI. Community CodeWhale is non-official, but documents both `codewhale exec --auto --output-format stream-json` and `codewhale serve --acp`。
- OpenCode ACP docs are at `https://opencode.ai/docs/integrations/acp/`。OpenCode also exposes `opencode run --format json` and `opencode serve` for non-ACP integration research.
- Antigravity CLI docs are at `https://antigravity.google/docs/cli-using`。Official `agy --print` / `agy -p` supports limited text headless use, but ACP、JSON、and stream output still need direct confirmation before a richer adapter is claimed.
- Kiro CLI ACP command shape is `kiro-cli acp`。

## Next Adapter Work

The generic ACP adapter is now only the first pass. To become production-grade, each listed ACP harness needs one harness-specific probe fixture：

- exact install command and binary name；
- exact auth check command or env keys；
- exact ACP startup argv；
- permission-request behavior；
- session cancel behavior；
- expected model and effort aliases；
- sample progress and final-result events.

When a harness exposes a richer native output contract than ACP, add a dedicated adapter beside the ACP one rather than weakening the common adapter.
