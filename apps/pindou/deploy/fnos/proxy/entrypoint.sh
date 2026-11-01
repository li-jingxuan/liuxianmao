#!/bin/sh
set -eu
# nginx parser errors can include the invalid token (including a credential).
# Validate privately and report only a generic configuration error.
if ! nginx -t >/dev/null 2>&1; then
    echo 'Pindou proxy configuration is missing or invalid; check private configuration and mounts.' >&2
    exit 1
fi
socket=/gateway/pindou.sock
if [ -L "$socket" ] || { [ -e "$socket" ] && [ ! -S "$socket" ]; }; then
    echo 'Refusing to replace a non-socket at the gateway socket path.' >&2
    exit 1
fi
if [ -S "$socket" ]; then rm -- "$socket"; fi
# Gateway runs outside this container; the socket must allow its connection.
umask 000
exec nginx -g 'daemon off;'
