#!/usr/bin/env bash
# Every Harness installer: install the CLI and copy the Skill into agent harness skill directories.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HARNESSES=""
INSTALL_CLI=1

usage() {
  cat <<'EOF'
Usage: scripts/install.sh [--harness claude,codex,gemini,openclaw,opencode] [--no-cli]

Options:
  --harness <list>   Comma-separated harness list. Defaults to auto-detection.
  --no-cli           Copy the Skill only; skip npm install -g.
  -h, --help         Show this help.
EOF
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --harness) HARNESSES="$2"; shift 2 ;;
    --harness=*) HARNESSES="${1#*=}"; shift ;;
    --no-cli) INSTALL_CLI=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) die "unknown argument: $1" ;;
  esac
done

detect_harnesses() {
  local found=()
  [[ -d "$HOME/.claude" ]] && found+=("claude")
  [[ -d "$HOME/.codex" ]] && found+=("codex")
  [[ -d "$HOME/.gemini" ]] && found+=("gemini")
  [[ -d "$HOME/.openclaw" ]] && found+=("openclaw")
  [[ -d "${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}" ]] && found+=("opencode")
  (IFS=,; printf '%s\n' "${found[*]:-}")
}

if [[ -z "$HARNESSES" ]]; then
  HARNESSES="$(detect_harnesses)"
  [[ -n "$HARNESSES" ]] || die "no harness detected; pass --harness codex,claude,gemini,openclaw,opencode"
fi

if (( INSTALL_CLI )); then
  command -v npm >/dev/null 2>&1 || die "npm is required to install the CLI"
  npm install -g "$ROOT"
fi

install_skill() {
  local harness="$1"
  local target
  case "$harness" in
    claude) target="$HOME/.claude/skills/every-harness" ;;
    codex) target="$HOME/.codex/skills/every-harness" ;;
    gemini) target="$HOME/.gemini/skills/every-harness" ;;
    openclaw) target="$HOME/.openclaw/skills/every-harness" ;;
    opencode) target="${OPENCODE_CONFIG_DIR:-$HOME/.config/opencode}/skills/every-harness" ;;
    *) die "unknown harness: $harness" ;;
  esac

  rm -rf "$target"
  mkdir -p "$target"
  cp "$ROOT/SKILL.md" "$target/SKILL.md"

  if [[ "$harness" == "codex" ]]; then
    mkdir -p "$target/agents"
    cat >"$target/agents/openai.yaml" <<'YAML'
interface:
  display_name: "Every Harness"
  short_description: "Delegate scoped work to installed external harness CLIs through the every-harness mailbox."
YAML
  fi

  printf 'skill -> %s\n' "$target"
}

IFS=',' read -r -a HARNESS_LIST <<<"$HARNESSES"
for harness in "${HARNESS_LIST[@]}"; do
  install_skill "$harness"
done

printf 'Every Harness installed. Verify with: every-harness --help\n'
