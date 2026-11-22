#!/bin/sh
set -eu

case "${RELEASE_ACTION:-}" in
    deploy|rollback) ;;
    *) echo 'Expected RELEASE_ACTION=deploy or rollback.' >&2; exit 2 ;;
esac
commit=${CI_COMMIT_SHA:-}
printf '%s\n' "$commit" | grep -Eq '^[0-9a-f]{40}$'

command -v ssh >/dev/null || {
    apt-get update && apt-get install -y --no-install-recommends openssh-client
}
umask 077
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
trap 'exit 1' HUP INT TERM
printf '%s\n' "$LXM_NAS_SSH_KEY" > "$tmp/key"
printf '%s\n' "$LXM_NAS_KNOWN_HOSTS" > "$tmp/known_hosts"
unset LXM_NAS_SSH_KEY LXM_NAS_KNOWN_HOSTS

nas() {
    ssh -i "$tmp/key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \
        -o UserKnownHostsFile="$tmp/known_hosts" -o ConnectTimeout=10 nice007@192.168.2.13 "$@"
}

if [ "$RELEASE_ACTION" = rollback ]; then
    nas rollback
else
    tar --exclude=node_modules --exclude=.next --exclude=.turbo --exclude=dist -czf "$tmp/source.tar.gz" \
        Dockerfile .dockerignore .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml apps/website packages \
        docs/design-v2/records/20261111_chord-catalog-data-audit-v2.json
    nas "deploy $commit" < "$tmp/source.tar.gz"
fi
