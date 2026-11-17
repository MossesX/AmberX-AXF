#!/usr/bin/env bash
# Dry run of deploy/install-host-services.sh: install, --only and --uninstall with every file written under a temp
# prefix and every privileged call printed instead of run. Checks the rendered units (no placeholder left, the
# hardening and the per-service NoNewPrivileges), the env files and their modes, the sudoers file (visudo -c when
# installed) and the calls each mode would make. Nothing on this machine changes.
#   bash deploy/dryrun/host-services.sh
set -euo pipefail
DIR="$(cd "$(dirname "$0")/../.." && pwd)"
T="$(mktemp -d /tmp/axf-host-dryrun.XXXXXX)"; trap 'rm -rf "$T"' EXIT
N=0; ok() { N=$((N + 1)); echo "  ✓ $*"; }
fail() { echo "  ✗ $*" >&2; exit 1; }
inst() { AXF_HOST_PREFIX="$T/root" AXF_HOST_DATA="$T/data" DIR="$DIR" bash "$DIR/deploy/install-host-services.sh" --dry-run "$@"; }
mkdir -p "$T/data"

inst > "$T/install.log" 2>&1 || { cat "$T/install.log"; fail "install --dry-run exited non-zero"; }
mapfile -t IDS < <(node "$DIR/deploy/host-services/axf-hostd.mjs" --plan | awk -F'\t' '$4=="yes"{print $1}')
for id in "${IDS[@]}"; do
  unit="$(node "$DIR/deploy/host-services/axf-hostd.mjs" --plan | awk -F'\t' -v i="$id" '$1==i{print $2}')"
  u="$T/root/etc/systemd/system/$unit"
  [ -f "$u" ] || fail "no unit for $id"
  grep -q '@[A-Z]*@\|%i' "$u" && fail "$u: placeholder left"
  grep -q "^ExecStart=/usr/bin/env node $DIR/deploy/host-services/axf-hostd.mjs $id\$" "$u" || fail "$u: ExecStart"
  for k in 'User=axf-host' 'Restart=always' 'WantedBy=multi-user.target' 'ProtectSystem=strict' 'RuntimeDirectory=axf-host' "ReadWritePaths=$DIR $T/data"; do grep -q "^$k" "$u" || fail "$u: $k"; done
  nnp="$(node "$DIR/deploy/host-services/axf-hostd.mjs" --plan | awk -F'\t' -v i="$id" '$1==i{print $3}')"
  grep -q "^NoNewPrivileges=$nnp\$" "$u" || fail "$u: NoNewPrivileges=$nnp"
  grep -q "^+ systemctl enable --now $unit\$" "$T/install.log" || fail "not enabled: $id"
done
ok "${#IDS[@]} unit(s) rendered from axf-host@.service, hardened, enabled"
[ "$(stat -c %a "$T/root/etc/axf-host/console.env")" = 600 ] || fail "console.env mode"
[ "$(stat -c %a "$T/root/etc/axf-host/env")" = 640 ] || fail "env mode"
grep -q '^AXF_HOST_API=unix:/run/axf-host/api.sock$' "$T/root/etc/axf-host/console.env" || fail "console.env AXF_HOST_API"
grep -q '^AXF_HOST_TOKEN=[0-9a-f]\{64\}$' "$T/root/etc/axf-host/env" || fail "token"
ok "env files: token, console endpoints, modes 640 / 600"
TOK1="$(sed -n 's/^AXF_HOST_TOKEN=//p' "$T/root/etc/axf-host/env")"
inst > /dev/null 2>&1
[ "$TOK1" = "$(sed -n 's/^AXF_HOST_TOKEN=//p' "$T/root/etc/axf-host/env")" ] || fail "token changed on re-run"
ok "re-run keeps the token"
S="$T/root/etc/sudoers.d/axf-host"
[ -f "$S" ] || fail "no sudoers"
grep -v '^#\|^Defaults\|^$' "$S" | grep -qv '^axf-host ALL=(root) NOPASSWD: /' && fail "sudoers: a line that is not a whitelist entry"
grep -q 'NOPASSWD: ALL\|(ALL)' "$S" && fail "sudoers: general root rule"
if command -v visudo >/dev/null; then visudo -c -f "$S" >/dev/null || fail "visudo"; fi
ok "sudoers from the manifests only, visudo clean"
for c in 'groupadd --system axf-host' 'useradd --system --gid axf-host' 'systemctl daemon-reload'; do
  if getent group axf-host >/dev/null && [ "${c%% *}" != systemctl ]; then continue; fi
  grep -q "^+ $c" "$T/install.log" || fail "missing call: $c"
done
ok "account and daemon-reload calls planned"

rm -rf "$T/root"
inst --only "${IDS[1]:-host-api}" > "$T/only.log" 2>&1 || { cat "$T/only.log"; fail "--only"; }
[ -f "$T/root/etc/systemd/system/axf-host-api.service" ] || fail "--only drops host-api"
[ "$(find "$T/root/etc/systemd/system" -name 'axf-*.service' | wc -l)" -le 2 ] || fail "--only installed more"
ok "--only ${IDS[1]:-host-api} installs that service and host-api"

inst --uninstall > "$T/un.log" 2>&1 || { cat "$T/un.log"; fail "--uninstall"; }
grep -q '^+ systemctl disable --now axf-host-api.service$' "$T/un.log" || fail "uninstall: host-api not stopped"
grep -q '^+ userdel axf-host$' "$T/un.log" || fail "uninstall: user kept"
grep -q "^+ rm -f .*sudoers.d/axf-host" "$T/un.log" || fail "uninstall: sudoers kept"
ok "--uninstall stops every unit, removes sudoers, the account, keeps the data"
echo "✓ install-host-services dry run: $N checks"
