# 2026-05-27 Codex 源码架构调研

## 调研范围

本次调研对象是本机 `/Users/zillionx/codex` 的 `main` 分支源码，重点覆盖 `codex-rs/core`、`codex-rs/core-plugins`、`codex-rs/core-skills`、`codex-rs/hooks`、`codex-rs/plugin`、`codex-rs/tools` 和 `codex-rs/external-agent-*`。

核心结论：Codex 当前没有一个可由 plugin 注册、接管或替换的通用 harness adapter API。Codex plugin 的官方边界是本地 bundle，包含 skills、MCP servers、apps 和 hooks；外部 agent harness 要么作为 skill 背后的 companion runtime 被调用，要么未来显式暴露为 MCP server 或 extension tool。`every-harness-plugin-codex` 现有的 “skill wrapper + companion CLI + mailbox runtime + adapter registry” 方向符合当前 Codex plugin 架构。

## Codex 请求路径

Codex 的主循环不是 “选择 harness 并把任务交给 harness”，而是一个 Responses API turn loop：

1. `Session::new_turn_from_configuration` 为每轮加载配置、plugin outcome 和有效 skill roots。
2. `build_initial_context` 把可用 skills 和 plugins 的摘要注入给模型。
3. `run_turn` 读取用户输入、显式 skill / plugin mentions、hook 输出和历史上下文，构造 prompt。
4. 模型输出 assistant message 或 function call。
5. `ToolRouter` 把 function call 分发到 shell、MCP、core utility tools、extension tools、hosted model tools 或 multi-agent tools。
6. 工具结果回写为下一次 sampling input；没有后续工具调用时本轮完成。
7. `Stop` 或 `SubagentStop` hooks 在 turn 结束时执行。

关键源码：

- `/Users/zillionx/codex/codex-rs/core/src/session/turn.rs`：turn loop、Responses stream、工具调用 follow-up。
- `/Users/zillionx/codex/codex-rs/core/src/session/turn_context.rs`：每轮加载 plugin outcome 和 skill manager。
- `/Users/zillionx/codex/codex-rs/core/src/tools/spec_plan.rs`：构造 model-visible tool specs 和 registry。
- `/Users/zillionx/codex/codex-rs/core/src/tools/router.rs`：把模型 function call 变成内部 tool invocation 并分发。

## Plugin 加载合约

Codex plugin manifest 位于 `.codex-plugin/plugin.json`。源码中的 `RawPluginManifest` 支持 `skills`、`mcpServers`、`apps`、`hooks` 和 `interface` 等字段。路径必须以 `./` 开头，不能逃出 plugin root。

默认约定：

- skills：默认 `skills/`，也可由 manifest 的 `skills` 指定。
- hooks：默认 `hooks/hooks.json`，也可由 manifest 的 `hooks` 指定。
- MCP：默认 `.mcp.json`，也可由 manifest 的 `mcpServers` 指定。
- apps：默认 `.app.json`，也可由 manifest 的 `apps` 指定。

插件安装目录和数据目录由 `PluginStore` 管理：cache root 在 `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/<version>`，data root 在 `$CODEX_HOME/plugins/data/<plugin>-<marketplace>`。plugin hooks 运行时会收到 `PLUGIN_ROOT`、`CLAUDE_PLUGIN_ROOT`、`PLUGIN_DATA` 和 `CLAUDE_PLUGIN_DATA` 环境变量。

关键源码：

- `/Users/zillionx/codex/codex-rs/core-plugins/src/manifest.rs`
- `/Users/zillionx/codex/codex-rs/core-plugins/src/loader.rs`
- `/Users/zillionx/codex/codex-rs/core-plugins/src/store.rs`
- `/Users/zillionx/codex/codex-rs/plugin/src/lib.rs`
- `/Users/zillionx/codex/codex-rs/plugin/src/load_outcome.rs`

## Skill 调用合约

Skills 是 plugin 给 Codex Agent 的主要公开入口。Codex 先用摘要告诉模型有哪些 skills；只有显式 mention（例如 `$every-harness:run`）或匹配到的 skill 才会把完整 `SKILL.md` 注入 prompt。

对本插件的影响：

- `skills/run`、`skills/status`、`skills/cancel`、`skills/setup` 是正确的 Codex-facing API。
- `SKILL.md` 应保持短、命令化、低歧义，因为它会直接进入模型上下文。
- plugin skill 会被命名空间化为 `every-harness:run` 这类名称。
- 可选的 `agents/openai.yaml` 支持声明依赖、policy 和接口元信息，但当前插件不需要用它承载 harness adapter 逻辑。

关键源码：

- `/Users/zillionx/codex/codex-rs/core-skills/src/loader.rs`
- `/Users/zillionx/codex/codex-rs/core-skills/src/injection.rs`
- `/Users/zillionx/codex/codex-rs/core-skills/src/model.rs`

## Hooks 合约

Codex 当前支持的 hook event 是：

- `PreToolUse`
- `PermissionRequest`
- `PostToolUse`
- `PreCompact`
- `PostCompact`
- `SessionStart`
- `UserPromptSubmit`
- `SubagentStart`
- `SubagentStop`
- `Stop`

源码里没有 `SessionEnd`。`HookEventsToml` 没有 `deny_unknown_fields`，所以 `hooks/hooks.json` 中的未知字段会在解析时被静默忽略，而不是执行或报错。本插件之前把 active job cleanup 接在 `SessionEnd` 上，这个接线在当前 Codex 中不会运行。

`Stop` 不是 session end；它是每个 root turn 结束时的 hook。thread-spawned child agent 使用 `SubagentStop`。因此不应该把 session 生命周期清理强行挪到 `Stop`，否则会在普通对话轮次后清掉仍然需要的 session routing context。

关键源码：

- `/Users/zillionx/codex/codex-rs/hooks/src/lib.rs`
- `/Users/zillionx/codex/codex-rs/config/src/hook_config.rs`
- `/Users/zillionx/codex/codex-rs/hooks/src/engine/discovery.rs`
- `/Users/zillionx/codex/codex-rs/core/src/hook_runtime.rs`

## Multi-agent 不是外部 harness

Codex 内置 multi-agent 是 Codex-to-Codex 的 thread tree。`AgentControl` 创建新的 Codex thread，继承有效配置、模型、工具 runtime 和权限策略，并通过 `multi_agent_v1` tools 进行 spawn、send、wait、close。

这和 Gemini、Claude Code、Kimi、OpenCode 等外部 harness 不同：内置 subagent 不提供一个 “调用任意外部 harness” 的 adapter slot，也不负责第三方 CLI 协议、ACP、stream JSON 或 process lifecycle。

关键源码：

- `/Users/zillionx/codex/codex-rs/core/src/agent/control.rs`
- `/Users/zillionx/codex/codex-rs/core/src/tools/handlers/multi_agents.rs`
- `/Users/zillionx/codex/codex-rs/core/src/tools/handlers/multi_agents_spec.rs`
- `/Users/zillionx/codex/codex-rs/core/src/agent/status.rs`

## External-agent crates 的定位

`codex-rs/external-agent-migration` 和 `codex-rs/external-agent-sessions` 处理的是外部 agent 配置、hooks、commands、subagents 和历史 session 的导入。它们不是 live execution harness runtime。

具体来说：

- `external-agent-migration` 主要把外部 agent 的 MCP config、hooks、commands、subagents 转换成 Codex 可用形态。
- `external-agent-sessions` 主要检测、读取、转换外部 agent 的 session history。
- 这些 crate 可以作为兼容性和迁移体验参考，但不能替代 `every-harness` 的 adapter registry。

关键源码：

- `/Users/zillionx/codex/codex-rs/external-agent-migration/src/lib.rs`
- `/Users/zillionx/codex/codex-rs/external-agent-sessions/src/lib.rs`

## 对 Every Harness 的直接影响

- 继续保留 companion runtime：Codex plugin 没有通用 harness API，所以 harness adapter 应继续内聚在 `scripts/lib/adapters/*` 和 `scripts/lib/runtime/*`。
- 继续用 skills 作为公共入口：`$every-harness:run`、`$every-harness:status`、`$every-harness:cancel`、`$every-harness:setup` 是当前最稳定的入口。
- 不依赖 `SessionEnd`：当前 Codex 无此 event；active jobs 需要通过 job 状态、cancel、status cleanup 和旧 job 清理策略管理。
- 用 `PLUGIN_DATA` 存状态：这是 Codex 给 plugin hooks 的官方 per-plugin data root。
- 如果未来需要模型直接看到结构化 harness actions，可以评估 MCP server 或 extension tool，但这会改变公开 API 和权限面，不应在没有明确收益时引入。
- 对真实 harness 的协议验证仍由本仓库测试负责；Codex 源码不会帮插件校验 ACP、stream JSON、CLI 参数或取消语义。
