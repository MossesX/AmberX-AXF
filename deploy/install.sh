#!/usr/bin/env bash
# One-time VPS setup for xaf.amberxai.com (Debian/Ubuntu, run as root).
#
#   curl -fsSL https://raw.githubusercontent.com/MossesX/AmberX-AXF/main/deploy/install.sh | bash
#
# Serves the prebuilt `site` branch of MossesX/AmberX-AXF with nginx, turns on
# HTTPS once DNS points here, and pulls new builds every 2 minutes. No
# credentials are needed: the repo is public and the server only reads it.
# Safe to re-run.
set -euo pipefail

DOMAIN="${DOMAIN:-xaf.amberxai.com}"
REPO="${REPO:-https://github.com/MossesX/AmberX-AXF.git}"
BRANCH="${BRANCH:-site}"
WEBROOT="/var/www/$DOMAIN"
EMAIL="${EMAIL:-}"

say() { echo -e "\033[1;33m[xaf]\033[0m $*"; }
[ "$(id -u)" -eq 0 ] || { echo "Run this as root."; exit 1; }

# 1. Packages
need=()
command -v nginx   >/dev/null || need+=(nginx)
command -v certbot >/dev/null || need+=(certbot python3-certbot-nginx)
command -v git     >/dev/null || need+=(git)
command -v dig     >/dev/null || need+=(dnsutils)
if [ ${#need[@]} -gt 0 ]; then
  if [[ " ${need[*]} " == *" nginx "* ]] && ss -ltnp 2>/dev/null | grep -E ':80\s' | grep -vq nginx; then
    say "Something other than nginx is already using port 80:"
    ss -ltnp | grep -E ':80\s' || true
    say "Stopping here so it isn't disturbed. Tell Claude what's running and it will adapt the setup."
    exit 1
  fi
  say "Installing ${need[*]}"
  apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${need[@]}"
fi

# 2. Site files (a shallow clone of the build branch)
if [ -d "$WEBROOT/.git" ]; then
  say "Updating $WEBROOT"
  git -C "$WEBROOT" fetch -q --depth 1 origin "$BRANCH"
  git -C "$WEBROOT" reset -q --hard "origin/$BRANCH"
else
  say "Downloading site into $WEBROOT"
  rm -rf "$WEBROOT"
  git clone -q --depth 1 --branch "$BRANCH" "$REPO" "$WEBROOT"
fi

# 3. nginx
SITE="/etc/nginx/sites-available/$DOMAIN"
if [ ! -f "$SITE" ]; then
  say "Writing nginx config"
  cat > "$SITE" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    root $WEBROOT;
    index index.html;

    location ~ /\.git { deny all; return 404; }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

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
  ln -sf "$SITE" "/etc/nginx/sites-enabled/$DOMAIN"
fi
nginx -t -q
systemctl enable --now nginx >/dev/null 2>&1 || true
systemctl reload nginx

# 4. Auto-update every 2 minutes
cat > /etc/cron.d/xaf-amberxai <<CRON
*/2 * * * * root git -C $WEBROOT fetch -q --depth 1 origin $BRANCH && git -C $WEBROOT reset -q --hard origin/$BRANCH
CRON
chmod 644 /etc/cron.d/xaf-amberxai

# 5. HTTPS
SERVER_IP="$(curl -fsS -4 --max-time 10 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
DNS_IP="$(dig +short A "$DOMAIN" | tail -n1)"
if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  say "HTTPS certificate already installed"
elif [ -n "$DNS_IP" ] && [ "$DNS_IP" = "$SERVER_IP" ]; then
  say "Getting a free HTTPS certificate"
  if [ -n "$EMAIL" ]; then mail=(-m "$EMAIL"); else mail=(--register-unsafely-without-email); fi
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --redirect "${mail[@]}" -q
else
  say "DNS for $DOMAIN points to '${DNS_IP:-nothing}' but this server is $SERVER_IP."
  say "Fix the A record for 'xaf', wait a few minutes, then run this command again for HTTPS."
fi

if [ -d "/etc/letsencrypt/live/$DOMAIN" ]; then URL="https://$DOMAIN"; else URL="http://$DOMAIN"; fi
say "Done. Live at $URL (updates within 2 minutes of every push)."
