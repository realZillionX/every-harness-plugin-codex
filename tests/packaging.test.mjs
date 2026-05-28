import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
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
  assert.equal(pkg.name, "every-harness-skill");
  assert.equal(pkg.description, "Agent Skill and CLI for delegating work to external harnesses through a shared mailbox runtime.");
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

test("installer installs the CLI and copies the Skill to harness skill directories", () => {
  const installer = readText("scripts/install.sh");
  assert.match(installer, /npm install -g/);
  assert.match(installer, /\.claude\/skills\/every-harness/);
  assert.match(installer, /\.codex\/skills\/every-harness/);
  assert.match(installer, /\.gemini\/skills\/every-harness/);
  assert.match(installer, /\.openclaw\/skills\/every-harness/);
  assert.match(installer, /\.config\/opencode.*skills\/every-harness/);
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
