#!/bin/sh
set -eu

case "${RELEASE_ACTION:-}" in
    deploy|rollback) ;;
    *) echo 'Expected RELEASE_ACTION=deploy or rollback.' >&2; exit 2 ;;
esac
commit=${CI_COMMIT_SHA:-}
printf '%s\n' "$commit" | grep -Eq '^[0-9a-f]{40}$'

umask 077
tmp=$(mktemp -d)
trap 'rm -rf -- "$tmp"' EXIT
trap 'exit 1' HUP INT TERM
printf '%s\n' "$LXM_NAS_SSH_KEY" > "$tmp/key"
printf '%s\n' "$LXM_NAS_KNOWN_HOSTS" > "$tmp/known_hosts"
unset LXM_NAS_SSH_KEY LXM_NAS_KNOWN_HOSTS

nas() {
    ssh -i "$tmp/key" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes \
        -o UserKnownHostsFile="$tmp/known_hosts" -o HostKeyAlias=192.168.2.13 \
        -o ConnectTimeout=10 "nice007@${LXM_NAS_SSH_HOST:-192.168.2.13}" "$@"
}

if [ "$RELEASE_ACTION" = rollback ]; then
    nas rollback
else
    git archive --format=tar.gz --output="$tmp/source.tar.gz" "$commit" \
        Dockerfile .dockerignore .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml apps/website packages \
        docs/design-v2/records/20261111_chord-catalog-data-audit-v2.json
    nas "deploy $commit" < "$tmp/source.tar.gz"
fi
