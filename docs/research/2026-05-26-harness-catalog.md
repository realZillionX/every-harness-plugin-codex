# Harness Catalog Research

This repository is not meant to expose only an abstract harness interface. The product target is concrete coverage for the common coding-agent harnesses that users already run from terminals or TUIs. The adapter architecture should follow from those real harnesses.

## Current Integration Strategy

The first scalable integration path is Agent Client Protocol (ACP). Several newer coding harnesses expose ACP endpoints, which lets Codex control them through JSON-RPC instead of brittle TUI automation. Harnesses with stable `--print`、`stream-json`、or other headless modes can keep native adapters when native output is richer than ACP.

Current implementation stance：

- Gemini CLI：keep the dedicated `gemini-acp` adapter because the local CLI already supports `--acp` and has known permission-mode behavior.
- Claude Code：keep the dedicated `claude-cli` adapter because `claude -p --output-format stream-json` exposes mature non-interactive execution, session IDs, partial messages, tool events, and structured output.
- ACP-capable harnesses：register first-class built-in ACP adapters, not a user-defined “generic interface” only.
- Interactive-only or unclear harnesses：catalog them explicitly, but do not pretend they are safely automatable until a stable headless or ACP contract is verified.

## Built-In Harness Targets

| Harness | Adapter ID | Command Path | Status |
| --- | --- | --- | --- |
| Gemini CLI | `gemini-acp` | `gemini --acp` | Dedicated adapter implemented |
| Claude Code | `claude-cli` | `claude -p --output-format stream-json` | Dedicated adapter implemented |
| OpenCode | `opencode` | `opencode acp` | Generic ACP adapter implemented |
| OpenClaw | `openclaw` | `openclaw acp` | Generic ACP adapter implemented |
| DeepSeek TUI | `deepseek-tui` | `deepseek serve --acp` | Generic ACP adapter implemented |
| Kimi Code | `kimi-code` | `kimi acp` | Generic ACP adapter implemented |
| Qoder CLI | `qoder-cli` | `qodercli --acp` | Generic ACP adapter implemented |
| Trae CLI | `trae-cli` | `traecli acp serve` | Generic ACP adapter implemented |
| Qwen Code | `qwen-code` | `qwen --acp` | Generic ACP adapter implemented |
| GitHub Copilot CLI | `copilot-cli` | `copilot --acp --stdio` | Generic ACP adapter implemented |
| Cursor Agent | `cursor-agent` | `cursor-agent acp` | Generic ACP adapter implemented |
| iFlow CLI | `iflow-cli` | `iflow --experimental-acp` | Generic ACP adapter implemented |
| Kiro CLI | `kiro-cli` | `kiro-cli-chat acp` | Generic ACP adapter implemented |
| Kilo Code CLI | `kilocode-cli` | `npx -y @kilocode/cli acp` | Generic ACP adapter implemented |
| Factory Droid | `factory-droid` | `droid exec --output-format acp` | Generic ACP adapter implemented |
| Google Antigravity CLI | `antigravity-cli` | unverified headless contract | Cataloged as planned |

## Local Environment Findings

On the current machine：

- `gemini` exists at `/Users/zillionx/.local/bin/gemini` and reports version `0.43.0`。Its help confirms `--acp` and non-interactive `-p/--prompt` with `--output-format text|json|stream-json`。
- `claude` exists at `/Users/zillionx/.local/bin/claude` and reports version `2.1.114`。Its help confirms `-p/--print`、`--output-format text|json|stream-json`、`--include-partial-messages`、`--session-id`、`--resume`、and `--permission-mode`。
- `opencode`、`openclaw`、`deepseek`、`kimi`、`trae`、`qodercli`、`qwen`、`copilot`、`cursor-agent`、`iflow`、`kiro-cli-chat`、and `droid` are not currently installed on this machine.

## Source Notes

- Google Gemini CLI npm metadata：`@google/gemini-cli` provides the `gemini` binary and links to `https://github.com/google-gemini/gemini-cli`。
- Anthropic Claude Code npm metadata：`@anthropic-ai/claude-code` provides the `claude` binary and links to `https://github.com/anthropics/claude-code`。
- Qwen Code npm metadata：`@qwen-code/qwen-code` provides the `qwen` binary and links to `https://github.com/QwenLM/qwen-code`。
- Qoder CLI npm metadata：`@qoder-ai/qodercli` provides the `qodercli` binary and links to `https://github.com/nicepkg/qodercli`；Qoder docs also expose CLI and ACP documentation at `https://docs.qoder.com/cli/acp`。
- ACP ecosystem references include the Agent Client Protocol SDK at `https://github.com/agentclientprotocol/typescript-sdk` and the `acpx` agent list at `https://acpx.sh/agents.html`。
- Trae Agent public source is at `https://github.com/bytedance/trae-agent`。
- OpenCode ACP docs are at `https://opencode.ai/docs/integrations/acp/`。
- Antigravity CLI docs are at `https://antigravity.google/docs/cli-using`，but a stable non-interactive ACP or JSON contract still needs direct confirmation before implementing a real adapter.

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
