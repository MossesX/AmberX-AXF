#!/usr/bin/env bash
# claude-pick — asks which model to run before starting Claude Code, then launches it.
#   bash deploy/claude-pick.sh [claude args…]
#   bash deploy/claude-pick.sh --install     # put it in ~/.local/bin, alias `claude` to it, add the model rule to ~/.claude/CLAUDE.md
# Skips the menu when you already pass --model, run non-interactively (-p/--print), or stdin isn't a terminal.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${1:-}" == "--install" ]]; then
  mkdir -p "$HOME/.local/bin" "$HOME/.claude"
  install -m 0755 "${BASH_SOURCE[0]}" "$HOME/.local/bin/claude-pick"
  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    [[ -f "$rc" ]] || continue
    grep -q "alias claude='claude-pick'" "$rc" || printf "\n# AXF: ask which model before starting Claude Code\nalias claude='claude-pick'\n" >> "$rc"
  done
  # Brett's rules + memory, imported from this clone so they stay current after every git pull.
  rules="$(cd "$HERE/.." && pwd)/memory/RULES.md"
  if [[ -f "$rules" ]] && ! grep -qF "@$rules" "$HOME/.claude/CLAUDE.md" 2>/dev/null; then
    printf "\n<!-- AXF rules: Brett's working rules, decisions and memory (from the AmberX-AXF clone) -->\n@%s\n" "$rules" >> "$HOME/.claude/CLAUDE.md"
  fi
  # Shared memory on axHub (memory/<repo>/): install its SessionStart hook when the axHub clone is here.
  for hub in "$HOME/axHub" "$HOME/axhub" "$(cd "$HERE/../.." && pwd)/axHub"; do
    if [[ -f "$hub/clients/claude-code/axhub-memory.mjs" ]]; then node "$hub/clients/claude-code/axhub-memory.mjs" install; break; fi
  done
  echo "Installed. Open a new shell (or: source ~/.bashrc), then run: claude"
  echo "Bypass the menu with: command claude …  or  claude --model opus"
  exit 0
fi

for a in "$@"; do case "$a" in --model|--model=*|-p|--print) exec claude "$@";; esac; done
[[ -t 0 && -t 1 ]] || exec claude "$@"

echo "Which model?"
echo "  1) Fable   strongest: kernel internals, cross-port contracts, big refactors"
echo "  2) Opus    most work; servers, shells, auth, deploy"
echo "  3) Sonnet  only when it's clearly enough"
echo "  4) Keep the default"
read -r -p "Pick 1-4 [2]: " n
case "${n:-2}" in
  1|f|F|fable) m=fable ;;
  2|o|O|opus) m=opus ;;
  3|s|S|sonnet) m=sonnet ;;
  *) exec claude "$@" ;;
esac
echo "Starting Claude Code on $m (switch later with /model)."
exec claude --model "$m" "$@"
