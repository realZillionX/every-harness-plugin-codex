import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILTIN_ACP_HARNESSES,
  PLANNED_HARNESSES,
  createBuiltinAcpAdapters,
  createPlannedHarnessAdapters,
} from "../scripts/lib/adapters/builtin-harnesses.mjs";
import { renderSetupReport } from "../scripts/lib/runtime/render.mjs";

const REQUESTED_HARNESSES = [
  "opencode",
  "openclaw",
  "gemini-cli",
  "antigravity-cli",
  "claude-code",
  "deepseek-tui",
  "kimi-code",
  "trae-cli",
  "qoder-cli",
];

function assertCatalogMetadata(definition) {
  assert.equal(typeof definition.source, "string", `${definition.id} missing source`);
  assert.ok(definition.source.length > 0, `${definition.id} source is empty`);
  assert.equal(typeof definition.install, "string", `${definition.id} missing install`);
  assert.ok(definition.install.length > 0, `${definition.id} install is empty`);
  assert.equal(typeof definition.maturity, "string", `${definition.id} missing maturity`);
  assert.match(definition.maturity, /^(stable|experimental|planned)$/);
  assert.equal(typeof definition.protocol, "string", `${definition.id} missing protocol`);
  assert.ok(definition.protocol.length > 0, `${definition.id} protocol is empty`);
}

function setupAdapter(definition, overrides = {}) {
  return {
    id: definition.id,
    aliases: definition.aliases ?? [],
    displayName: definition.displayName,
    maturity: definition.maturity,
    protocol: definition.protocol,
    install: definition.install,
    availability: {
      available: false,
      detail: definition.reason ?? `${definition.displayName} unavailable: not installed`,
      install: definition.install,
      source: definition.source,
      protocol: definition.protocol,
    },
    auth: {
      loggedIn: null,
      detail: "Authentication is delegated to the harness CLI.",
    },
    ...overrides,
  };
}

test("built-in and planned harness catalog entries expose setup metadata", () => {
  for (const definition of [...BUILTIN_ACP_HARNESSES, ...PLANNED_HARNESSES]) {
    assertCatalogMetadata(definition);
  }
  assert.ok(BUILTIN_ACP_HARNESSES.every((definition) => definition.protocol === "acp"));
  assert.ok(BUILTIN_ACP_HARNESSES.every((definition) => definition.maturity === "experimental"));
});

test("built-in ACP adapters expose catalog metadata to setup availability", async () => {
  const adapters = createBuiltinAcpAdapters({
    spawnSyncImpl: () => ({ status: 1, stderr: "not installed" }),
  });

  for (const definition of BUILTIN_ACP_HARNESSES) {
    const adapter = adapters.find((candidate) => candidate.id === definition.id);
    assert.ok(adapter, `${definition.id} adapter missing`);
    assert.equal(adapter.source, definition.source);
    assert.equal(adapter.install, definition.install);
    assert.equal(adapter.maturity, definition.maturity);
    assert.equal(adapter.protocol, definition.protocol);

    const availability = await adapter.checkAvailability();
    assert.equal(availability.source, definition.source);
    assert.equal(availability.install, definition.install);
    assert.equal(availability.maturity, definition.maturity);
    assert.equal(availability.protocol, definition.protocol);
  }
});

test("setup report distinguishes stable, experimental, and planned harnesses", async () => {
  const builtinById = new Map(BUILTIN_ACP_HARNESSES.map((definition) => [definition.id, definition]));
  const [plannedAdapter] = createPlannedHarnessAdapters();
  const plannedAvailability = await plannedAdapter.checkAvailability();
  const plannedAuth = await plannedAdapter.checkAuth();
  const report = {
    adapters: [
      {
        id: "gemini-acp",
        aliases: ["gemini", "gemini-cli"],
        displayName: "Gemini ACP",
        maturity: "stable",
        protocol: "acp",
        availability: { available: true, detail: "Gemini CLI available." },
        auth: { loggedIn: true, detail: "Gemini auth is available." },
      },
      {
        id: "claude-cli",
        aliases: ["claude", "claude-code"],
        displayName: "Claude CLI",
        maturity: "stable",
        protocol: "native-cli",
        availability: { available: true, detail: "Claude CLI available." },
        auth: { loggedIn: true, detail: "Claude auth is available." },
      },
      setupAdapter(builtinById.get("opencode")),
      setupAdapter(builtinById.get("openclaw")),
      setupAdapter(builtinById.get("deepseek-tui")),
      setupAdapter(builtinById.get("kimi-code")),
      setupAdapter(builtinById.get("trae-cli")),
      setupAdapter(builtinById.get("qoder-cli")),
      {
        id: plannedAdapter.id,
        aliases: plannedAdapter.aliases,
        displayName: plannedAdapter.displayName,
        maturity: plannedAdapter.maturity,
        protocol: plannedAdapter.protocol,
        install: plannedAdapter.install,
        availability: plannedAvailability,
        auth: plannedAuth,
      },
    ],
  };

  const output = renderSetupReport(report);

  assert.ok(output.indexOf("Stable harnesses") < output.indexOf("Experimental harnesses"));
  assert.ok(output.indexOf("Experimental harnesses") < output.indexOf("Planned harnesses"));
  for (const harness of REQUESTED_HARNESSES) {
    assert.match(output, new RegExp(`\\b${harness}\\b`));
  }
  assert.match(output, /- antigravity-cli: planned, not runnable \(protocol: unverified\)/);
  assert.doesNotMatch(output, /- antigravity-cli: unavailable/);
  assert.doesNotMatch(output, /antigravity-cli: .*auth/);
  assert.match(output, /source: https:\/\/antigravity\.google\/docs\/cli-using/);
  assert.match(output, /install: No runnable install command is exposed/);
});
