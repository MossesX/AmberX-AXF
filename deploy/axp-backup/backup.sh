#!/usr/bin/env bash
# AXP backup: copy each live AXP folder to its backup checkout (code only, never data, media or secrets),
# scan it for secrets, and commit + push to its private MossesX repo only when something changed.
# Live folders are only read. Failures are raised as a red console banner item (source "system").
# Usage: backup.sh [--no-push]
set -uo pipefail
ROOT=/root/axp-backup
BIN=$ROOT/bin
LOG=$ROOT/backup.log
MAX_MB=200
PUSH=1; [ "${1:-}" = "--no-push" ] && PUSH=0
SOURCES=("axp-xchat:/opt/amberx/xchat" "axp-devstudio:/opt/axp-devstudio" "axp-demo:/opt/axp-demo")
log() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }

alert() { # alert <key> <severity> <title> <body>
  local payload
  payload=$(python3 -c 'import json,sys; print(json.dumps({"source":"system","severity":sys.argv[2],"key":sys.argv[1],"title":sys.argv[3][:200],"body":sys.argv[4][:1900]}))' "$@")
  docker exec -i axf-console sh -c 'curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:7090/api/alerts -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" --data-binary @-' <<<"$payload" >/dev/null 2>&1 || log "could not raise console alert $1"
}
resolve() {
  docker exec -i axf-console sh -c 'curl -s -o /dev/null -X POST http://127.0.0.1:7090/api/alerts/resolve -H "Authorization: Bearer $AXF_TOKEN" -H "Content-Type: application/json" --data-binary @-' <<<"{\"keys\":[\"$1\"]}" >/dev/null 2>&1 || true
}

fail=0
for p in "${SOURCES[@]}"; do
  name=${p%%:*}; src=${p#*:}; dst=$ROOT/$name; key="system:axp-backup-$name"
  mkdir -p "$dst"
  # Copy code only. P rules keep the backup's own repo files from being deleted.
  if ! rsync -a --delete --delete-excluded \
      --filter='P /.git/' --filter='P /.gitignore' --filter='P /.gitleaksignore' --filter='P /.env.example' --filter='P /BACKUP.md' \
      --exclude=/.gitignore --exclude-from="$BIN/excludes.txt" "$src/" "$dst/"; then
    log "$name: rsync failed"; alert "$key" error "AXP backup: copying $name failed" "rsync from $src to $dst failed. Log: $LOG"; fail=1; continue
  fi
  # Media over 1 MB outside public/ never goes in.
  big=$(cd "$dst" && find . -path ./.git -prune -o -type f -size +1M \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' -o -iname '*.gif' -o -iname '*.webp' -o -iname '*.mp4' -o -iname '*.webm' -o -iname '*.mov' \) -not -path './public/*' -not -path '*/public/*' -print)
  if [ -n "$big" ]; then
    log "$name: large media files, not committed: $(echo $big)"; alert "$key" error "AXP backup: $name has large media files" "Not committed. Add them to $BIN/excludes.txt or remove: $(echo $big | cut -c1-600)"; fail=1; continue
  fi
  # Secret scan (values are redacted; only counts and files are logged).
  report=$(mktemp)
  docker run --rm -v "$dst:/src:ro" -v "$(dirname "$report"):/out" zricethezav/gitleaks:latest dir /src \
    --redact --no-banner --gitleaks-ignore-path /src/.gitleaksignore -f json -r "/out/$(basename "$report")" >/dev/null 2>&1
  rc=$?
  if [ $rc -ne 0 ]; then
    files=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(len(d), "finding(s):", ", ".join(sorted({f["File"].replace("/src/","")+":"+str(f["StartLine"]) for f in d})))' "$report" 2>/dev/null || echo "scan error $rc")
    rm -f "$report"
    log "$name: secret scan not clean: $files"; alert "$key" error "AXP backup: possible secret in $name, not pushed" "gitleaks: $files. Move the value to the server's env, or add the fingerprint to $dst/.gitleaksignore if it's a test value. Then run $BIN/backup.sh"; fail=1; continue
  fi
  rm -f "$report"
  size=$(du -sm "$dst" --exclude=.git | cut -f1)
  if [ "$size" -gt "$MAX_MB" ]; then
    log "$name: ${size} MB > ${MAX_MB} MB, not pushed"; alert "$key" error "AXP backup: $name is ${size} MB, over ${MAX_MB} MB" "Not pushed. Biggest: $(cd "$dst" && du -a --exclude=.git . | sort -rn | sed -n '2,6p' | tr '\n' ' ')"; fail=1; continue
  fi
  cd "$dst" || continue
  [ -d .git ] || { git init -q -b main && git remote add origin "git@github.com:MossesX/$name.git"; }
  git add -A
  if ! git diff --cached --quiet || ! git rev-parse -q --verify HEAD >/dev/null; then
    if git rev-parse -q --verify HEAD >/dev/null; then msg="Nightly backup of $name from the VPS, $(date -u '+%b %-d %Y')"; else msg="Backup of $name from the VPS, Nov 1 2026"; fi
    git -c user.name=Claude -c user.email=noreply@anthropic.com commit -q -m "$msg" && log "$name: committed $(git rev-parse --short HEAD)"
  fi
  if [ $PUSH -eq 1 ]; then
    if [ -n "$(git log origin/main..main --oneline 2>/dev/null)" ] || ! git rev-parse -q --verify origin/main >/dev/null; then
      if git push -q -u origin main 2>>"$LOG"; then log "$name: pushed"; resolve "$key"
      else log "$name: push failed"; alert "$key" error "AXP backup: push of $name failed" "git push to MossesX/$name failed (repo missing, or no push access). Log: $LOG"; fail=1; fi
    else resolve "$key"; fi
  fi
  cd "$ROOT"
done
exit $fail
