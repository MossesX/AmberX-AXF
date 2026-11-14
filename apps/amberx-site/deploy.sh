#!/usr/bin/env bash
# Build and (re)start the AmberX site on the VPS behind the Coolify proxy (Traefik + Let's Encrypt), the same way
# the other *.amberxai.com sites run. Data persists in the amberx-site-data volume.
#
#   apps/amberx-site/deploy.sh [host …]        default host: join.amberxai.com
#
# Secrets: /opt/amberx-site/.env (root only) holds SITE_ADMIN_TOKEN; created with a random token on first run.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HOSTS=("${@:-join.amberxai.com}")
NAME=amberx-site
ENV_FILE=/opt/amberx-site/.env

mkdir -p "$(dirname "$ENV_FILE")"
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  printf 'SITE_ADMIN_TOKEN=%s\n' "$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')" > "$ENV_FILE"
  echo "created $ENV_FILE (admin token inside, root only)"
fi

# slim build context with the repository's paths
CTX="$(mktemp -d)"; trap 'rm -rf "$CTX"' EXIT
mkdir -p "$CTX/framework/ui" "$CTX/framework/core/engines" "$CTX/framework/assets" "$CTX/apps"
cp "$ROOT/framework/ui/axf.css" "$CTX/framework/ui/"
cp "$ROOT/framework/core/engines/scale-rules.mjs" "$CTX/framework/core/engines/"
for t in color-theme style-theme typography density sizing; do cp -r "$ROOT/framework/assets/$t" "$CTX/framework/assets/"; done
rsync -a --exclude data --exclude baked "$ROOT/apps/amberx-site" "$CTX/apps/"
docker build -q -t "$NAME:latest" -f "$CTX/apps/amberx-site/Dockerfile" "$CTX" >/dev/null

rule=""; for h in "${HOSTS[@]}"; do rule="${rule:+$rule || }Host(\`$h\`)"; done
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped --network coolify \
  --env-file "$ENV_FILE" -e PUBLIC_URL="https://${HOSTS[0]}" \
  -v amberx-site-data:/data \
  -l traefik.enable=true -l traefik.docker.network=coolify \
  -l "traefik.http.routers.amberxsite-http.rule=$rule" -l traefik.http.routers.amberxsite-http.entrypoints=http \
  -l traefik.http.routers.amberxsite-http.middlewares=amberxsite-https \
  -l traefik.http.middlewares.amberxsite-https.redirectscheme.scheme=https \
  -l "traefik.http.routers.amberxsite.rule=$rule" -l traefik.http.routers.amberxsite.entrypoints=https \
  -l traefik.http.routers.amberxsite.tls=true -l traefik.http.routers.amberxsite.tls.certresolver=letsencrypt \
  -l traefik.http.services.amberxsite.loadbalancer.server.port=8080 \
  "$NAME:latest" >/dev/null
echo "running $NAME for ${HOSTS[*]}"
