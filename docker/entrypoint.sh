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

# ---------------------------------------------------------------------------
# TLS helpers
# ---------------------------------------------------------------------------

# Strip carriage returns from a value.
# .env files created on Windows have CRLF line endings; Docker Compose passes
# the \r through into the container environment, silently breaking regex anchors
# and openssl SAN parsing.  Always clean values before using them.
strip_cr() {
    printf '%s' "${1:-}" | tr -d '\r'
}

# Returns 0 if $1 looks like an IPv4 address (digits and dots only, n.n.n.n).
# Uses shell case patterns — no grep, no external tools, immune to CRLF/locale.
is_ip() {
    local v
    v=$(strip_cr "$1")
    case "$v" in
        *[!0-9.]*              ) return 1 ;;   # non-digit/dot character present
        [0-9]*.[0-9]*.[0-9]*.[0-9]*) return 0 ;;   # matches n.n.n.n shape
        *                      ) return 1 ;;
    esac
}

# Appends a value to the SAN string, choosing IP: or DNS: based on its format.
add_san() {
    local VALUE
    VALUE=$(strip_cr "$1")
    [ -z "$VALUE" ] && return
    if is_ip "$VALUE"; then
        SAN="$SAN,IP:$VALUE"
    else
        SAN="$SAN,DNS:$VALUE"
    fi
}

# Returns 0 if the cert has an iPAddress SAN covering the given IP.
cert_covers_ip() {
    openssl x509 -in "$TLS_CERT" -noout -ext subjectAltName 2>/dev/null \
        | grep -q "IP Address:$1"
}

# ---------------------------------------------------------------------------
# Sanitise key env vars (strip Windows \r).
# Do this once here rather than scattering strip_cr calls everywhere.
# ---------------------------------------------------------------------------
LUDUS_SSH_HOST=$(strip_cr "$LUDUS_SSH_HOST")
LUDUS_SERVER_IP=$(strip_cr "$LUDUS_SERVER_IP")
TLS_HOSTNAME=$(strip_cr "$TLS_HOSTNAME")

# ---------------------------------------------------------------------------
# Determine the Docker host gateway IP.
# docker-compose.yml maps host.docker.internal → host-gateway, so this
# resolves to the host machine's LAN IP without any extra configuration.
# ---------------------------------------------------------------------------
HOST_GW_IP=$(getent hosts host.docker.internal 2>/dev/null | awk '{print $1}')

# ---------------------------------------------------------------------------
# Decide whether to (re-)generate the certificate.
#
# We regenerate if:
#   a) No cert/key files exist yet, OR
#   b) An existing cert is missing an iPAddress SAN for an IP we need —
#      e.g. it was previously generated with DNS:x.x.x.x instead of IP:x.x.x.x
#      (caused by CRLF-corrupted env vars breaking the old is_ip check).
# ---------------------------------------------------------------------------
NEEDS_REGEN=false

if [ ! -f "$TLS_CERT" ] || [ ! -f "$TLS_KEY" ]; then
    NEEDS_REGEN=true
else
    for CHECK_IP in "$LUDUS_SSH_HOST" "$LUDUS_SERVER_IP" "$HOST_GW_IP"; do
        if [ -n "$CHECK_IP" ] && is_ip "$CHECK_IP" && ! cert_covers_ip "$CHECK_IP"; then
            echo "[entrypoint] Cert missing iPAddress SAN for $CHECK_IP — regenerating"
            rm -f "$TLS_CERT" "$TLS_KEY"
            NEEDS_REGEN=true
            break
        fi
    done
fi

if [ "$NEEDS_REGEN" = "true" ]; then
    # Build Subject Alternative Names:
    #   DNS:localhost / IP:127.0.0.1  — always
    #   LUDUS_SSH_HOST                — IP: or DNS: auto-detected
    #   LUDUS_SERVER_IP               — always IP:
    #   TLS_HOSTNAME                  — IP: or DNS: auto-detected
    #   HOST_GW_IP                    — Docker host LAN IP, always IP:
    SAN="DNS:localhost,IP:127.0.0.1"
    add_san "$LUDUS_SSH_HOST"
    [ -n "$LUDUS_SERVER_IP" ] && SAN="$SAN,IP:$LUDUS_SERVER_IP"
    add_san "$TLS_HOSTNAME"
    [ -n "$HOST_GW_IP" ] && SAN="$SAN,IP:$HOST_GW_IP"

    CN="${TLS_HOSTNAME:-${LUDUS_SSH_HOST:-ludus-ui}}"

    echo "[entrypoint] Generating self-signed cert (CN=$CN, SAN=$SAN)"
    openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout "$TLS_KEY" \
        -out "$TLS_CERT" \
        -days 3650 \
        -subj "/CN=$CN" \
        -addext "subjectAltName=$SAN" \
        2>/dev/null

    chown nextjs:nodejs "$TLS_CERT" "$TLS_KEY"
    echo "[entrypoint] Certificate written to $TLS_CERT"
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
