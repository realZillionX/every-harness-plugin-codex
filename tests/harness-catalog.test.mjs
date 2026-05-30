import assert from "node:assert/strict";
import test from "node:test";

import {
  BUILTIN_ACP_HARNESSES,
  BUILTIN_CLI_HEADLESS_HARNESSES,
  BUILTIN_HARNESSES,
  createBuiltinAcpAdapters,
  createBuiltinCliHeadlessAdapters,
  createBuiltinHarnessAdapters,
} from "../scripts/lib/adapters/builtin-harnesses.mjs";

const REQUIRED_HARNESSES = [
  "opencode",
  "openclaw",
  "antigravity",
  "codewhale",
  "kimi-code",
  "trae",
  "qoder",
  "copilot",
  "cursor",
  "kiro",
];

function assertCatalogMetadata(definition) {
  assert.equal(typeof definition.source, "string", `${definition.id} missing source`);
  assert.ok(definition.source.length > 0, `${definition.id} source is empty`);
  assert.equal(typeof definition.install, "string", `${definition.id} missing install`);
  assert.ok(definition.install.length > 0, `${definition.id} install is empty`);
  assert.equal(typeof definition.maturity, "string", `${definition.id} missing maturity`);
  assert.match(definition.maturity, /^(stable|experimental)$/);
  assert.equal(typeof definition.protocol, "string", `${definition.id} missing protocol`);
  assert.ok(definition.protocol.length > 0, `${definition.id} protocol is empty`);
}

function requireDefinition(definitions, id) {
  const definition = definitions.find((candidate) => candidate.id === id || candidate.aliases?.includes(id));
  assert.ok(definition, `${id} catalog entry missing`);
  return definition;
}

test("harness catalog keeps concrete harnesses explicit", () => {
  for (const definition of BUILTIN_HARNESSES) {
    assertCatalogMetadata(definition);
  }

  for (const id of REQUIRED_HARNESSES) {
    requireDefinition(BUILTIN_HARNESSES, id);
  }

  assert.ok(BUILTIN_ACP_HARNESSES.every((definition) => definition.protocol === "acp"));

  const antigravity = requireDefinition(BUILTIN_CLI_HEADLESS_HARNESSES, "antigravity");
  assert.equal(antigravity.protocol, "native-text");
  assert.match(antigravity.install, /agy --print/);
  assert.match(antigravity.install, /ACP.*JSON.*stream/i);

  const codewhale = requireDefinition(BUILTIN_CLI_HEADLESS_HARNESSES, "codewhale");
  assert.equal(codewhale.protocol, "native-stream-json");
  assert.deepEqual(codewhale.aliases, []);
  assert.doesNotMatch(codewhale.install, /acp|DeepSeek TUI/i);

  const kimiCode = requireDefinition(BUILTIN_CLI_HEADLESS_HARNESSES, "kimi-code");
  assert.equal(kimiCode.protocol, "native-stream-json");
  assert.match(kimiCode.install, /kimi -p --output-format stream-json/);
  assert.doesNotMatch(kimiCode.install, /kimi acp/);
});

test("public harness ids use product names instead of cli-flavored ids", () => {
  const publicIds = [
    ...BUILTIN_HARNESSES.map((definition) => definition.id),
  ];
  const publicAliases = [
    ...BUILTIN_HARNESSES.flatMap((definition) => definition.aliases ?? []),
  ];
  for (const id of publicIds) {
    assert.doesNotMatch(id, /-cli$/);
    assert.doesNotMatch(id, /-bridge$/);
    assert.notEqual(id, "cursor-agent");
  }
  for (const alias of publicAliases) {
    assert.doesNotMatch(alias, /-cli$/);
    assert.doesNotMatch(alias, /-bridge$/);
    assert.notEqual(alias, "cursor-agent");
  }
  assert.deepEqual([...publicIds].sort(), [
    "antigravity",
    "codewhale",
    "copilot",
    "cursor",
    "kimi-code",
    "kiro",
    "openclaw",
    "opencode",
    "qoder",
    "trae",
  ]);
});

test("catalog factories preserve protocol boundaries", async () => {
  const acpAdapters = createBuiltinAcpAdapters({
    spawnSyncImpl: () => ({ status: 1, stderr: "not installed" }),
  });
  const headlessAdapters = createBuiltinCliHeadlessAdapters({
    spawnSyncImpl: () => ({ status: 1, stderr: "not installed" }),
  });
  const builtinAdapters = createBuiltinHarnessAdapters({
    spawnSyncImpl: () => ({ status: 1, stderr: "not installed" }),
  });

  assert.ok(acpAdapters.every((adapter) => adapter.protocol === "acp"));
  assert.ok(headlessAdapters.every((adapter) => adapter.protocol.startsWith("native-")));
  assert.equal(builtinAdapters.length, acpAdapters.length + headlessAdapters.length);

  for (const adapter of builtinAdapters) {
    const availability = await adapter.checkAvailability();
    assert.equal(typeof availability.detail, "string");
    assert.equal(availability.maturity, adapter.maturity);
    assert.equal(availability.protocol, adapter.protocol);
  }
});
