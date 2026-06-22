#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"; mkdir -p certs; cd certs
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca-key.pem -out ca.pem -days 3650 -subj "/CN=jm-test-ca" 2>/dev/null
for who in server client; do
  openssl req -newkey rsa:2048 -nodes -keyout "$who-key.pem" -out "$who.csr" -subj "/CN=localhost" 2>/dev/null
  openssl x509 -req -in "$who.csr" -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out "$who.pem" -days 3650 \
    -extfile <(printf "subjectAltName=DNS:localhost,IP:127.0.0.1") 2>/dev/null
done
echo "certs written to $(pwd)"
