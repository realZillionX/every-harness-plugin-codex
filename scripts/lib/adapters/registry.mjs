const adapters = new Map();
const aliases = new Map();

export function clearAdapters() {
  adapters.clear();
  aliases.clear();
}

export function registerAdapter(adapter, adapterAliases = []) {
  if (!adapter?.id) throw new Error("Adapter must have an id.");
  adapters.set(adapter.id, adapter);
  for (const alias of adapterAliases) {
    aliases.set(alias, adapter.id);
  }
  for (const alias of adapter.aliases ?? []) {
    aliases.set(alias, adapter.id);
  }
  return adapter;
}

export function getAdapter(id) {
  const resolved = aliases.get(id) ?? id;
  return adapters.get(resolved) ?? null;
}

export function listAdapters() {
  return [...adapters.values()];
}

export function resolveHarnessSelection({ requestedHarness = null, defaultHarness = null } = {}) {
  if (requestedHarness) {
    const adapter = getAdapter(requestedHarness);
    if (!adapter) {
      throw new Error(`Unknown harness "${requestedHarness}".`);
    }
    return adapter;
  }
  if (defaultHarness) {
    const adapter = getAdapter(defaultHarness);
    if (adapter) return adapter;
  }
  const available = listAdapters();
  if (available.length === 1) return available[0];
  throw new Error(
    `Choose a harness with --harness <id>. Available harnesses: ${available.map((a) => a.id).join(", ")}.`
  );
}
