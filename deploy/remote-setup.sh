#!/usr/bin/env bash
# Idempotent server setup for a static Frame app on a Debian/Ubuntu VPS.
# Run over SSH by .github/workflows/deploy.yml:  bash -s -- <domain> <webroot> [email]
set -euo pipefail

DOMAIN="$1"
WEBROOT="$2"
EMAIL="${3:-}"
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

say() { echo "[frame-deploy] $*"; }

# 1. Packages (nginx, certbot, rsync, dig)
need=()
command -v nginx   >/dev/null || need+=(nginx)
command -v certbot >/dev/null || need+=(certbot python3-certbot-nginx)
command -v rsync   >/dev/null || need+=(rsync)
command -v dig     >/dev/null || need+=(dnsutils)
if [ ${#need[@]} -gt 0 ]; then
  # Refuse to install nginx if another web server already owns port 80.
  if [[ " ${need[*]} " == *" nginx "* ]] && $SUDO ss -ltnp 2>/dev/null | grep -E ':80\s' | grep -vq nginx; then
    say "ERROR: something other than nginx is listening on port 80:"
    $SUDO ss -ltnp | grep -E ':80\s' || true
    say "Point that server at $WEBROOT for $DOMAIN instead, or stop it, then re-run."
    exit 1
  fi
  say "installing: ${need[*]}"
  $SUDO apt-get update -qq
  DEBIAN_FRONTEND=noninteractive $SUDO apt-get install -y -qq "${need[@]}"
fi

# 2. Web root
$SUDO mkdir -p "$WEBROOT"
$SUDO chown -R "$(id -un)":"$(id -gn)" "$WEBROOT"

# 3. nginx site (written once; certbot edits it afterwards for HTTPS)
SITE="/etc/nginx/sites-available/$DOMAIN"
if [ ! -f "$SITE" ]; then
  say "writing nginx site $SITE"
  $SUDO tee "$SITE" >/dev/null <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    root $WEBROOT;
    index index.html;

    # Single-page app: unknown paths fall back to index.html
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Hashed build assets can be cached forever
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files \$uri =404;
    }

    location = /index.html {
        add_header Cache-Control "no-cache";
    }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
}
NGINX
  $SUDO ln -sf "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
fi
$SUDO nginx -t
$SUDO systemctl enable --now nginx >/dev/null 2>&1 || true
$SUDO systemctl reload nginx

# 4. HTTPS — only once DNS for the domain points at this server
if $SUDO test -d "/etc/letsencrypt/live/$DOMAIN"; then
  say "certificate already present for $DOMAIN"
else
  SERVER_IP="$(curl -fsS -4 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
  DNS_IP="$(dig +short A "$DOMAIN" | tail -n1)"
  if [ -n "$DNS_IP" ] && [ "$DNS_IP" = "$SERVER_IP" ]; then
    say "issuing Let's Encrypt certificate for $DOMAIN"
    if [ -n "$EMAIL" ]; then mail=(-m "$EMAIL"); else mail=(--register-unsafely-without-email); fi
    $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect "${mail[@]}"
  else
    say "WARNING: $DOMAIN resolves to '${DNS_IP:-nothing}', this server is $SERVER_IP."
    say "Add an A record: xaf -> $SERVER_IP, then re-run the workflow to enable HTTPS."
  fi
fi
say "server ready"
