#!/bin/sh
set -e

CERT="${CERT_PATH:-/etc/nginx/certs/cert.pem}"
KEY="${KEY_PATH:-/etc/nginx/certs/key.pem}"

strip_cr() {
    printf '%s' "${1:-}" | tr -d '\r'
}

TLS_HOSTNAME=$(strip_cr "${TLS_HOSTNAME:-}")
LUDUS_SSH_HOST=$(strip_cr "${LUDUS_SSH_HOST:-}")
LUDUS_SERVER_IP=$(strip_cr "${LUDUS_SERVER_IP:-}")

is_ip() {
    _v=$(strip_cr "$1")
    case "$_v" in
        *[!0-9.]*) return 1 ;;
        [0-9]*.[0-9]*.[0-9]*.[0-9]*) return 0 ;;
        *) return 1 ;;
    esac
}

add_san_piece() {
    _val=$(strip_cr "$1")
    [ -z "$_val" ] && return
    if is_ip "$_val"; then
        SAN="${SAN},IP:${_val}"
    else
        SAN="${SAN},DNS:${_val}"
    fi
}

mkdir -p "$(dirname "$CERT")"

if [ ! -f "$CERT" ] || [ ! -f "$KEY" ]; then
    echo "[nginx-entrypoint] Generating self-signed TLS certificate for edge proxy..."
    SAN="DNS:localhost,IP:127.0.0.1"
    add_san_piece "$LUDUS_SSH_HOST"
    add_san_piece "$TLS_HOSTNAME"
    add_san_piece "$LUDUS_SERVER_IP"

    _gw=$(getent hosts host.docker.internal 2>/dev/null | awk '{print $1}')
    [ -n "$_gw" ] && SAN="${SAN},IP:${_gw}"

    CN="${TLS_HOSTNAME:-${LUDUS_SSH_HOST:-lux}}"

    openssl req -x509 -newkey rsa:2048 -nodes \
        -keyout "$KEY" \
        -out "$CERT" \
        -days 3650 \
        -subj "/CN=$CN" \
        -addext "subjectAltName=$SAN" \
        2>/dev/null

    chmod 644 "$CERT"
    chmod 600 "$KEY"
    echo "[nginx-entrypoint] Wrote $CERT"
else
    echo "[nginx-entrypoint] Using existing TLS files at $CERT"
fi

exec nginx -g "daemon off;"
