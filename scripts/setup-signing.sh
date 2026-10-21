#!/usr/bin/env bash
# One-time, macOS: a self-signed code-signing identity in the login keychain, so every local build
# of AgentDock carries the same signature and macOS keeps its Accessibility and microphone grants
# across rebuilds (an ad-hoc signature changes with every build, and the grants go with it).
#
#   bash scripts/setup-signing.sh
#   APPLE_SIGNING_IDENTITY="AgentDock Local Signing" npm run tauri build
set -euo pipefail

NAME="AgentDock Local Signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

if security find-certificate -c "$NAME" "$KEYCHAIN" >/dev/null 2>&1; then
  echo "\"$NAME\" is already in the login keychain"
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/openssl.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
EOF

# /usr/bin/openssl (LibreSSL) writes the legacy PKCS#12 encryption that `security import` reads.
/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -config "$TMP/openssl.cnf" -extensions ext \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" 2>/dev/null
PASS=$(uuidgen)
/usr/bin/openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" \
  -passout "pass:$PASS" -out "$TMP/identity.p12"
security import "$TMP/identity.p12" -k "$KEYCHAIN" -P "$PASS" -T /usr/bin/codesign >/dev/null
echo "created \"$NAME\" in the login keychain"
