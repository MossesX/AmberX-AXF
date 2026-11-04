#!/usr/bin/env bash
# merge-pr.sh <owner/repo> <number> — merge a pull request through the Dev Console's push banner (Brett, Oct 27 2026:
# "When something is ready for merge send approval message to merge"). Sessions run it through axHub `vps.run`, so
# every merge waits for Brett's approval on axHub; it never runs from cron or by itself.
#
# The push banner's POST /merge only merges an open, non-draft PR that isn't behind its base, GitHub can merge and whose CI on the head commit passed,
# with that commit pinned (never a direct push to main). The console token is read inside the console container from
# its env file, so no token is ever in a command, a log or an approval page.
set -euo pipefail
REPO="${1:?usage: merge-pr.sh <owner/repo> <number>}"
NUM="${2:?usage: merge-pr.sh <owner/repo> <number>}"
[[ "$REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "not a repo name: $REPO" >&2; exit 2; }
[[ "$NUM" =~ ^[0-9]{1,7}$ ]] || { echo "not a PR number: $NUM" >&2; exit 2; }
CONTAINER="${AXF_CONSOLE_CONTAINER:-axf-console}"
docker exec -i -e MERGE_REPO="$REPO" -e MERGE_NUM="$NUM" "$CONTAINER" python3 - <<'PY'
import json, os, re, sys, urllib.error, urllib.request
repo, num = os.environ["MERGE_REPO"], int(os.environ["MERGE_NUM"])
env = open("/axf/.axf-console/env", encoding="utf-8").read()
m = re.search(r"^AXF_TOKEN=(.+)$", env, re.M)
if not m:
    sys.exit("no console token in /axf/.axf-console/env")
port = os.environ.get("PORT", "7090")
req = urllib.request.Request(
    f"http://127.0.0.1:{port}/api/plugins/push-banner/merge",
    json.dumps({"repo": repo, "number": num, "confirm": f"{repo}#{num}"}).encode(),
    {"Authorization": "Bearer " + m.group(1).strip(), "Content-Type": "application/json"},
)
try:
    print(urllib.request.urlopen(req, timeout=60).read().decode())
except urllib.error.HTTPError as e:
    print(f"refused ({e.code}): {e.read().decode(errors='replace')[:600]}")
    sys.exit(1)
PY
