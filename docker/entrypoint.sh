#!/bin/sh
set -e

# ---------------------------------------------------------------------------
# Hostname resolution helper
#
# When LUDUS_SSH_HOST is set to a DNS name that Docker
# cannot resolve — because the name is only in the host's /etc/hosts file,
# behind a VPN DNS, or in a Windows hosts file — all SSH and HTTP connections
# inside the container will fail with ENOTFOUND.
#
# Fix: set LUDUS_SERVER_IP=<ip> in your .env.  This entrypoint will inject
# the mapping into the container's /etc/hosts so every hostname lookup
# (SSH, fetch, TLS) resolves correctly, without any other configuration.
# ---------------------------------------------------------------------------

inject_host() {
    local HOST="$1"
    local IP="$2"
    if [ -n "$HOST" ] && [ -n "$IP" ]; then
        # Only add if not already resolvable
        if ! getent hosts "$HOST" > /dev/null 2>&1; then
            echo "$IP  $HOST" >> /etc/hosts
            echo "[entrypoint] Added hosts entry: $HOST -> $IP"
        fi
    fi
}

if [ -n "$LUDUS_SERVER_IP" ]; then
    # Always inject LUDUS_SSH_HOST
    inject_host "$LUDUS_SSH_HOST" "$LUDUS_SERVER_IP"
    inject_host "$GOAD_SSH_HOST"  "$LUDUS_SERVER_IP"

    # Also inject the hostname from LUDUS_URL and LUDUS_ADMIN_URL in case they
    # differ from LUDUS_SSH_HOST (e.g. using a different domain alias).
    for URL in "$LUDUS_URL" "$LUDUS_ADMIN_URL"; do
        if [ -n "$URL" ]; then
            # Strip scheme (https?://) then grab everything up to : or /
            URL_HOST=$(echo "$URL" | sed 's|https\?://||' | cut -d: -f1 | cut -d/ -f1)
            inject_host "$URL_HOST" "$LUDUS_SERVER_IP"
        fi
    done
fi

# ---------------------------------------------------------------------------
# TLS certificate auto-generation
#
# If the user hasn't placed their own cert+key at the configured paths
# (defaults: /app/certificates/cert.pem and /app/certificates/key.pem),
# generate a self-signed certificate so the app always serves HTTPS.
# The certificates/ directory is volume-mounted, so generated certs persist
# across container restarts.
# ---------------------------------------------------------------------------

TLS_CERT="${TLS_CERT_PATH:-/app/certificates/cert.pem}"
TLS_KEY="${TLS_KEY_PATH:-/app/certificates/key.pem}"

mkdir -p "$(dirname "$TLS_CERT")" "$(dirname "$TLS_KEY")"

if [ ! -f "$TLS_CERT" ] || [ ! -f "$TLS_KEY" ]; then
    # Build a Subject Alternative Name from available hostnames
    SAN="DNS:localhost,IP:127.0.0.1"
    [ -n "$LUDUS_SSH_HOST" ] && SAN="$SAN,DNS:$LUDUS_SSH_HOST"
    [ -n "$LUDUS_SERVER_IP" ] && SAN="$SAN,IP:$LUDUS_SERVER_IP"
    [ -n "$TLS_HOSTNAME" ] && SAN="$SAN,DNS:$TLS_HOSTNAME"

    CN="${TLS_HOSTNAME:-${LUDUS_SSH_HOST:-ludus-ui}}"

    echo "[entrypoint] No TLS certificate found — generating self-signed cert (CN=$CN)"
    openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout "$TLS_KEY" \
        -out "$TLS_CERT" \
        -days 3650 \
        -subj "/CN=$CN" \
        -addext "subjectAltName=$SAN" \
        2>/dev/null

    chown nextjs:nodejs "$TLS_CERT" "$TLS_KEY"
    echo "[entrypoint] Self-signed certificate generated at $TLS_CERT"
else
    echo "[entrypoint] Using existing TLS certificate: $TLS_CERT"
fi

# ---------------------------------------------------------------------------
# Ensure the volume-mounted data directory is writable by the nextjs user.
# On a fresh host, Docker creates the mount point owned by root.
# ---------------------------------------------------------------------------
chown -R nextjs:nodejs /app/data 2>/dev/null || true
mkdir -p /app/data/tasks && chown nextjs:nodejs /app/data/tasks

# ---------------------------------------------------------------------------
# Drop privileges: run the app as the nextjs user (uid 1001).
# The entrypoint itself runs as root (so it can write /etc/hosts above).
# ---------------------------------------------------------------------------
exec su -s /bin/sh nextjs -c 'exec node ws-server.js'
