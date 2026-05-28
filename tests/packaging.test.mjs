import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("distribution is a Skill plus CLI instead of a Codex plugin", () => {
  assert.equal(fs.existsSync(path.join(ROOT, ".codex-plugin", "plugin.json")), false);

  const pkg = JSON.parse(readText("package.json"));
  assert.equal(pkg.name, "every-harness-plugin-codex");
  assert.equal(pkg.description, "Codex Skill and CLI for delegating work to external harnesses through a shared mailbox runtime.");
  assert.deepEqual(pkg.bin, {
    "every-harness": "scripts/every-harness.mjs",
  });
  assert.ok(pkg.files.includes("SKILL.md"));
  assert.ok(pkg.files.includes("scripts"));
  assert.ok(!pkg.files.includes(".codex-plugin"));
  assert.ok(!pkg.files.includes("skills"));

  const skill = readText("SKILL.md");
  assert.match(skill, /^name: every-harness$/m);
  assert.match(skill, /`every-harness` CLI/);
  assert.doesNotMatch(skill, /ehplugin/);

  const readme = readText("README.md");
  assert.match(readme, /Skill \+ CLI/);
  assert.doesNotMatch(readme, /\.codex-plugin|Codex plugin|Every Harness Plugin|ehplugin/);
});

test("installer installs the CLI and copies the Skill only to Codex", () => {
  const installer = readText("scripts/install.sh");
  assert.match(installer, /npm install -g/);
  assert.match(installer, /CODEX_HOME/);
  assert.match(installer, /CODEX_HOME:-\$HOME\/\.codex/);
  assert.doesNotMatch(installer, /\.claude|\.gemini|\.openclaw|opencode|--harness/);
});

test("installer writes the Skill to CODEX_HOME without touching other harnesses", () => {
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "every-harness-home-"));
  const codexHome = path.join(tempHome, "codex-home");
  try {
    const result = spawnSync("bash", [path.join(ROOT, "scripts", "install.sh"), "--no-cli"], {
      cwd: ROOT,
      env: { ...process.env, HOME: tempHome, CODEX_HOME: codexHome },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(fs.existsSync(path.join(codexHome, "skills", "every-harness", "SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(codexHome, "skills", "every-harness", "agents", "openai.yaml")), false);
    assert.equal(fs.existsSync(path.join(tempHome, ".claude")), false);
    assert.equal(fs.existsSync(path.join(tempHome, ".gemini")), false);
    assert.equal(fs.existsSync(path.join(tempHome, ".openclaw")), false);
    assert.equal(fs.existsSync(path.join(tempHome, ".config", "opencode")), false);
  } finally {
    fs.rmSync(tempHome, { recursive: true, force: true });
  }
});

test("npm dry-run package contents match the intended distribution", () => {
  const result = spawnSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const [pack] = JSON.parse(result.stdout);
  const paths = new Set(pack.files.map((file) => file.path));
  assert.equal(paths.has("SKILL.md"), true);
  assert.equal(paths.has("scripts/every-harness.mjs"), true);
  assert.equal(paths.has("scripts/install.sh"), true);
  assert.equal(paths.has("package.json"), true);
  assert.equal(paths.has("tests/runtime.test.mjs"), false);
  assert.equal(paths.has(".codex-plugin/plugin.json"), false);
  assert.equal(paths.has("agents/openai.yaml"), false);
});

test("CLI exposes command help as the runtime contract", () => {
  const cli = path.join(ROOT, "scripts", "every-harness.mjs");
  for (const args of [
    ["--help"],
    ["run", "--help"],
    ["status", "--help"],
    ["cancel", "--help"],
  ]) {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: ROOT,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /every-harness/);
    assert.match(result.stdout, /run|status|cancel/);
  }
});
