#!/usr/bin/env bash
# AXF console setup / doctor — run on the VPS host (mosh or ssh). Checks what the Dev Console needs on the host,
# fixes what you approve, and writes a report the console shows in its systems check banner.
#
#   bash /opt/axf/deploy/console-doctor.sh               check everything, offer each fix (asks first, every time)
#   bash /opt/axf/deploy/console-doctor.sh --fix <id>    offer the fix for one check (ids below / in the console)
#   bash /opt/axf/deploy/console-doctor.sh --report      check only, no questions (cron runs this every 15 minutes)
#
# Report: $DIR/.axf-console/host-check.json (no secrets: statuses and short summaries only).
set -u
DIR="${DIR:-/opt/axf}"
NAME="${NAME:-axf-console}"
REPORT="$DIR/.axf-console/host-check.json"
MODE="interactive"; ONLY=""
case "${1:-}" in
  --report) MODE="report" ;;
  --fix) ONLY="${2:-}"; [ -n "$ONLY" ] || { echo "usage: $0 --fix <check-id>"; exit 2; } ;;
  -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
esac
[ -t 0 ] || [ "$MODE" = "report" ] || MODE="report"   # no terminal → never ask

USER_HOME="${SUDO_USER:+$(getent passwd "$SUDO_USER" | cut -d: -f6)}"; USER_HOME="${USER_HOME:-$HOME}"
# claude, claude-pick and claude-sync install into ~/.local/bin, which cron's and vps.run's PATH don't have: without
# this every check below said they were missing even right after an Auto fix installed them.
export PATH="$USER_HOME/.local/bin:$PATH"
declare -A ST SUM
ORDER=()
put() { ST[$1]="$2"; SUM[$1]="$(printf '%s' "$3" | tr -d '"\\' | tr '\n' ' ' | cut -c1-280)"; [[ " ${ORDER[*]} " == *" $1 "* ]] || ORDER+=("$1"); }
have() { command -v "$1" >/dev/null 2>&1; }
ask() { [ "$MODE" = "interactive" ] || [ -n "$ONLY" ] || return 1; read -r -p "  → $1 [y/N] " a </dev/tty; [[ "$a" =~ ^[Yy] ]]; }
want() { [ -z "$ONLY" ] || [ "$ONLY" = "$1" ]; }

check_all() {
  # mosh
  if have mosh-server; then put host-mosh ok "mosh-server $(mosh-server --version 2>/dev/null | head -1 | awk '{print $2}') installed"
  else put host-mosh error "mosh-server is not installed"; fi
  # headless Claude Code runs in tmux so the console's Terminal can show it (deploy/claude-headless.sh, Oct 26 2026)
  if have tmux; then put host-tmux ok "tmux $(tmux -V 2>/dev/null | awk '{print $2}') installed"
  else put host-tmux warn "tmux isn't installed: headless Claude Code sessions can't show in the console's Terminal"; fi
  # firewall: mosh needs UDP 60000-61000
  if have ufw && ufw status 2>/dev/null | grep -q "Status: active"; then
    if ufw status 2>/dev/null | grep -Eq '60000:61000/udp.*ALLOW'; then put host-mosh-ports ok "ufw allows UDP 60000-61000"
    else put host-mosh-ports error "ufw is active but doesn't allow UDP 60000-61000 (mosh can't connect)"; fi
  else put host-mosh-ports info "ufw not active here; if Hostinger's firewall is on, allow UDP 60000-61000 in hPanel"; fi
  # docker + console container
  if have docker && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx "$NAME"; then put host-docker ok "container $NAME is running"
  elif have docker; then put host-docker error "Docker is installed but container $NAME isn't running"
  else put host-docker error "Docker is not installed"; fi
  # auto-update cron
  if [ -f /etc/cron.d/axf-console ]; then put host-update-cron ok "console auto-update every 5 minutes"; else put host-update-cron warn "no /etc/cron.d/axf-console: the console won't update itself"; fi
  # Claude Code
  if have claude; then put host-claude-cli ok "Claude Code $(claude --version 2>/dev/null | head -1)"; else put host-claude-cli error "Claude Code (claude) is not installed"; fi
  # Account email of the Claude plan sign-in (empty when signed in with an API key only, or jq is missing).
  CLAUDE_EMAIL=""; have jq && CLAUDE_EMAIL="$(jq -r '.oauthAccount.emailAddress // empty' "$USER_HOME/.claude.json" 2>/dev/null)"
  if [ -n "$CLAUDE_EMAIL" ]; then put host-claude-login ok "signed in as $CLAUDE_EMAIL"
  elif [ -s "$USER_HOME/.claude/.credentials.json" ] || [ -s "$USER_HOME/.anthropic-key" ]; then put host-claude-login ok "signed in (plan credentials or API key file present)"
  else put host-claude-login warn "no Claude sign-in found for $(basename "$USER_HOME"): run claude and /login"; fi
  # claude-pick --install puts the launcher in ~/.local/bin and an alias in ~/.bashrc / ~/.zshrc. Cron and vps.run are
  # non-interactive shells that never load aliases, so `command -v claude` alone always finds the real binary here.
  if [ -x "$USER_HOME/.local/bin/claude-pick" ] && { grep -qs "alias claude='claude-pick'" "$USER_HOME/.bashrc" "$USER_HOME/.zshrc" \
       || grep -qs "claude-pick" "$(command -v claude 2>/dev/null)"; }; then put host-claude-pick ok "claude starts on the Claude plan + Opus, no questions"
  elif [ -x "$USER_HOME/.local/bin/claude-pick" ]; then put host-claude-pick warn "claude-pick is installed but no shell alias points claude at it"
  else put host-claude-pick warn "claude-pick isn't installed: launches don't ask for the model"; fi
  if have claude-sync; then put host-claude-sync ok "claude-sync installed"; else put host-claude-sync warn "claude-sync isn't installed: rules and memory don't sync from the hub"; fi
  # Session check-in asks nothing at login (Oct 26 2026, Brett): installed or not is fine, the hook stays silent.
  if grep -qs "session-checkin/checkin.mjs" "$USER_HOME/.claude/settings.json" "$DIR/.claude/settings.json" "$DIR/.claude/settings.local.json"; then put host-session-checkin ok "session check-in hook installed, silent (no questions at login)"
  else put host-session-checkin ok "session check-in off (no questions at login)"; fi
  if [ -f "$USER_HOME/.anthropic-key" ]; then
    m=$(stat -c %a "$USER_HOME/.anthropic-key" 2>/dev/null); [ "$m" = "600" ] && put host-anthropic-keyfile ok "~/.anthropic-key is owner-only" || put host-anthropic-keyfile error "~/.anthropic-key is mode $m (should be 600)"
  else put host-anthropic-keyfile info "no ~/.anthropic-key (only needed for API-key sign-in)"; fi
  # GitHub access from the host clone
  if [ -d "$DIR/.git" ] && GIT_TERMINAL_PROMPT=0 timeout 20 git -C "$DIR" ls-remote -q origin HEAD >/dev/null 2>&1; then put host-git-auth ok "the VPS clone can reach GitHub"
  else put host-git-auth error "the VPS clone can't reach GitHub without a password (auto-update will fail)"; fi
  # Moshi (phone mosh/ssh app): a key named "moshi" that can sign in as root
  local mk; mk=$(grep -hiE '^[^#].* [^ ]*moshi[^ ]*$' /root/.ssh/authorized_keys 2>/dev/null | head -1)
  if [ -n "$mk" ]; then put host-moshi-key ok "Moshi's key can sign in as root ($(printf '%s\n' "$mk" | ssh-keygen -lf - 2>/dev/null | awk '{print $2}'))"
  else put host-moshi-key error "no key named moshi in root's authorized_keys: Moshi can't sign in with a key"; fi
  # axHub projects volume
  if have docker && docker volume ls -q 2>/dev/null | grep -Eq '(^|[-_])axhub-projects$'; then put host-axhub-volume ok "axhub-projects volume exists"
  else put host-axhub-volume warn "no axhub-projects volume: shared data stays in the legacy folder"; fi
}

fix() {
  local id="$1"; want "$id" || return 0
  [ "${ST[$id]:-ok}" = "ok" ] || [ "${ST[$id]:-}" = "info" ] && [ -z "$ONLY" ] && return 0
  echo; echo "✗ $id: ${SUM[$id]:-}"
  case "$id" in
    host-tmux) ask "Install tmux (apt-get install -y tmux)?" && { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq tmux; } ;;
    host-mosh) ask "Install mosh (apt-get install -y mosh)?" && { apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mosh; } ;;
    host-mosh-ports) ask "Allow UDP 60000-61000 in ufw (mosh)?" && ufw allow 60000:61000/udp; echo "  If Hostinger's firewall is on: hPanel → VPS → Firewall → allow UDP 60000-61000." ;;
    host-docker|host-update-cron) ask "Re-run the console installer (bash $DIR/deploy/install-console.sh)?" && bash "$DIR/deploy/install-console.sh" ;;
    host-claude-cli) ask "Install Claude Code (official installer from claude.ai/install.sh)?" && { curl -fsSL https://claude.ai/install.sh | bash; } ;;
    host-claude-login) echo "  Run: claude   then type /login and sign in with your Claude plan (or: claude-pick --set-key for an API key)." ;;
    host-claude-pick) ask "Install claude-pick as the claude launcher?" && bash "$DIR/deploy/claude-pick.sh" --install ;;
    host-claude-sync) if [ -f "$USER_HOME/axHub/clients/claude-code/claude-sync.mjs" ]; then ask "Install claude-sync from ~/axHub?" && node "$USER_HOME/axHub/clients/claude-code/claude-sync.mjs" install
                      else echo "  git clone https://github.com/MossesX/axHub ~/axHub && node ~/axHub/clients/claude-code/claude-sync.mjs install"; fi ;;
    host-session-checkin) echo "  Nothing to do: the session check-in asks no questions at login (its config's ask: true turns them back on)." ;;
    host-anthropic-keyfile) ask "Make ~/.anthropic-key owner-only (chmod 600)?" && chmod 600 "$USER_HOME/.anthropic-key" ;;
    host-git-auth) echo "  Store GitHub access for the clone: gh auth login   (or a token in git's credential helper), then: git -C $DIR fetch" ;;
    host-moshi-key)
      local k; k=$(grep -h '^MOSHI_SSH_PUBKEY=' "$DIR/.axf-console/secrets.env" 2>/dev/null | tail -1 | cut -d= -f2- | sed "s/^[\"']//;s/[\"']$//")
      if [ -z "$k" ]; then echo "  Paste Moshi's public key in the console (Keys needed banner), then run this again."; return 0; fi
      if ! printf '%s\n' "$k" | grep -Eq '^(ssh-ed25519|ecdsa-sha2-nistp(256|384|521)|ssh-rsa) [A-Za-z0-9+/=]+( [A-Za-z0-9@._ -]+)?$' || ! printf '%s\n' "$k" | ssh-keygen -lf - >/dev/null 2>&1; then
        echo "  The saved key isn't a valid public key; paste it again in the console."; return 0; fi
      local blob; blob=$(printf '%s' "$k" | awk '{print $2}')
      if grep -qsF "$blob" /root/.ssh/authorized_keys; then echo "  That key is already allowed."; return 0; fi
      echo "  Key: $(printf '%s\n' "$k" | ssh-keygen -lf -)"
      [ -t 0 ] || { echo "  Run this from a terminal: it asks before adding a sign-in key."; return 0; }
      read -r -p "  → Allow this key to sign in as root? [y/N] " a </dev/tty
      if [[ "$a" =~ ^[Yy] ]]; then
        install -d -m 700 /root/.ssh; touch /root/.ssh/authorized_keys; chmod 600 /root/.ssh/authorized_keys
        case "$k" in *" "*" "*) printf '%s\n' "$k" ;; *) printf '%s moshi\n' "$k" ;; esac >> /root/.ssh/authorized_keys && echo "  Added."
      fi ;;
    host-axhub-volume) echo "  Coolify → axHub → Persistent Storage: add volume axhub-projects at /projects, redeploy axHub, then: bash $DIR/deploy/install-console.sh" ;;
    *) echo "  unknown check id $id" ;;
  esac
}

write_report() {
  mkdir -p "$(dirname "$REPORT")"
  { printf '{"$axf":"host-check@1","at":%s,"host":"%s","checks":{' "$(date +%s)" "$(hostname)"
    local first=1
    for id in "${ORDER[@]}"; do [ $first -eq 1 ] || printf ','; first=0; printf '"%s":{"status":"%s","summary":"%s"}' "$id" "${ST[$id]}" "${SUM[$id]}"; done
    printf '}}\n'; } > "$REPORT.tmp" && chmod 644 "$REPORT.tmp" && mv "$REPORT.tmp" "$REPORT"
}

check_all
if [ "$MODE" = "interactive" ] || [ -n "$ONLY" ]; then
  echo "AXF console setup — $(hostname)"
  for id in "${ORDER[@]}"; do printf '  %-8s %-22s %s\n' "${ST[$id]}" "$id" "${SUM[$id]}"; done
  for id in "${ORDER[@]}"; do fix "$id"; done
  check_all
fi
write_report
bad=0; for id in "${ORDER[@]}"; do [ "${ST[$id]}" = "error" ] && bad=$((bad+1)); done
[ "$MODE" = "report" ] || echo; [ "$MODE" = "report" ] || echo "Report written to $REPORT ($bad error(s)). The console's banner updates on its next check."
exit 0
