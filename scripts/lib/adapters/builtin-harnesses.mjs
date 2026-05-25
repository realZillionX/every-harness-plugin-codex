import { createGenericAcpAdapter } from "./acp-generic.mjs";

const DEFAULT_ACP_METADATA = Object.freeze({
  maturity: "experimental",
  protocol: "acp",
});

export const BUILTIN_ACP_HARNESSES = [
  {
    id: "opencode",
    aliases: ["opencode-ai"],
    displayName: "OpenCode",
    command: "npx",
    args: ["-y", "opencode-ai", "acp"],
    probe: { command: "npx", args: ["--version"] },
    install: "Uses `npx -y opencode-ai acp` by default; global installs expose `opencode acp`.",
    source: "https://acpx.sh/agents.html#opencode",
  },
  {
    id: "openclaw",
    aliases: ["openclaw-cli"],
    displayName: "OpenClaw",
    command: "openclaw",
    args: ["acp"],
    install: "Install OpenClaw, then expose an `openclaw acp` command on PATH.",
    source: "https://acpx.sh/agents.html#openclaw",
  },
  {
    id: "deepseek-tui",
    aliases: ["deepseek", "deepseek-cli"],
    displayName: "DeepSeek TUI",
    command: "deepseek",
    args: ["serve", "--acp"],
    install: "Install DeepSeek TUI and expose `deepseek serve --acp` on PATH.",
    source: "https://github.com/Hmbown/DeepSeek-TUI",
  },
  {
    id: "kimi-code",
    aliases: ["kimi", "kimi-cli"],
    displayName: "Kimi Code",
    command: "kimi",
    args: ["acp"],
    install: "Install Kimi Code and expose `kimi acp` on PATH.",
    source: "https://acpx.sh/agents.html#kimi",
  },
  {
    id: "qoder-cli",
    aliases: ["qoder", "qodercli"],
    displayName: "Qoder CLI",
    command: "qodercli",
    args: ["--acp"],
    install: "Install with `npm install -g @qoder-ai/qodercli`.",
    source: "https://acpx.sh/agents.html#qoder",
  },
  {
    id: "trae-cli",
    aliases: ["trae", "trae-agent"],
    displayName: "Trae CLI",
    command: "traecli",
    args: ["acp", "serve"],
    install: "Install Trae CLI from the official Trae distribution, then expose `traecli acp serve` on PATH.",
    source: "https://acpx.sh/agents.html#trae",
  },
  {
    id: "qwen-code",
    aliases: ["qwen", "qwen-cli"],
    displayName: "Qwen Code",
    command: "qwen",
    args: ["--acp"],
    install: "Install with `npm install -g @qwen-code/qwen-code`.",
    source: "https://acpx.sh/agents.html#qwen",
  },
  {
    id: "copilot-cli",
    aliases: ["github-copilot", "copilot"],
    displayName: "GitHub Copilot CLI",
    command: "copilot",
    args: ["--acp", "--stdio"],
    install: "Install with `npm install -g @github/copilot`.",
    source: "https://acpx.sh/agents.html#copilot",
  },
  {
    id: "cursor-agent",
    aliases: ["cursor"],
    displayName: "Cursor Agent",
    command: "cursor-agent",
    args: ["acp"],
    install: "Install Cursor Agent from Cursor docs, then expose `cursor-agent acp` on PATH.",
    source: "https://acpx.sh/agents.html#cursor",
  },
  {
    id: "iflow-cli",
    aliases: ["iflow"],
    displayName: "iFlow CLI",
    command: "iflow",
    args: ["--experimental-acp"],
    install: "Install iFlow CLI and expose `iflow --experimental-acp` on PATH.",
    source: "https://acpx.sh/agents.html#iflow",
  },
  {
    id: "kiro-cli",
    aliases: ["kiro"],
    displayName: "Kiro CLI",
    command: "kiro-cli",
    args: ["acp"],
    install: "Install Kiro CLI and expose `kiro-cli acp` on PATH.",
    source: "https://acpx.sh/agents.html#kiro",
  },
  {
    id: "kilocode-cli",
    aliases: ["kilocode"],
    displayName: "Kilo Code CLI",
    command: "npx",
    args: ["-y", "@kilocode/cli", "acp"],
    probe: { command: "npx", args: ["--version"] },
    install: "Uses `npx -y @kilocode/cli acp` by default.",
    source: "https://acpx.sh/agents.html#kilocode",
  },
  {
    id: "factory-droid",
    aliases: ["droid"],
    displayName: "Factory Droid",
    command: "droid",
    args: ["exec", "--output-format", "acp"],
    install: "Install Factory Droid, then expose `droid exec --output-format acp` on PATH.",
    source: "https://acpx.sh/agents.html#droid-factory",
  },
  {
    id: "pi-acp-bridge",
    aliases: ["pi-acp"],
    displayName: "Pi ACP Bridge",
    command: "npx",
    args: ["-y", "pi-acp"],
    probe: { command: "npx", args: ["--version"] },
    install: "Uses the community `npx -y pi-acp` bridge by default; official Pi uses `pi --mode rpc` or `pi --mode json` and needs a dedicated adapter.",
    source: "https://acpx.sh/agents.html#pi",
  },
].map((definition) => ({ ...DEFAULT_ACP_METADATA, ...definition }));

export const PLANNED_HARNESSES = [
  {
    id: "antigravity-cli",
    aliases: ["antigravity", "agy"],
    displayName: "Google Antigravity CLI",
    maturity: "planned",
    protocol: "unverified",
    install: "No runnable install command is exposed until a stable headless or ACP contract is verified.",
    reason: "Official CLI docs describe interactive slash-command workflows, but a stable ACP/headless protocol was not yet verified.",
    source: "https://antigravity.google/docs/cli-using",
  },
  {
    id: "pi-coding-agent",
    aliases: ["pi"],
    displayName: "Pi Coding Agent",
    maturity: "planned",
    protocol: "native-rpc",
    install: "Install official Pi with `npm install -g --ignore-scripts @earendil-works/pi-coding-agent`; adapter work must target `pi --mode rpc` or `pi --mode json`.",
    reason: "Official Pi is not the same as the community `pi-acp` bridge and needs a dedicated native RPC/JSON adapter.",
    source: "https://pi.dev/docs/latest/quickstart",
  },
];

export function createBuiltinAcpAdapters(options = {}) {
  return BUILTIN_ACP_HARNESSES.map((definition) => {
    const adapter = createGenericAcpAdapter(definition, options);
    return {
      ...adapter,
      maturity: definition.maturity,
      protocol: definition.protocol,
      source: definition.source,
      install: definition.install,
      async checkAvailability(context = {}) {
        const availability = await adapter.checkAvailability(context);
        return {
          ...availability,
          install: availability.install ?? definition.install ?? null,
          maturity: definition.maturity,
          protocol: definition.protocol,
          source: definition.source,
        };
      },
    };
  });
}

export function createPlannedHarnessAdapters() {
  return PLANNED_HARNESSES.map((definition) => ({
    id: definition.id,
    aliases: definition.aliases ?? [],
    displayName: definition.displayName,
    maturity: definition.maturity,
    protocol: definition.protocol,
    install: definition.install,
    source: definition.source,
    async checkAvailability() {
      return {
        available: false,
        detail: definition.reason,
        install: definition.install,
        maturity: definition.maturity,
        protocol: definition.protocol,
        source: definition.source,
      };
    },
    async checkAuth() {
      return {
        loggedIn: null,
        confidence: "not-applicable",
        detail: "No runnable adapter is enabled until a stable headless or ACP contract is verified.",
      };
    },
    async runTurn() {
      throw new Error(`${definition.displayName} is cataloged but not runnable yet: ${definition.reason}`);
    },
    async cancel() {
      return {
        cancelled: false,
        detail: `${definition.displayName} has no active runnable adapter.`,
      };
    },
  }));
}
