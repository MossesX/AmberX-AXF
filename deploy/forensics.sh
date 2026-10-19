#!/usr/bin/env bash
# Read-only incident check for the VPS disk, run from Hostinger's recovery mode (the server's disk is mounted at /mnt,
# so nothing on it runs while we look). It never changes the disk: it only reads and writes its report to /root here.
#
#   bash forensics.sh [/mnt]          → full report in /root/forensics.txt, short summary on screen
#   less /root/forensics.txt          → read it; sections start with "=====".
#
# Secrets are masked in everything it prints (tokens, keys, passwords), so screenshots of the report are safe to share.
R="${1:-/mnt}"
OUT=/root/forensics.txt
SINCE="${SINCE:-2026-10-16}"   # the console's file-read bug shipped Oct 16 2026 (fixed Oct 18 19:53 ET)
FLAGS=()
flag() { FLAGS+=("$*"); }
mask() { sed -E 's/(ghp_|gho_|ghs_|github_pat_)[A-Za-z0-9_]+/\1***/g; s/(sk-ant-[a-z0-9]+-)[A-Za-z0-9_-]+/\1***/g; s/((TOKEN|SECRET|KEY|PASS(WORD)?|PASSWD)[A-Z_]*[=:][[:space:]]*)[^[:space:]"'"'"']+/\1***/Ig; s/(Bearer )[A-Za-z0-9._~+\/=-]+/\1***/g'; }
sec() { printf '\n===== %s =====\n' "$*"; }

[ -f "$R/etc/os-release" ] || { echo "No server disk at $R (expected $R/etc/os-release). Run: lsblk; mount | grep /mnt"; exit 1; }
exec 3>&1 >"$OUT" 2>&1
echo "Incident check of $R — $(date -u '+%F %T UTC') — changes since $SINCE"

# ------------------------------------------------------------------------------------------------ the flagged file
sec "1. The flagged file (.systemd-hlp*) — where is it?"
HITS="$(find "$R" -xdev \( -path "$R/proc" -o -path "$R/sys" \) -prune -o -name '.systemd-hlp*' -print 2>/dev/null)"
if [ -z "$HITS" ]; then echo "not on disk any more (it may have run from memory or deleted itself)"; flag "flagged file not found on disk"; fi
for f in $HITS; do
  ls -la --time-style=full-iso "$f"; stat -c 'changed %z  modified %y  size %s' "$f"; file "$f" 2>/dev/null; sha256sum "$f"
  case "$f" in
    "$R"/var/lib/docker/overlay2/*)
      ov="$(echo "$f" | sed -E "s#^$R/var/lib/docker/overlay2/([^/]+)/.*#\1#")"
      cid="$(grep -l "^$ov" "$R"/var/lib/docker/image/overlay2/layerdb/mounts/*/mount-id 2>/dev/null | sed -E 's#.*/mounts/([^/]+)/mount-id#\1#' | head -n1)"
      name="$(sed -E 's/.*"Name":"\/([^"]+)".*/\1/' "$R/var/lib/docker/containers/$cid/config.v2.json" 2>/dev/null)"
      echo "→ INSIDE CONTAINER: ${name:-unknown} (${cid:0:12})"; flag "malware inside container ${name:-?}";;
    "$R"/var/lib/containerd/io.containerd.snapshotter.v1.*/snapshots/*)
      echo "→ INSIDE A CONTAINER (containerd snapshot $(echo "$f" | sed -E 's#.*/snapshots/([0-9]+)/.*#\1#'); docker inspect shows which)"; flag "malware inside a container (containerd snapshot): ${f#$R}";;
    *) echo "→ ON THE SERVER ITSELF (host filesystem)"; flag "malware on the HOST: $f";;
  esac
  echo "-- printable strings (first 25, masked):"; strings -n 8 "$f" 2>/dev/null | head -n 25 | mask
done

sec "2. Hidden or executable files in temp folders (host + every container), newest first"
for d in "$R/tmp" "$R/var/tmp" "$R/dev/shm" "$R/root" "$R"/var/lib/docker/overlay2/*/diff/tmp "$R"/var/lib/docker/overlay2/*/diff/var/tmp "$R"/var/lib/docker/overlay2/*/diff/dev/shm; do
  [ -d "$d" ] || continue
  find "$d" -maxdepth 2 \( -name '.*' -o -perm -u+x \) -type f -newermt "$SINCE" -printf '%TF %TH:%TM  %10s  %p\n' 2>/dev/null
done | sort -r | head -n 60

# ------------------------------------------------------------------------------------------------ persistence
sec "3. Scheduled jobs (cron) — masked"
for f in "$R/etc/crontab" "$R"/etc/cron.d/* "$R"/var/spool/cron/crontabs/*; do
  [ -f "$f" ] || continue; echo "--- $f ($(stat -c %y "$f" | cut -c1-16))"; grep -v '^\s*#' "$f" | grep -v '^\s*$' | mask
done
for f in "$R"/etc/cron.{hourly,daily,weekly,monthly}/*; do [ -f "$f" ] && [ "$(find "$f" -newermt "$SINCE" 2>/dev/null)" ] && { echo "NEW/CHANGED: $f"; flag "cron script changed: ${f#$R}"; }; done
while read -r f; do flag "cron job downloads or runs something from /tmp: ${f#$R}"; done < <(grep -lE 'curl|wget|base64|/tmp/|\.sh *\|' "$R/etc/crontab" "$R"/etc/cron.d/* "$R"/var/spool/cron/crontabs/* 2>/dev/null)

sec "4. Startup services (systemd) changed since $SINCE"
find "$R/etc/systemd" "$R/lib/systemd/system" "$R/usr/lib/systemd/system" "$R/etc/init.d" "$R/etc/rc.local" -newermt "$SINCE" \( -type f -o -type l \) -printf '%TF %TH:%TM  %p\n' 2>/dev/null | sort -r | head -n 40
while read -r f; do
  echo "--- $f"; grep -E '^(ExecStart|ExecStartPre|User|Description)=' "$f" | mask; flag "new/changed service: ${f#$R}"; done < <(find "$R/etc/systemd/system" -newermt "$SINCE" -name '*.service' -type f 2>/dev/null)

sec "5. Users, root accounts, sudo"
awk -F: '$3==0 || $7 !~ /(nologin|false|sync|halt|shutdown)$/ {print}' "$R/etc/passwd"
while read -r l; do echo "$l"; flag "$l"; done < <(awk -F: '$3==0 && $1!="root" {print "EXTRA ROOT ACCOUNT: "$1}' "$R/etc/passwd")
find "$R/etc/passwd" "$R/etc/shadow" "$R/etc/group" "$R/etc/sudoers" "$R/etc/sudoers.d" -newermt "$SINCE" -printf 'changed %TF %TH:%TM  %p\n' 2>/dev/null
ls -la "$R/etc/sudoers.d" 2>/dev/null

sec "6. SSH keys that can log in"
for f in "$R"/root/.ssh/authorized_keys* "$R"/home/*/.ssh/authorized_keys*; do
  [ -f "$f" ] || continue; echo "--- $f ($(stat -c %y "$f" | cut -c1-16), $(grep -c . "$f") keys)"
  while read -r line; do [ -n "$line" ] && echo "$line" | ssh-keygen -lf - 2>/dev/null || echo "  (unreadable line: ${line:0:30}…)"; done < "$f"
  [ "$(find "$f" -newermt "$SINCE" 2>/dev/null)" ] && flag "SSH keys changed since $SINCE: ${f#$R}"
done
grep -E '^\s*(PermitRootLogin|PasswordAuthentication|AuthorizedKeysFile)' "$R/etc/ssh/sshd_config" "$R"/etc/ssh/sshd_config.d/* 2>/dev/null

sec "7. Rootkit / login hooks"
[ -s "$R/etc/ld.so.preload" ] && { echo "ld.so.preload:"; cat "$R/etc/ld.so.preload"; flag "/etc/ld.so.preload is set (rootkit sign)"; } || echo "no ld.so.preload (good)"
find "$R/etc/profile" "$R/etc/profile.d" "$R/etc/bash.bashrc" "$R/root/.bashrc" "$R/root/.profile" "$R/etc/environment" -newermt "$SINCE" -printf 'changed %TF %TH:%TM  %p\n' 2>/dev/null
grep -nE 'curl|wget|base64 -d|/tmp/|nohup' "$R/root/.bashrc" "$R/root/.profile" "$R"/etc/profile.d/* 2>/dev/null | mask

sec "8. Programs changed since $SINCE in system folders (top 50)"
find "$R/usr/local/bin" "$R/usr/local/sbin" "$R/usr/bin" "$R/usr/sbin" "$R/bin" "$R/sbin" "$R/opt" -xdev -type f -perm -u+x -newermt "$SINCE" \
  -not -path "$R/opt/axf/*" -printf '%TF %TH:%TM  %10s  %p\n' 2>/dev/null | sort -r | head -n 50

# ------------------------------------------------------------------------------------------------ the console's folder
sec "9. The console's folder (/opt/axf): anything that isn't from GitHub"
A="$R/opt/axf"
if [ -d "$A/.git" ]; then
  G=(git -c safe.directory='*' -C "$A")
  echo "HEAD: $("${G[@]}" log -1 --format='%h %ci %s' 2>/dev/null)"
  echo "-- files changed from the commit:"; "${G[@]}" status --porcelain --untracked-files=all 2>/dev/null | grep -vE '^\?\? (\.axf-console/|apps/console-web/(node_modules|dist)/|node_modules/|apps/demo/(node_modules|dist)/)' | head -n 40
  "${G[@]}" diff --stat 2>/dev/null | tail -n 5
  if [ -n "$("${G[@]}" diff --name-only -- deploy 2>/dev/null)" ]; then flag "deploy scripts edited on the server (run as root by cron)"; "${G[@]}" diff -- deploy 2>/dev/null | head -n 60 | mask; fi
  echo "-- git hooks (should be only *.sample):"; ls "$A/.git/hooks" | grep -v '\.sample$' && flag "git hooks present in /opt/axf/.git/hooks"
  echo "-- git config that runs commands:"; grep -nE 'fsmonitor|hooksPath|sshCommand|askpass|editor|pager|\[alias\]|filter|textconv' "$A/.git/config" && flag "/opt/axf/.git/config has command settings"
fi
echo "-- .axf-console/env variable NAMES (values hidden; only AXF_TOKEN, GITHUB_TOKEN, DOMAIN expected):"
sed -E 's/=.*//' "$A/.axf-console/env" 2>/dev/null
grep -vE '^(AXF_TOKEN|GITHUB_TOKEN|DOMAIN)=[^$`;&|()]*$' "$A/.axf-console/env" 2>/dev/null | grep -q . && flag "console env file has unexpected lines (it is sourced as root by the installer)"
echo "-- files in .axf-console changed since $SINCE:"; find "$A/.axf-console" -maxdepth 2 -type f -newermt "$SINCE" -printf '%TF %TH:%TM  %p\n' 2>/dev/null | sort -r | head -n 40
echo "-- saved console credentials (names only):"; sed -E 's/=.*//' "$A/.axf-console/secrets.env" 2>/dev/null
echo "-- the update + doctor scripts cron runs as root:"; for f in "$R/usr/local/bin/axf-console-update" "$R/usr/local/bin/claude" "$R/usr/local/bin/claude-sync"; do [ -f "$f" ] && echo "$f ($(stat -c %y "$f" | cut -c1-16))"; done
mask < "$R/usr/local/bin/axf-console-update" 2>/dev/null | head -n 12

# ------------------------------------------------------------------------------------------------ logs
sec "10. Console web requests that tried to read files or open a shell (from its container log)"
for d in "$R"/var/lib/docker/containers/*; do
  n="$(sed -E 's/.*"Name":"\/([^"]+)".*/\1/' "$d/config.v2.json" 2>/dev/null)"
  case "$n" in axf-console*) ;; *) continue;; esac
  echo "--- container $n"
  cat "$d"/*-json.log* 2>/dev/null | grep -aiE '%2e%2e|\.\./|%2f|proc/self|environ|\.axf-console|secrets\.env|/api/term|/ws|websocket' | head -n 60 | mask
  echo "-- distinct client addresses with those requests:"
  cat "$d"/*-json.log* 2>/dev/null | grep -aiE '%2e%2e|\.\./|proc/self|environ' | grep -oE '[0-9]{1,3}(\.[0-9]{1,3}){3}' | sort | uniq -c | sort -rn | head -n 15
  cat "$d"/*-json.log* 2>/dev/null | grep -aiqE '%2e%2e|proc/self|environ' && flag "console log shows file-read (path traversal) requests"
done

sec "11. SSH logins (accepted) and login attempts"
zcat -f "$R"/var/log/auth.log* 2>/dev/null | grep -aE 'Accepted (password|publickey)' | tail -n 40
echo "-- failed attempts: $(zcat -f "$R"/var/log/auth.log* 2>/dev/null | grep -acE 'Failed password|Invalid user')"
echo "-- new users / password changes / sudo:"; zcat -f "$R"/var/log/auth.log* 2>/dev/null | grep -aE 'useradd|usermod|passwd\[|chpasswd|new user|sudo: .*COMMAND' | tail -n 20 | mask
zcat -f "$R"/var/log/auth.log* 2>/dev/null | grep -aqE 'useradd|new user' && flag "a user was added (see section 11)"

sec "12. Containers on the server (newest first) — unknown names or images stand out"
for d in "$R"/var/lib/docker/containers/*; do
  [ -f "$d/config.v2.json" ] || continue
  c="$(grep -oE '"Created":"[^"]+"' "$d/config.v2.json" | head -n1 | cut -d'"' -f4 | cut -c1-16)"
  n="$(sed -E 's/.*"Name":"\/([^"]+)".*/\1/' "$d/config.v2.json")"
  i="$(grep -oE '"Image":"[^"]+"' "$d/config.v2.json" | head -n1 | cut -d'"' -f4)"
  p="$(grep -qE '"Privileged":true' "$d/hostconfig.json" 2>/dev/null && echo PRIVILEGED)"
  s="$(grep -qE 'docker\.sock' "$d/hostconfig.json" 2>/dev/null && echo DOCKER-SOCKET)"
  echo "$c  $n  ${i:0:40}  $p $s"
done | sort -r | head -n 40

sec "13. Root's shell history (last 40, masked) — commands nobody here typed stand out"
tail -n 40 "$R/root/.bash_history" 2>/dev/null | mask

sec "14. Timeline: everything changed on the server between $SINCE and now (system folders, newest 60)"
find "$R/etc" "$R/root" "$R/usr/local" "$R/var/spool" "$R/tmp" "$R/var/tmp" "$R/opt/axf/deploy" "$R/opt/axf/.git/hooks" -xdev -newermt "$SINCE" -type f \
  -not -path "$R/etc/ssl/*" -not -path "$R/root/.npm/*" -not -path "$R/root/.cache/*" -printf '%TF %TH:%TM  %p\n' 2>/dev/null | sort -r | head -n 60

# ------------------------------------------------------------------------------------------------ summary
exec >&3
echo
echo "================ SUMMARY (full report: less /root/forensics.txt) ================"
if [ "${#FLAGS[@]}" -eq 0 ]; then echo "No red flags beyond the file Hostinger found."; else printf '! %s\n' "${FLAGS[@]}"; fi
echo "Read the sections in order: less /root/forensics.txt  (space = next page, / = search, q = quit)"
