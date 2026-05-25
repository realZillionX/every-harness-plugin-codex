import { createGenericAcpAdapter } from "./acp-generic.mjs";
import { createCliHeadlessAdapter } from "./cli-headless.mjs";

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
    probe: {
      command: "npx",
      args: ["--version"],
      successDetail: "npx is available; `opencode-ai` will be resolved at run time.",
    },
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
    id: "qoder-cli",
    aliases: ["qoder", "qodercli"],
    displayName: "Qoder CLI",
    command: "qodercli",
    args: ["--acp"],
    install: "Install with `npm install -g @qoder-ai/qodercli`.",
    source: "https://acpx.sh/agents.html#qoder",
    auth: { envKeys: ["QODER_PERSONAL_ACCESS_TOKEN"] },
  },
  {
    id: "trae-cli",
    aliases: ["trae", "trae-agent"],
    displayName: "Trae CLI",
    command: "traecli",
    args: ["acp", "serve"],
    install: "Install Trae CLI from the official Trae distribution, then expose `traecli acp serve` on PATH. Native fallback research tracks `traecli --print --json`.",
    source: "https://acpx.sh/agents.html#trae",
    auth: { envKeys: ["TRAECLI_PERSONAL_ACCESS_TOKEN"] },
  },
  {
    id: "qwen-code",
    aliases: ["qwen", "qwen-cli"],
    displayName: "Qwen Code",
    command: "qwen",
    args: ["--acp"],
    install: "Install with `npm install -g @qwen-code/qwen-code`.",
    source: "https://acpx.sh/agents.html#qwen",
    auth: { envKeys: ["DASHSCOPE_API_KEY", "BAILIAN_CODING_PLAN_API_KEY"] },
  },
  {
    id: "copilot-cli",
    aliases: ["github-copilot", "copilot"],
    displayName: "GitHub Copilot CLI",
    command: "copilot",
    args: ["--acp", "--stdio"],
    install: "Install with `npm install -g @github/copilot`.",
    source: "https://acpx.sh/agents.html#copilot",
    auth: { envKeys: ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] },
  },
  {
    id: "cursor-agent",
    aliases: ["cursor"],
    displayName: "Cursor Agent",
    command: "cursor-agent",
    args: ["acp"],
    install: "Install Cursor Agent from Cursor docs, then expose `cursor-agent acp` on PATH.",
    source: "https://acpx.sh/agents.html#cursor",
    auth: { envKeys: ["CURSOR_API_KEY"] },
  },
  {
    id: "iflow-cli",
    aliases: ["iflow"],
    displayName: "iFlow CLI",
    command: "iflow",
    args: ["--experimental-acp"],
    install: "Install iFlow CLI and expose `iflow --experimental-acp` on PATH.",
    source: "https://acpx.sh/agents.html#iflow",
    auth: { envKeys: ["IFLOW_API_KEY"] },
  },
  {
    id: "kiro-cli",
    aliases: ["kiro"],
    displayName: "Kiro CLI",
    command: "kiro-cli",
    args: ["acp"],
    install: "Install Kiro CLI and expose `kiro-cli acp` on PATH.",
    source: "https://acpx.sh/agents.html#kiro",
    auth: { envKeys: ["KIRO_API_KEY"] },
  },
  {
    id: "kilocode-cli",
    aliases: ["kilocode"],
    displayName: "Kilo Code CLI",
    command: "npx",
    args: ["-y", "@kilocode/cli", "acp"],
    probe: {
      command: "npx",
      args: ["--version"],
      successDetail: "npx is available; `@kilocode/cli` will be resolved at run time.",
    },
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
    auth: { envKeys: ["FACTORY_API_KEY"] },
  },
  {
    id: "pi-acp-bridge",
    aliases: ["pi-acp"],
    displayName: "Pi ACP Bridge",
    command: "npx",
    args: ["-y", "pi-acp"],
    probe: {
      command: "npx",
      args: ["--version"],
      successDetail: "npx is available; community `pi-acp` will be resolved at run time.",
    },
    install: "Uses the community `npx -y pi-acp` bridge by default; official Pi uses `pi --mode rpc` or `pi --mode json` and needs a dedicated adapter.",
    source: "https://acpx.sh/agents.html#pi",
  },
].map((definition) => ({ ...DEFAULT_ACP_METADATA, ...definition }));

const DEFAULT_CLI_HEADLESS_METADATA = Object.freeze({
  maturity: "experimental",
});

export const BUILTIN_CLI_HEADLESS_HARNESSES = [
  {
    id: "antigravity-cli",
    aliases: ["antigravity", "agy"],
    displayName: "Google Antigravity CLI",
    command: "agy",
    args: ["--print", "{prompt}"],
    outputMode: "text",
    protocol: "native-text",
    install: "Install Google Antigravity CLI, then expose `agy --print` or `agy -p` on PATH. ACP, JSON, and streaming contracts are not confirmed.",
    source: "https://antigravity.google/docs/cli-using",
    auth: {
      detail: "Authentication is delegated to Antigravity CLI browser/keyring login.",
    },
  },
  {
    id: "codewhale",
    aliases: ["deepseek-tui", "deepseek", "deepseek-cli", "codew"],
    displayName: "CodeWhale (DeepSeek community)",
    command: "codewhale",
    args: ["exec", "--auto", "--output-format", "stream-json"],
    outputMode: "stream-json",
    protocol: "native-stream-json+acp",
    install: "Install community CodeWhale, then expose `codewhale exec --auto --output-format stream-json` on PATH. ACP alternative: `codewhale serve --acp`. This is not an official DeepSeek CLI.",
    source: "https://github.com/Hmbown/CodeWhale",
    auth: {
      envKeys: ["DEEPSEEK_API_KEY"],
      detail: "Configure CodeWhale auth through its config file or DeepSeek-compatible provider environment.",
    },
  },
  {
    id: "kimi-code",
    aliases: ["kimi", "kimi-cli"],
    displayName: "Kimi Code",
    command: "kimi",
    args: ["-p", "{prompt}", "--output-format", "stream-json"],
    outputMode: "stream-json",
    protocol: "native-stream-json",
    install: "Install Kimi Code, then expose `kimi -p --output-format stream-json` on PATH. Legacy ACP notes belong to older `kimi-cli` research and are not the default latest Kimi Code path.",
    source: "https://moonshotai.github.io/kimi-code/en/reference/kimi-command.md",
    auth: {
      detail: "Authentication is delegated to Kimi Code login or API-key configuration.",
    },
  },
].map((definition) => ({ ...DEFAULT_CLI_HEADLESS_METADATA, ...definition }));

export const PLANNED_HARNESSES = [
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

export const BUILTIN_HARNESSES = [
  ...BUILTIN_ACP_HARNESSES,
  ...BUILTIN_CLI_HEADLESS_HARNESSES,
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

export function createBuiltinCliHeadlessAdapters(options = {}) {
  return BUILTIN_CLI_HEADLESS_HARNESSES.map((definition) => {
    const adapter = createCliHeadlessAdapter(definition, options);
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

export function createBuiltinHarnessAdapters(options = {}) {
  return [
    ...createBuiltinAcpAdapters(options),
    ...createBuiltinCliHeadlessAdapters(options),
  ];
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
