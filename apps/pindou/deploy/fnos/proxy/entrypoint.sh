#!/bin/sh
set -eu
socket=/gateway/pindou.sock
if [ -L "$socket" ] || { [ -e "$socket" ] && [ ! -S "$socket" ]; }; then
    echo 'Refusing to replace a non-socket at the gateway socket path.' >&2
    exit 1
fi
if [ -S "$socket" ]; then rm -- "$socket"; fi
# Gateway runs outside this container; the socket must allow its connection.
umask 000
exec nginx -g 'daemon off;'
