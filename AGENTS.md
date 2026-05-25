# To-Do Tasks

No active tracked tasks.

# Project Overview

`every-harness-plugin-codex` 用一个共享 mailbox runtime 让 Codex Agent 调度外部 harness 中的 Agent。Codex 保持规划、协调和结果呈现职责；外部 harness adapter 负责具体协议、模型参数、进度解析、取消和认证检查。

当前 `0.1.0` 基线包含 `fake`、`gemini-acp`、`claude-cli`、通用 ACP adapter 和通用 native headless adapter。扩展方向已经调整：项目目标不是只暴露抽象 harness interface，而是内置覆盖常见真实 harness。第一批新增 catalog 目标包括 OpenCode、OpenClaw、DeepSeek TUI 语义目标、CodeWhale 社区 bridge、Kimi Code、Qoder CLI、Trae CLI、Qwen Code、GitHub Copilot CLI、Cursor Agent、iFlow CLI、Kiro CLI、Kilo Code CLI、Factory Droid、Pi ACP bridge 和 Pi 官方 Coding Agent。Antigravity CLI 官方 `agy --print` / `agy -p` 已接入有限 text headless adapter，但尚未确认 ACP、JSON 或 streaming 合约。

最新 harness 调研结论：OpenCode 真实入口包括 `opencode acp`、`opencode run --format json` 和 `opencode serve`；TRAE CLI 官方 ACP 入口是 `traecli acp serve`，`--print --json` 是备选，`bytedance/trae-agent` 只能作为研究参考；DeepSeek 官方 CLI 未找到，CodeWhale 是非官方社区实现，支持 `codewhale exec --auto --output-format stream-json` 和 `codewhale serve --acp`；最新 Kimi Code 应优先 `kimi -p --output-format stream-json`，旧 `kimi acp` 属于 legacy `kimi-cli`；Pi 官方和 community `pi-acp` bridge 必须分开；Kiro 命令为 `kiro-cli acp`。

当前验证结果：`npm run check` 覆盖 `32` 个 JavaScript 文件语法检查和 `42` 个 Node.js 单测；`npm run smoke:fake` 覆盖 companion CLI 前台、后台、status wait 和 cancel 路径；`npm run pack:dry-run` 确认发布包包含 `39` 个文件。

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
- `scripts/lib/adapters/cli-headless.mjs`：通用 native headless adapter，用于 Antigravity text output、Kimi Code stream JSON 和 CodeWhale stream JSON。
- `scripts/lib/adapters/builtin-harnesses.mjs`：真实 harness catalog，分开维护 ACP、native headless 和 planned harness；注册 OpenCode、OpenClaw、CodeWhale、Kimi、Qoder、Trae、Qwen、Copilot、Cursor、iFlow、Kiro、Kilo、Factory Droid、Antigravity 和 Pi bridge 等 adapter。

测试覆盖：

- `tests/runtime.test.mjs`：参数解析、config hook feature 迁移、hook 安装探测、job store、公开输出脱敏和 mailbox 主流程。
- `tests/hooks.test.mjs`：session lifecycle、unread result、stop review gate 和 hook input。
- `tests/gemini-acp.test.mjs`：Gemini ACP adapter 行为。
- `tests/claude-cli.test.mjs`：Claude CLI stream parser、参数构建和 probe 行为。
- `tests/acp-generic.test.mjs`：generic ACP JSON-RPC fake process、cancel 和 catalog 边界。
- `tests/cli-headless.test.mjs`：native text 和 stream JSON adapter 行为。
- `tests/setup-catalog.test.mjs`：真实 harness catalog metadata 和 setup 输出分组。
