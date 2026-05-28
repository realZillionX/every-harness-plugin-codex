<p align="center">
  <img src="assets/logo.png" alt="Every Harness Plugin for Codex logo" width="160"><br>
  <strong>Every Harness Plugin for Codex</strong><br>
  <sub>One CLI. Multiple agent harnesses. Shared mailbox runtime.</sub>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-blue" alt="License"></a>
  <img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen" alt="Node">
  <img src="https://img.shields.io/badge/status-experimental-orange" alt="Status">
</p>

---

**Every Harness** is a Codex plugin that gives the agent one local CLI (`ehplugin`) for delegating scoped work to external agent harnesses.

> This is **not** a user-facing slash-command toolkit. The plugin exposes a single Skill that teaches Codex when and how to delegate.

## Installation

Every Harness has no custom installer or setup command. Installation is package- and manifest-driven:

- `.codex-plugin/plugin.json` tells Codex where to find the plugin Skill (`./skills/`).
- `skills/ehplugin/SKILL.md` is the only public Skill exposed to Codex.
- `package.json` exposes one executable: `ehplugin` → `scripts/ehplugin.mjs`.
- External harness CLIs are not bundled. Install and authenticate the harnesses you want to use separately.

For local development or manual CLI use from this checkout:

```bash
npm install -g .
ehplugin run --harness fake --json smoke
```

Use `npm link` instead of `npm install -g .` when you want live edits in this checkout to be reflected immediately:

```bash
npm link
ehplugin run --harness fake --json smoke
```

When installed through Codex's plugin flow, the expected install contract is: Codex reads the plugin manifest, loads `skills/ehplugin/SKILL.md`, and installs the package so the `ehplugin` executable is available on PATH. The manifest alone only exposes the Skill text; the package `bin` is what provides the CLI. The plugin itself does not register slash commands, MCP servers, hooks, setup commands, or harness installers.

The harness adapters only route to existing local commands:

| Harness | Required local command |
| --- | --- |
| Claude Code | `claude` |
| Antigravity | `agy` |
| OpenCode | `npx opencode-ai` or `opencode` |
| OpenClaw | `openclaw` |
| CodeWhale | `codewhale` |
| Kimi Code | `kimi` |
| Qoder | `qodercli` |
| TRAE | `traecli` |
| GitHub Copilot | `copilot` |
| Cursor | `cursor-agent` |
| Kiro | `kiro-cli` |

## Architecture

<table>
  <tbody>
    <tr>
      <td align="center" colspan="3">
        <strong>Codex</strong><br>
        <sub>planner / coordinator</sub>
      </td>
    </tr>
    <tr>
      <td align="center" colspan="3">↓</td>
    </tr>
    <tr>
      <td align="center">
        <strong><code>ehplugin</code> CLI</strong><br>
        <sub>run / status / cancel</sub>
      </td>
      <td align="center">→</td>
      <td align="center">
        <strong>Mailbox State</strong><br>
        <sub>local job records</sub>
      </td>
    </tr>
    <tr>
      <td align="center" colspan="3">↓</td>
    </tr>
    <tr>
      <td align="center" colspan="3">
        <strong>Adapter Routing</strong><br>
        <sub>ACP, native stream JSON, and native text adapters</sub>
      </td>
    </tr>
    <tr>
      <td align="center" colspan="3">↓</td>
    </tr>
    <tr>
      <td align="center" colspan="3">
        <strong>External Harness</strong><br>
        <sub>scoped executor</sub>
      </td>
    </tr>
  </tbody>
</table>

Codex remains the planner. A selected harness owns scoped execution. `ehplugin` owns local mailbox state, status rendering, cancellation, and adapter routing.

## Usage

```bash
ehplugin run --harness <id> [options] <task>
ehplugin status [options]
ehplugin cancel [options]
```

### Examples

```bash
# Delegate a code review to Claude Code
ehplugin run --harness claude-code --read-only review the auth module

# Run a background task with Kimi Code
ehplugin run --harness kimi-code --background summarize this repo

# Write mode with Antigravity
ehplugin run --harness antigravity --write fix the failing parser test

# Check all active jobs
ehplugin status --all

# Cancel a specific harness
ehplugin cancel --harness kimi-code
```

### `run` Options

| Flag | Description |
| --- | --- |
| `--harness <id>` | Target harness (required) |
| `--background` | Run asynchronously, check back with `status` |
| `--write` | Allow the harness to modify files |
| `--read-only` | Restrict the harness to read-only access |
| `--model <model>` | Override model selection |
| `--effort <effort>` | Set effort level |
| `--prompt-file <path>` | Load task from file |

### `status` Options

| Flag | Description |
| --- | --- |
| `--harness <id>` | Filter by harness |
| `--all` | Show all jobs |
| `--wait` | Block until completion |

### `cancel` Options

| Flag | Description |
| --- | --- |
| `--harness <id>` | Cancel jobs for a specific harness |

## Supported Harnesses

| Harness | `--harness` | Protocol |
| --- | --- | --- |
| Claude Code | `claude-code` | Native stream JSON |
| Antigravity | `antigravity` | Native text |
| OpenCode | `opencode` | ACP |
| OpenClaw | `openclaw` | ACP |
| CodeWhale | `codewhale` | Native stream JSON |
| Kimi Code | `kimi-code` | Native stream JSON |
| Qoder | `qoder` | ACP |
| TRAE | `trae` | ACP |
| GitHub Copilot | `copilot` | ACP |
| Cursor | `cursor` | ACP |
| Kiro | `kiro` | ACP |

> **Note:** Antigravity is limited to text headless mode (`agy --print`). ACP, JSON, and streaming contracts are not confirmed.

## Development

```bash
npm test            # Run unit tests
npm run check       # Lint + tests
npm run smoke:fake  # Smoke test with fake adapter
npm pack --dry-run  # Verify package contents
```

## Privacy

The plugin stores mailbox metadata locally under Codex plugin data storage. External prompts, selected repository context, and command output are sent only to the selected harness adapter and the harness CLI or protocol it controls.

## License

Apache-2.0 -- See [LICENSE](LICENSE) and [NOTICE](NOTICE).
