#!/usr/bin/env bash

set -euo pipefail

if ! command -v openssl >/dev/null 2>&1; then
  echo "错误：未找到 openssl，请先安装 OpenSSL。" >&2
  exit 1
fi

generate_secret() {
  openssl rand -hex 32
}

key_issuer_api_key="$(generate_secret)"
api_key_hash_pepper="$(generate_secret)"

while [[ "$key_issuer_api_key" == "$api_key_hash_pepper" ]]; do
  api_key_hash_pepper="$(generate_secret)"
done

printf 'KEY_ISSUER_API_KEY=%s\n' "$key_issuer_api_key"
printf 'API_KEY_HASH_PEPPER=%s\n' "$api_key_hash_pepper"
