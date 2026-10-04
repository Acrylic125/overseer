#!/bin/sh
set -eu

# One certificate per instance; the scan container trusts it through NODE_EXTRA_CA_CERTS.
if [ ! -f "$CERT_DIR/cert.pem" ]; then
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 \
    -subj "/CN=mock-providers" \
    -addext "subjectAltName=DNS:mock-providers" \
    -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" 2>/dev/null
fi

exec node server.mjs
