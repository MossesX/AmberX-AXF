#!/usr/bin/env bash
# claude-pick — asks how to sign in (Claude plan or Anthropic API key) and which model, then starts Claude Code.
#   bash deploy/claude-pick.sh [claude args…]
#   bash deploy/claude-pick.sh --install      # put it in ~/.local/bin, alias `claude` to it, add the rules to ~/.claude/CLAUDE.md
#   claude-pick --set-key                     # save or replace the API key (pasted hidden) in ~/.anthropic-key (0600)
#   claude-pick --remove-key                  # delete the saved key
#   claude-pick --key-status                  # is a key saved? (shows only its last 4 characters)
# Skips the menus when you pass --model, run non-interactively (-p/--print), or stdin isn't a terminal.
# AXF_CLAUDE_AUTH=plan|api picks the sign-in without asking (also for -p runs). ANTHROPIC_KEY_FILE moves the key file.
# The key never goes in a repo: it lives only in the key file and is exported for the one claude process it starts.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEYF="${ANTHROPIC_KEY_FILE:-$HOME/.anthropic-key}"

key_saved() { [[ -s "$KEYF" ]]; }
key_tail() { local k; k="$(tr -d '[:space:]' < "$KEYF")"; printf '…%s' "${k: -4}"; }

save_key() {
  local k
  read -r -s -p "Paste your Anthropic API key (input hidden): " k; echo
  k="$(printf '%s' "$k" | tr -d '[:space:]')"
  [[ -n "$k" ]] || { echo "No key entered; nothing saved."; return 1; }
  [[ "$k" == sk-ant-* ]] || echo "Note: Anthropic API keys usually start with sk-ant-. Saving it anyway."
  mkdir -p "$(dirname "$KEYF")"
  ( umask 077; printf '%s\n' "$k" > "$KEYF.tmp" )
  chmod 600 "$KEYF.tmp" && mv -f "$KEYF.tmp" "$KEYF"
  echo "Key saved in $KEYF ($(key_tail))."
}

use_plan() { unset ANTHROPIC_API_KEY; }
use_api() {
  key_saved || { echo "No API key saved yet."; save_key || exit 1; }
  ANTHROPIC_API_KEY="$(tr -d '[:space:]' < "$KEYF")"; export ANTHROPIC_API_KEY
}
apply_auth_env() {
  case "${AXF_CLAUDE_AUTH:-}" in
    plan) use_plan ;;
    api) use_api ;;
  esac
}

case "${1:-}" in
  --set-key) save_key; exit $? ;;
  --remove-key)
    if key_saved || [[ -e "$KEYF" ]]; then rm -f "$KEYF"; echo "Removed $KEYF. Claude Code will use your Claude plan."; else echo "No saved key."; fi
    exit 0 ;;
  --key-status)
    if key_saved; then echo "API key saved in $KEYF ($(key_tail))."; else echo "No API key saved ($KEYF)."; fi
    exit 0 ;;
esac

if [[ "${1:-}" == "--install" ]]; then
  mkdir -p "$HOME/.local/bin" "$HOME/.claude"
  install -m 0755 "${BASH_SOURCE[0]}" "$HOME/.local/bin/claude-pick"
  for rc in "$HOME/.bashrc" "$HOME/.zshrc"; do
    [[ -f "$rc" ]] || continue
    grep -q "alias claude='claude-pick'" "$rc" || printf "\n# AXF: ask how to sign in and which model before starting Claude Code\nalias claude='claude-pick'\n" >> "$rc"
  done
  # claude-project: make any folder a Claude project (shell command + /claude-project in every Claude Code session).
  AXF_ROOT="$(cd "$HERE/.." && pwd)"
  if [[ -f "$AXF_ROOT/framework/cli/claude-project.mjs" ]]; then
    printf '#!/usr/bin/env bash\nexec node %q "$@"\n' "$AXF_ROOT/framework/cli/claude-project.mjs" > "$HOME/.local/bin/claude-project"
    chmod 0755 "$HOME/.local/bin/claude-project"
    mkdir -p "$HOME/.claude/commands"
    sed "s#<AXF>/framework/cli/claude-project.mjs#$AXF_ROOT/framework/cli/claude-project.mjs#g" "$AXF_ROOT/.claude/commands/claude-project.md" > "$HOME/.claude/commands/claude-project.md"
    echo "claude-project installed (shell command + /claude-project in every Claude Code session)."
  fi
  # Brett's rules + memory (axhub-projects@1): the claude-sync SessionStart hook syncs and loads _claude/ in every
  # project and _claude/shared everywhere. Drop the older @…/memory/RULES.md import if an earlier install added it.
  if [[ -f "$HOME/.claude/CLAUDE.md" ]]; then
    sed -i '/<!-- AXF rules: Brett.s working rules/d; /^@.*\/memory\/RULES\.md$/d' "$HOME/.claude/CLAUDE.md"
  fi
  found=""
  for hub in "$HOME/axHub" "$HOME/axhub" "$(cd "$HERE/../.." && pwd)/axHub" "$(cd "$HERE/../.." && pwd)/axhub"; do
    if [[ -f "$hub/clients/claude-code/claude-sync.mjs" ]]; then node "$hub/clients/claude-code/claude-sync.mjs" install; found=1; break; fi
  done
  [[ -n "$found" ]] || echo "Sync: clone MossesX/axHub to ~/axHub, then run: node ~/axHub/clients/claude-code/claude-sync.mjs install"
  echo "Installed. Open a new shell (or: source ~/.bashrc), then run: claude"
  echo "Save an API key with: claude-pick --set-key   ·   bypass the menus with: command claude …"
  exit 0
fi

# Non-interactive or model already chosen: no menus; only AXF_CLAUDE_AUTH applies.
for a in "$@"; do case "$a" in --model|--model=*|-p|--print) apply_auth_env; exec claude "$@";; esac; done
[[ -t 0 && -t 1 ]] || { apply_auth_env; exec claude "$@"; }

# ---- 1. sign-in ----
if [[ -n "${AXF_CLAUDE_AUTH:-}" ]]; then
  apply_auth_env; how="${AXF_CLAUDE_AUTH}"
else
  if key_saved; then saved="saved $(key_tail)"; else saved="no key saved yet"; fi
  echo "Sign in with?"
  echo "  1) Claude plan   your Pro/Max login (default)"
  echo "  2) API key       billed per use on your Console account ($saved)"
  echo "  3) Save or replace the API key, then use it"
  read -r -p "Pick 1-3 [1]: " s
  case "${s:-1}" in
    2|a|A|api) use_api; how=api ;;
    3) save_key || exit 1; use_api; how=api ;;
    *) use_plan; how=plan ;;
  esac
fi
if [[ "$how" == api ]]; then
  echo "Using the API key ($(key_tail)). Claude Code may ask once to approve it: answer yes."
  echo "claude.ai connectors and /schedule are off while the key is in use."
else
  echo "Using your Claude plan."
fi

# ---- 2. model ----
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
