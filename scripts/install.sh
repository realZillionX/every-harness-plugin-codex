#!/usr/bin/env bash
# Every Harness installer: install the CLI and copy the Skill into Codex.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALL_CLI=1

usage() {
  cat <<'EOF'
Usage: scripts/install.sh [--no-cli]

Options:
  --no-cli    Copy the Skill only; skip npm install -g.
  -h, --help  Show this help.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-cli) INSTALL_CLI=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

if (( INSTALL_CLI )); then
  command -v npm >/dev/null 2>&1 || die "npm is required to install the CLI"
  npm install -g "$ROOT"
fi

CODEX_ROOT="${CODEX_HOME:-$HOME/.codex}"
TARGET="$CODEX_ROOT/skills/every-harness"

rm -rf "$TARGET"
mkdir -p "$TARGET/agents"
cp "$ROOT/SKILL.md" "$TARGET/SKILL.md"
cat >"$TARGET/agents/openai.yaml" <<'YAML'
interface:
  display_name: "Every Harness"
  short_description: "Delegate scoped work to installed external harness CLIs through the every-harness mailbox."
YAML

printf 'skill -> %s\n' "$TARGET"
printf 'Every Harness installed. Verify with: every-harness --help\n'
