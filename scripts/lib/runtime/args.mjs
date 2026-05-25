export function splitRawArgumentString(raw) {
  const input = String(raw ?? "");
  const args = [];
  let current = "";
  let quote = null;
  let escaping = false;

  for (const char of input) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === "\\") {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (escaping) current += "\\";
  if (quote) {
    throw new Error(`Unterminated ${quote} quote in arguments.`);
  }
  if (current) args.push(current);
  return args;
}

export function normalizeArgv(argv) {
  if (argv.length === 1) {
    const [raw] = argv;
    if (!raw || !String(raw).trim()) return [];
    return splitRawArgumentString(raw);
  }
  return [...argv];
}

export function parseArgs(argv, config = {}) {
  const args = normalizeArgv(argv);
  const valueOptions = new Set(config.valueOptions ?? []);
  const booleanOptions = new Set(config.booleanOptions ?? []);
  const aliasMap = config.aliasMap ?? {};
  const options = {};
  const positionals = [];

  function normalizeName(name) {
    return aliasMap[name] ?? name;
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      positionals.push(...args.slice(i + 1));
      break;
    }

    if (!arg.startsWith("-") || arg === "-") {
      positionals.push(arg);
      continue;
    }

    if (arg.startsWith("--")) {
      const [rawName, inlineValue] = arg.slice(2).split(/=(.*)/s, 2);
      const name = normalizeName(rawName);
      if (valueOptions.has(name)) {
        if (inlineValue !== undefined) {
          options[name] = inlineValue;
        } else {
          const value = args[++i];
          if (value == null || value.startsWith("--")) {
            throw new Error(`Missing value for --${rawName}.`);
          }
          options[name] = value;
        }
        continue;
      }
      if (booleanOptions.has(name)) {
        options[name] = true;
        continue;
      }
      throw new Error(`Unknown option --${rawName}.`);
    }

    const shortName = normalizeName(arg.slice(1));
    if (valueOptions.has(shortName)) {
      const value = args[++i];
      if (value == null || value.startsWith("-")) {
        throw new Error(`Missing value for ${arg}.`);
      }
      options[shortName] = value;
      continue;
    }
    if (booleanOptions.has(shortName)) {
      options[shortName] = true;
      continue;
    }
    throw new Error(`Unknown option ${arg}.`);
  }

  return { options, positionals };
}

export function parseCommandArgs(argv) {
  return parseArgs(argv, {
    valueOptions: [
      "harness",
      "model",
      "effort",
      "cwd",
      "prompt-file",
      "timeout-ms",
      "poll-interval-ms",
      "owner-session-id",
      "job-id",
    ],
    booleanOptions: [
      "json",
      "wait",
      "all",
      "background",
      "write",
      "read-only",
      "resume",
      "resume-last",
      "fresh",
      "enable-review-gate",
      "disable-review-gate",
      "quiet-progress",
    ],
    aliasMap: {
      C: "cwd",
      m: "model",
      h: "harness",
    },
  });
}
