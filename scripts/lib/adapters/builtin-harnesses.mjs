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
    aliases: [],
    displayName: "OpenClaw",
    command: "openclaw",
    args: ["acp"],
    install: "Install OpenClaw, then expose an `openclaw acp` command on PATH.",
    source: "https://acpx.sh/agents.html#openclaw",
  },
  {
    id: "qoder",
    aliases: ["qodercli"],
    displayName: "Qoder",
    command: "qodercli",
    args: ["--acp"],
    install: "Install with `npm install -g @qoder-ai/qodercli`.",
    source: "https://acpx.sh/agents.html#qoder",
    auth: { envKeys: ["QODER_PERSONAL_ACCESS_TOKEN"] },
  },
  {
    id: "trae",
    aliases: ["traecli"],
    displayName: "TRAE",
    command: "traecli",
    args: ["acp", "serve"],
    install: "Install TRAE CLI from the official distribution, then expose `traecli acp serve` on PATH.",
    source: "https://acpx.sh/agents.html#trae",
    auth: { envKeys: ["TRAECLI_PERSONAL_ACCESS_TOKEN"] },
  },
  {
    id: "copilot",
    aliases: ["github-copilot"],
    displayName: "GitHub Copilot",
    command: "copilot",
    args: ["--acp", "--stdio"],
    install: "Install with `npm install -g @github/copilot`.",
    source: "https://acpx.sh/agents.html#copilot",
    auth: { envKeys: ["COPILOT_GITHUB_TOKEN", "GH_TOKEN", "GITHUB_TOKEN"] },
  },
  {
    id: "cursor",
    aliases: [],
    displayName: "Cursor",
    command: "cursor-agent",
    args: ["acp"],
    install: "Install Cursor's agent CLI, then expose `cursor-agent acp` on PATH.",
    source: "https://acpx.sh/agents.html#cursor",
    auth: { envKeys: ["CURSOR_API_KEY"] },
  },
  {
    id: "kiro",
    aliases: [],
    displayName: "Kiro",
    command: "kiro-cli",
    args: ["acp"],
    install: "Install Kiro CLI and expose `kiro-cli acp` on PATH.",
    source: "https://acpx.sh/agents.html#kiro",
    auth: { envKeys: ["KIRO_API_KEY"] },
  },
].map((definition) => ({ ...DEFAULT_ACP_METADATA, ...definition }));

const DEFAULT_CLI_HEADLESS_METADATA = Object.freeze({
  maturity: "experimental",
});

export const BUILTIN_CLI_HEADLESS_HARNESSES = [
  {
    id: "antigravity",
    aliases: ["agy"],
    displayName: "Antigravity",
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
    aliases: [],
    displayName: "CodeWhale",
    command: "codewhale",
    args: ["exec", "--auto", "--output-format", "stream-json"],
    outputMode: "stream-json",
    protocol: "native-stream-json",
    install: "Install CodeWhale, then expose `codewhale exec --auto --output-format stream-json` on PATH.",
    source: "https://github.com/Hmbown/CodeWhale",
    auth: {
      envKeys: ["DEEPSEEK_API_KEY"],
      detail: "Configure CodeWhale auth through its config file or provider environment.",
    },
  },
  {
    id: "kimi-code",
    aliases: ["kimi"],
    displayName: "Kimi Code",
    command: "kimi",
    args: ["-p", "{prompt}", "--output-format", "stream-json"],
    outputMode: "stream-json",
    protocol: "native-stream-json",
    install: "Install Kimi Code, then expose `kimi -p --output-format stream-json` on PATH.",
    source: "https://moonshotai.github.io/kimi-code/en/reference/kimi-command.md",
    auth: {
      detail: "Authentication is delegated to Kimi Code login or API-key configuration.",
    },
  },
].map((definition) => ({ ...DEFAULT_CLI_HEADLESS_METADATA, ...definition }));

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
