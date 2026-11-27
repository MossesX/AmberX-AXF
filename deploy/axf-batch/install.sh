#!/usr/bin/env bash
# Install vps.build_land's merge resolver shim on the host: deploy/axf-batch/resolve.py -> /opt/axf-batch/resolve.py.
# The shim only hands over to framework/cli/land-resolve.py (generated-files@1); the previous host copy is kept as
# resolve.py.bak-<date>. Usage: bash deploy/axf-batch/install.sh [target-dir]
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
target="${1:-/opt/axf-batch}"
mkdir -p "$target"
if [ -f "$target/resolve.py" ] && ! cmp -s "$here/resolve.py" "$target/resolve.py"; then
  cp -p "$target/resolve.py" "$target/resolve.py.bak-$(date -u +%Y-%m-%d-%H%M)"
fi
install -m 0755 "$here/resolve.py" "$target/resolve.py"
echo "installed $target/resolve.py"
