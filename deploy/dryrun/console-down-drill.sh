#!/usr/bin/env bash
# Console-down drill (build data-container-axf-data-holds-all). Brett, Nov 15 2026: "the console goes down, all the
# data is still available, all the notes are available, and the builds keep running. That's what I need."
#
#   bash deploy/dryrun/console-down-drill.sh [--keep]
#
# A throwaway compose project (nothing of the live deploy is touched): axf-data (the real image), a console stand-in,
# an axHub route stand-in (deploy/dryrun/axhub-route.py: forwards /mcp with the hub's token, stores nothing) and an
# axf-molly client (node:22 with this checkout read-only). Steps:
#   1. up; seed a builds store and a note on axf-data
#   2. stop the console container
#   3. through the axHub route: axf-data answers, the note is readable, the builds list comes back
#   4. axf-molly writes the builds store with framework/cli/builds-store.mjs in cutover (lock = rev check)
#   5. through the axHub route again: the new build is there
# The result goes to deploy/dryrun/results/console-down-drill.json (and stdout). Exit 0 = every step passed.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
P="axfdrill$$"
WORK="$(mktemp -d)"
KEEP="${1:-}"
OUT="$DIR/deploy/dryrun/results/console-down-drill.json"
say() { printf '[drill] %s\n' "$*" >&2; }
cleanup() { [ "$KEEP" = "--keep" ] || { docker compose -p "$P" -f "$WORK/compose.yaml" down -v --remove-orphans >/dev/null 2>&1 || true; rm -rf "$WORK"; }; }
trap cleanup EXIT

bash "$DIR/deploy/install-data.sh" --context "$WORK/axf-data" >/dev/null
rm -rf "$WORK/axf-data/__pycache__"
TOK="drill-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
SUM="$(printf '%s' "$TOK" | sha256sum | cut -d' ' -f1)"
printf '{"tokens":[{"id":"drill","sub":"svc:axhub","sha256":"%s","grants":{"*":["admin"]}}]}\n' "$SUM" > "$WORK/tokens.json"
chmod 644 "$WORK/tokens.json"
mkdir -p "$WORK/molly/.axf-console/data-store" "$WORK/molly/_claude/builds"
printf '{"$axf":"data-store-mode@1","mode":"local","namespaces":{"builds":{"mode":"cutover"}}}\n' > "$WORK/molly/.axf-console/data-store/mode.json"
chmod -R a+rwX "$WORK/molly"

cat > "$WORK/compose.yaml" <<YAML
services:
  axf-data:
    build: ./axf-data
    environment: { AXF_DATA_TOKENS_FILE: /run/tokens.json }
    volumes: [ "data:/data", "./tokens.json:/run/tokens.json:ro" ]
    networks: [ axf-data ]
  console:
    image: python:3.12-slim
    command: [ "python", "-m", "http.server", "7090" ]
    networks: [ axf-data ]
  axhub-route:
    image: python:3.12-slim
    command: [ "python", "/route.py" ]
    environment: { AXF_DATA_URL: "http://axf-data:7700", AXF_DATA_TOKEN: "$TOK" }
    volumes: [ "$DIR/deploy/dryrun/axhub-route.py:/route.py:ro" ]
    networks: [ axf-data ]
volumes: { data: {} }
networks: { axf-data: { internal: true } }
YAML

molly() {
  docker run --rm --network "${P}_axf-data" -v "$DIR":/axf:ro -v "$WORK/molly":/work -w /work \
    -e AXF_ROOT=/work -e AXF_STATE=/work/.axf-console/state.json -e AXF_BUILDS_STORE=/work/_claude/builds/store.json \
    -e AXF_DATA_URL=http://axf-data:7700 -e AXF_DATA_TOKEN="$TOK" -e AXF_BUILDS_LIVE=0 -e AXF_BUILD_HOOKS=off -e AXF_BUILD_PROFILE=all \
    -e HUB_URL=http://axhub-route:8080/mcp node:22 node /axf/deploy/dryrun/console-down-molly.mjs "$@"
}

say "up (build + start)"
docker compose -p "$P" -f "$WORK/compose.yaml" up -d --build --quiet-pull >/dev/null 2>&1
for _ in $(seq 1 40); do
  docker compose -p "$P" -f "$WORK/compose.yaml" exec -T axf-data python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:7700/v1/health', timeout=2)" >/dev/null 2>&1 && break
  sleep 1
done
STEPS=()
STEPS+=("$(molly seed)")
say "stopping the console"
docker compose -p "$P" -f "$WORK/compose.yaml" stop console >/dev/null 2>&1
CONSOLE_STATE="$(docker compose -p "$P" -f "$WORK/compose.yaml" ps -a --format '{{.Service}} {{.State}}' | awk '$1=="console"{print $2}')"
STEPS+=("{\"step\":\"console stopped\",\"ok\":$([ "$CONSOLE_STATE" = exited ] && echo true || echo false),\"state\":\"$CONSOLE_STATE\"}")
STEPS+=("$(molly read-through-hub)")
STEPS+=("$(molly write)")
STEPS+=("$(molly read-through-hub)")

mkdir -p "$(dirname "$OUT")"
python3 - "$OUT" "${STEPS[@]}" <<'PY'
import json, sys, datetime
out, steps = sys.argv[1], [json.loads(s) for s in sys.argv[2:]]
final = steps[-1]
ok = all(s.get("ok") for s in steps) and final.get("mollyWriteLanded") is True
doc = {"$axf": "console-down-drill@1", "at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"), "ok": ok, "steps": steps,
       "said": "the console goes down, all the data is still available, all the notes are available, and the builds keep running."}
open(out, "w").write(json.dumps(doc, indent=1) + "\n")
print(json.dumps(doc, indent=1))
sys.exit(0 if ok else 1)
PY
