# To-Do Tasks

No active tracked tasks.

# Project Overview

`every-harness-plugin-codex` 是一个给 Codex Agent 自用的外部 harness 调度插件。它不提供用户日常输入的 `$every-harness:*` 命令集合；插件只提供一个 Skill，教模型在需要委托执行时调用本地 CLI：`ehplugin run/status/cancel`。

当前设计刻意保持简洁：

- 一个 Skill：`skills/ehplugin/SKILL.md`。
- 一个 CLI：`scripts/ehplugin.mjs`，公开子命令只有 `run`、`status`、`cancel`。
- 没有 MCP server。
- 没有 hook。
- 没有 setup 命令；adapter 可用性、认证和安装建议由具体 run 失败或 agent 主动检查代码/catalog 时处理。

当前 adapter 覆盖分三类：

- 专用 adapter：`fake`、`gemini-acp`、`claude-cli`。
- 通用 ACP adapter：OpenCode、OpenClaw、Qoder CLI、Trae CLI、Qwen Code、GitHub Copilot CLI、Cursor Agent、iFlow CLI、Kiro CLI、Kilo Code CLI、Factory Droid 和 community Pi ACP bridge。
- 通用 native headless adapter：Antigravity text output、Kimi Code stream JSON 和 CodeWhale stream JSON。

当前验证结果：`npm run check`、`npm run smoke:fake`、`npm run pack:dry-run` 应作为交付检查。

# Repository Analysis

插件入口和发布元数据：

- `.codex-plugin/plugin.json`：Codex plugin manifest，声明 `every-harness` 和单一 skills 路径。
- `package.json`：Node.js ESM 包，提供 `ehplugin` bin、安装 CLI、测试和打包脚本。
- `README.md`、`CHANGELOG.md`、`LICENSE`、`NOTICE`：公开文档和许可材料。

Codex-facing Skill：

- `skills/ehplugin/SKILL.md`：告诉模型何时、如何调用 `ehplugin run/status/cancel`。这是 Agent 内部操作说明，不是面向用户的 slash-command API。

Runtime 数据流：

- `scripts/ehplugin.mjs`：注册内置 adapters，分发 `run`、`status`、`cancel`，并保留内部 `__worker` 给后台任务使用。
- `scripts/lib/runtime/mailbox-runtime.mjs`：实现 job 创建、前台/后台 worker、adapter 结果归一、脱敏输出和取消归一。
- `scripts/lib/runtime/job-store.mjs`：按 workspace hash 将 job 存在 Codex plugin data root。
- `scripts/lib/runtime/render.mjs`：过滤 `pid`、`processRef`、`providerMetadata`、`request`、`logFile` 等内部字段。

Adapter 边界：

- `scripts/lib/adapters/registry.mjs`：adapter 注册、别名和选择。
- `scripts/lib/adapters/fake.mjs`：确定性 adapter，用于单测和 smoke。
- `scripts/lib/adapters/gemini-acp.mjs`：Gemini ACP adapter，包含模型别名、ACP flag 检测、权限策略、progress 归一和 session cancel fallback。
- `scripts/lib/adapters/claude-cli.mjs`：Claude CLI adapter，包含模型与 effort 别名、`stream-json` parser、read-only tool defaults、CLI probe 和进程组取消。
- `scripts/lib/adapters/acp-generic.mjs`：通用 ACP JSON-RPC adapter，用于已有明确 ACP 入口的具体 harness。
- `scripts/lib/adapters/cli-headless.mjs`：通用 native headless adapter，用于 Antigravity text output、Kimi Code stream JSON 和 CodeWhale stream JSON。
- `scripts/lib/adapters/builtin-harnesses.mjs`：真实 harness catalog，分开维护 ACP、native headless 和 planned harness。

测试覆盖：

- `tests/runtime.test.mjs`：参数解析、job store、公开输出脱敏和 mailbox 主流程。
- `tests/gemini-acp.test.mjs`：Gemini ACP adapter 行为。
- `tests/claude-cli.test.mjs`：Claude CLI stream parser、参数构建和 probe 行为。
- `tests/acp-generic.test.mjs`：generic ACP JSON-RPC fake process、cancel 和 catalog 边界。
- `tests/cli-headless.test.mjs`：native text 和 stream JSON adapter 行为。
- `tests/harness-catalog.test.mjs`：真实 harness catalog metadata 和 protocol 边界。
