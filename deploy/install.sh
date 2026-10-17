#!/usr/bin/env bash
# One-time VPS setup for axf.amberxai.com (Debian/Ubuntu, run as root).
#
#   curl -fsSL https://raw.githubusercontent.com/MossesX/AmberX-AXF/main/deploy/install.sh | bash
#
# Serves the prebuilt `site` branch of MossesX/AmberX-AXF and pulls new builds
# every 2 minutes. No credentials are needed: the repo is public.
#
#  - If Coolify's Traefik proxy (coolify-proxy) owns ports 80/443, the site runs
#    as an nginx:alpine container on the `coolify` network with Traefik labels;
#    Traefik issues the HTTPS certificate. Nothing else is touched.
#  - Otherwise it installs host nginx + certbot.
# Safe to re-run.
set -euo pipefail

DOMAIN="${DOMAIN:-axf.amberxai.com}"
REPO="${REPO:-https://github.com/MossesX/AmberX-AXF.git}"
BRANCH="${BRANCH:-site}"
NAME="${NAME:-axf-amberxai}"
WEBROOT="/var/www/$DOMAIN"
EMAIL="${EMAIL:-}"

say() { echo -e "\033[1;33m[xaf]\033[0m $*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run this as root."; exit 1; }

apt_install() {
  local need=()
  for pkg in "$@"; do
    case "$pkg" in
      git) command -v git >/dev/null || need+=(git) ;;
      dig) command -v dig >/dev/null || need+=(dnsutils) ;;
      nginx) command -v nginx >/dev/null || need+=(nginx) ;;
      certbot) command -v certbot >/dev/null || need+=(certbot python3-certbot-nginx) ;;
    esac
  done
  if [ ${#need[@]} -gt 0 ]; then
    say "Installing ${need[*]}"
    apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${need[@]}"
  fi
}

check_dns() {
  SERVER_IP="$(curl -fsS -4 --max-time 10 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
  DNS_IP="$(dig +short A "$DOMAIN" | tail -n1)"
  if [ -n "$DNS_IP" ] && [ "$DNS_IP" = "$SERVER_IP" ]; then return 0; fi
  say "DNS for $DOMAIN points to '${DNS_IP:-nothing}' but this server is $SERVER_IP."
  say "Fix the A record for '${DOMAIN%%.*}'. HTTPS will start working once it points here."
  return 1
}

# ---- 0. Migrate from the old xaf.amberxai.com setup (renamed to axf) ----
if [ "$DOMAIN" = "axf.amberxai.com" ]; then
  if command -v docker >/dev/null && docker ps -a --format '{{.Names}}' | grep -qx xaf-amberxai; then say "Removing old xaf-amberxai container"; docker rm -f xaf-amberxai >/dev/null; fi
  rm -f /etc/cron.d/xaf-amberxai /etc/nginx/sites-enabled/xaf.amberxai.com /etc/nginx/sites-available/xaf.amberxai.com
  rm -rf /var/www/xaf.amberxai.com /etc/xaf-amberxai
fi

# ---- 1. Site files (shallow clone of the build branch) ----
apt_install git dig
if [ -d "$WEBROOT/.git" ]; then
  say "Updating $WEBROOT"
  git -C "$WEBROOT" fetch -q --depth 1 origin "$BRANCH"
  git -C "$WEBROOT" reset -q --hard "origin/$BRANCH"
else
  say "Downloading site into $WEBROOT"
  rm -rf "$WEBROOT"
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$WEBROOT"
fi

# ---- 2. Auto-update every 2 minutes (files are served live from $WEBROOT) ----
cat > /etc/cron.d/$NAME <<CRON
*/2 * * * * root git -C $WEBROOT fetch -q --depth 1 origin $BRANCH && git -C $WEBROOT reset -q --hard origin/$BRANCH
CRON
chmod 644 /etc/cron.d/$NAME

NGINX_SERVER_BODY='
    index index.html;
    location ~ /\.git { deny all; return 404; }
    location / { try_files $uri $uri/ /index.html; }
    location /assets/ { expires 1y; add_header Cache-Control "public, immutable"; try_files $uri =404; }
    location = /index.html { add_header Cache-Control "no-cache"; }
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
'

if command -v docker >/dev/null && docker ps --format '{{.Names}}' | grep -qx coolify-proxy; then
  # ---- 3a. Coolify / Traefik mode ----
  say "Coolify proxy detected — adding the site behind Traefik"
  NET="$(docker inspect coolify-proxy --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}' | tr ' ' '\n' | grep -x coolify || true)"
  NET="${NET:-$(docker inspect coolify-proxy --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | head -n1)}"
  CONF_DIR="/etc/$NAME"
  mkdir -p "$CONF_DIR"
  cat > "$CONF_DIR/default.conf" <<NGINX
server {
    listen 80;
    server_name _;
    root /usr/share/nginx/html;
$NGINX_SERVER_BODY
}
NGINX
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  R="axfsite"
  docker run -d --name "$NAME" --restart unless-stopped --network "$NET" \
    -v "$WEBROOT":/usr/share/nginx/html:ro \
    -v "$CONF_DIR/default.conf":/etc/nginx/conf.d/default.conf:ro \
    -l traefik.enable=true \
    -l "traefik.docker.network=$NET" \
    -l "traefik.http.routers.$R-http.rule=Host(\`$DOMAIN\`)" \
    -l "traefik.http.routers.$R-http.entrypoints=http" \
    -l "traefik.http.routers.$R-http.middlewares=$R-https" \
    -l "traefik.http.middlewares.$R-https.redirectscheme.scheme=https" \
    -l "traefik.http.routers.$R.rule=Host(\`$DOMAIN\`)" \
    -l "traefik.http.routers.$R.entrypoints=https" \
    -l "traefik.http.routers.$R.tls=true" \
    -l "traefik.http.routers.$R.tls.certresolver=letsencrypt" \
    -l "traefik.http.services.$R.loadbalancer.server.port=80" \
    nginx:alpine >/dev/null
  sleep 2
  docker ps --filter "name=^$NAME$" --format '{{.Names}} is {{.Status}}' | sed 's/^/[xaf] /'
  if check_dns; then
    say "Done. Live at https://$DOMAIN (the first certificate can take up to a minute)."
  else
    say "Container is running; the site will appear once DNS is fixed."
  fi
  exit 0
fi

# ---- 3b. Plain host nginx mode ----
if ss -ltnp 2>/dev/null | grep -E ':80\s' | grep -vq nginx; then
  say "Something other than nginx is already using port 80:"
  ss -ltnp | grep -E ':80\s' || true
  say "Stopping here so it isn't disturbed. Tell Claude what's running and it will adapt the setup."
  exit 1
fi
apt_install nginx certbot
SITE="/etc/nginx/sites-available/$DOMAIN"
cat > "$SITE" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    root $WEBROOT;
$NGINX_SERVER_BODY
}
NGINX
ln -sf "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
nginx -t -q
systemctl enable --now nginx >/dev/null 2>&1 || true
systemctl reload nginx
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  say "HTTPS certificate already installed"
elif check_dns; then
  say "Getting a free HTTPS certificate"
  if [ -n "$EMAIL" ]; then mail=(-m "$EMAIL"); else mail=(--register-unsafely-without-email); fi
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect "${mail[@]}" -q
fi
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then URL="https://$DOMAIN"; else URL="http://$DOMAIN"; fi
say "Done. Live at $URL (updates within 2 minutes of every push)."
