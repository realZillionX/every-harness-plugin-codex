# To-Do Tasks

- [/] Expand from a two-adapter baseline into concrete harness coverage.
  Acceptance criteria：the repository catalogs and registers concrete adapters for common harnesses including `opencode`、`openclaw`、`gemini-cli`、`antigravity-cli`、`claude-code`、`deepseek-tui`、`kimi-code`、`trae-cli`、and `qoder-cli`；`npm run check` passes；unsupported or unverified harnesses are explicitly marked rather than silently abstracted.

# Project Overview

`every-harness-plugin-codex` 用一个共享 mailbox runtime 让 Codex Agent 调度外部 harness 中的 Agent。Codex 保持规划、协调和结果呈现职责；外部 harness adapter 负责具体协议、模型参数、进度解析、取消和认证检查。

当前 `0.1.0` 基线包含 `fake`、`gemini-acp` 和 `claude-cli` 三个 adapter。扩展方向已经调整：项目目标不是只暴露抽象 harness interface，而是内置覆盖常见真实 harness。第一批新增 ACP catalog 目标包括 OpenCode、OpenClaw、DeepSeek TUI、Kimi Code、Qoder CLI、Trae CLI、Qwen Code、GitHub Copilot CLI、Cursor Agent、iFlow CLI、Kiro CLI、Kilo Code CLI 和 Factory Droid。Antigravity CLI 已进入研究 catalog，但必须先确认稳定 headless 或 ACP 合约，不能做伪支持。

当前验证结果：`npm run check` 覆盖 `25` 个 JavaScript 文件语法检查和 `24` 个 Node.js 单测；`npm run smoke:fake` 覆盖 companion CLI 前台、后台、status wait 和 cancel 路径；`npm run pack:dry-run` 确认发布包包含 `35` 个文件。

# Repository Analysis

插件入口和发布元数据：

- `.codex-plugin/plugin.json`：Codex plugin manifest，声明 `every-harness`、skills 路径和 bundled hooks。
- `package.json`：Node.js ESM 包，提供 `test`、`check`、`smoke:fake`、`pack:dry-run` 和安装 CLI。
- `README.md`、`CHANGELOG.md`、`LICENSE`、`NOTICE`：公开文档和许可材料。

Codex-facing skills：

- `skills/run/SKILL.md`：将 `$every-harness:run` 参数转交 companion runtime。
- `skills/status/SKILL.md`：展示脱敏 mailbox 状态。
- `skills/cancel/SKILL.md`：取消当前活跃 delegated job。
- `skills/setup/SKILL.md`：检查 adapter readiness、hook 安装状态和 review gate 配置。

Runtime 数据流：

- `scripts/every-harness-companion.mjs`：注册内置 adapters，分发 `setup`、`run`、`worker`、`status`、`cancel`。
- `scripts/lib/runtime/mailbox-runtime.mjs`：实现命令处理、job 创建、foreground/background worker、adapter 结果归一、脱敏输出和取消归一。
- `scripts/lib/runtime/job-store.mjs`：按 workspace hash 将 job、config 和 current session 存在 Codex plugin data root。
- `scripts/lib/runtime/render.mjs`：过滤 `pid`、`processRef`、`providerMetadata`、`request`、`logFile` 等内部字段。
- `scripts/lib/runtime/hook-install.mjs` 与 `scripts/install-hooks.mjs`：幂等合并 `hooks/hooks.json` 到 Codex `hooks.json`，并启用 `[features].hooks`。
- `scripts/lib/runtime/hooks.mjs`：处理 `SessionStart`、`SessionEnd`、`UserPromptSubmit` 和 optional `Stop` review gate。

Adapter 边界：

- `scripts/lib/adapters/registry.mjs`：adapter 注册、别名和默认选择。
- `scripts/lib/adapters/fake.mjs`：确定性 adapter，用于单测和 smoke。
- `scripts/lib/adapters/gemini-acp.mjs`：Gemini ACP adapter，包含模型别名、ACP flag 检测、权限策略、progress 归一和 session cancel fallback。
- `scripts/lib/adapters/claude-cli.mjs`：Claude CLI adapter，包含模型与 effort 别名、`stream-json` parser、read-only tool defaults、CLI probe 和进程组取消。
- `scripts/lib/adapters/acp-generic.mjs`：通用 ACP JSON-RPC adapter，用于已有明确 ACP 入口的具体 harness。
- `scripts/lib/adapters/builtin-harnesses.mjs`：真实 harness catalog，注册 OpenCode、OpenClaw、DeepSeek TUI、Kimi、Qoder、Trae、Qwen、Copilot、Cursor、iFlow、Kiro、Kilo 和 Factory Droid 等 adapter。

测试覆盖：

- `tests/runtime.test.mjs`：参数解析、config hook feature 迁移、hook 安装探测、job store、公开输出脱敏和 mailbox 主流程。
- `tests/hooks.test.mjs`：session lifecycle、unread result、stop review gate 和 hook input。
- `tests/gemini-acp.test.mjs`：Gemini ACP adapter 行为。
- `tests/claude-cli.test.mjs`：Claude CLI stream parser、参数构建和 probe 行为。
