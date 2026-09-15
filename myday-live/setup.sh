#!/usr/bin/env bash
# MYDAY — one command, on the droplet, as root.
#
#   bash setup.sh
#
# Installs Node and Caddy, sets up the service and HTTPS, and asks you
# to create your account. Safe to run again; updates in place.

set -euo pipefail

DOMAIN="${DOMAIN:-myday.acharyaandcollc.com}"
APP_DIR="${APP_DIR:-/opt/myday}"
DATA_DIR="${DATA_DIR:-/var/lib/myday}"
PORT="${APP_PORT:-8080}"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$1"; }
ok()   { printf '    \033[1;32m✓\033[0m %s\n' "$1"; }
die()  { printf '\n\033[1;31mStopped:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Run as root."
[ -f "$SRC/server.js" ] || die "Run this from the folder holding server.js."

export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------- swap
say "Memory cushion"
if ! swapon --show 2>/dev/null | grep -q /swapfile; then
  fallocate -l 1G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none
  chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q /swapfile /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "1GB swap added"
else
  ok "swap already on"
fi

# ---------------------------------------------------------------- node
say "Node"
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
  apt-get install -y -qq nodejs
fi
ok "Node $(node -v)"

# ---------------------------------------------------------------- caddy
say "Web server"
if ! command -v caddy >/dev/null; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' -o /tmp/caddy.key \
    || die "Couldn't download the Caddy key. Check the droplet's internet."
  [ -s /tmp/caddy.key ] || die "Caddy key came back empty, try again in a minute."
  gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg /tmp/caddy.key
  rm -f /tmp/caddy.key
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy
fi
ok "Caddy ready"

# ---------------------------------------------------------------- files
say "App files"
mkdir -p "$APP_DIR" "$DATA_DIR"
if [ "$SRC" != "$APP_DIR" ]; then
  mkdir -p "$APP_DIR/public"
  install -m 644 "$SRC/server.js" "$SRC/store.js" "$SRC/manage.js" "$APP_DIR/"
  cp -r "$SRC/public/." "$APP_DIR/public/"
  install -m 755 "$SRC/setup.sh" "$APP_DIR/setup.sh" 2>/dev/null || true
fi
chmod 700 "$DATA_DIR"
ok "installed to $APP_DIR"

# ---------------------------------------------------------------- service
say "Service"
cat > /etc/systemd/system/myday.service <<UNIT
[Unit]
Description=MYDAY
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/server.js
Environment=APP_PORT=$PORT
Environment=DATA_DIR=$DATA_DIR
Environment=NODE_OPTIONS=--max-old-space-size=280
Restart=always
RestartSec=3
User=root
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --quiet myday
systemctl restart myday
sleep 2
systemctl is-active --quiet myday || { journalctl -u myday -n 20 --no-pager; die "The service didn't start."; }
ok "running on 127.0.0.1:$PORT"

# ---------------------------------------------------------------- firewall
say "Firewall"
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow 80/tcp  >/dev/null 2>&1 || true
  ufw allow 443/tcp >/dev/null 2>&1 || true
  ufw --force enable >/dev/null 2>&1 || true
  ok "22, 80 and 443 open"
fi

# ---------------------------------------------------------------- https
say "HTTPS for $DOMAIN"
if ! grep -q "^$DOMAIN" /etc/caddy/Caddyfile 2>/dev/null; then
  [ -f /etc/caddy/Caddyfile ] && cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-myday
  cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
    reverse_proxy 127.0.0.1:$PORT
    encode gzip zstd
    header {
        Referrer-Policy "same-origin"
        X-Content-Type-Options "nosniff"
        Strict-Transport-Security "max-age=31536000"
    }
}
CADDY
fi
systemctl reload caddy 2>/dev/null || systemctl restart caddy
ok "Caddy pointed at the app"

# ---------------------------------------------------------------- account
say "Your account"
ACCOUNTS=0
[ -f "$DATA_DIR/users.json" ] && ACCOUNTS=$(node -e "try{console.log((JSON.parse(require('fs').readFileSync('$DATA_DIR/users.json','utf8')).users||[]).length)}catch(e){console.log(0)}")
if [ "$ACCOUNTS" = "0" ]; then
  echo "Let's create it now. Pick a username, then a password twice."
  read -r -p "Username: " NEWUSER </dev/tty
  if [ -n "$NEWUSER" ]; then
    ( cd "$APP_DIR" && DATA_DIR="$DATA_DIR" node manage.js add "$NEWUSER" </dev/tty )
  else
    echo "Skipped. Later:  cd $APP_DIR && DATA_DIR=$DATA_DIR node manage.js add yourname"
  fi
else
  ok "$ACCOUNTS account(s) already"
fi

say "Done"
cat <<DONE
Open  https://$DOMAIN

If it doesn't load yet, the DNS record is the missing piece. In Cloudflare:
  Type A   Name myday   Content $(curl -s -m 5 ifconfig.me 2>/dev/null || echo "this droplet's IP")   Proxy: DNS only
Once it loads over https, switch the record to Proxied and set SSL/TLS to Full (strict).

Add it to your iPad: open the site in Safari, Share, Add to Home Screen.

Handy:
  systemctl status myday
  journalctl -u myday -f
  cd $APP_DIR && DATA_DIR=$DATA_DIR node manage.js list
  free -h
DONE
