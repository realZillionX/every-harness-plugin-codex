function normalizeTrailingNewline(text) {
  return `${String(text).replace(/\s*$/, "")}\n`;
}

function pushHooksFlag(lines) {
  let insertAt = lines.length;
  while (insertAt > 0 && lines[insertAt - 1].trim() === "") insertAt -= 1;
  lines.splice(insertAt, 0, "hooks = true");
}

export function ensureCodexHooksEnabled(content) {
  const lines = String(content ?? "").split("\n");
  const next = [];
  let inFeatures = false;
  let foundFeatures = false;
  let foundHooks = false;
  let changed = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\[.*\]$/.test(trimmed)) {
      if (inFeatures && !foundHooks) {
        pushHooksFlag(next);
        foundHooks = true;
        changed = true;
      }
      inFeatures = trimmed === "[features]";
      foundFeatures ||= inFeatures;
      next.push(line);
      continue;
    }

    if (inFeatures && /^codex_hooks\s*=/.test(trimmed)) {
      changed = true;
      continue;
    }

    if (inFeatures && /^hooks\s*=/.test(trimmed)) {
      foundHooks = true;
      if (trimmed !== "hooks = true") {
        next.push("hooks = true");
        changed = true;
      } else {
        next.push(line);
      }
      continue;
    }

    next.push(line);
  }

  if (inFeatures && !foundHooks) {
    pushHooksFlag(next);
    changed = true;
  }

  if (!foundFeatures) {
    if (next.length > 0 && next[next.length - 1].trim() !== "") next.push("");
    next.push("[features]", "hooks = true");
    changed = true;
  }

  return {
    changed,
    content: normalizeTrailingNewline(next.join("\n").replace(/\n{3,}/g, "\n\n")),
  };
}
