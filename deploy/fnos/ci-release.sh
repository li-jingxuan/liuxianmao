#!/bin/sh
set -eu

case "${RELEASE_ACTION:-deploy}" in
    deploy|check|rollback) ;;
    *) echo 'RELEASE_ACTION must be check, deploy or rollback.' >&2; exit 2 ;;
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

# 构建任务只传各自所需的 Git 文件。全量发布任务只在两张同一提交的镜像都准备好后请求切换。
case "${1:-}:${RELEASE_ACTION:-deploy}" in
    build-gateway:deploy)
        git -c safe.directory="$PWD" archive --format=tar.gz --output="$tmp/source.tar.gz" "$commit" \
            deploy/fnos/gateway.Dockerfile deploy/fnos/proxy.cjs deploy/fnos/verify.cjs
        nas "build-gateway $commit" < "$tmp/source.tar.gz"
        ;;
    build-liuxianmao:deploy)
        git -c safe.directory="$PWD" archive --format=tar.gz --output="$tmp/source.tar.gz" "$commit" \
            Dockerfile .dockerignore .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml apps/website packages \
            docs/design-v2/records/20261111_chord-catalog-data-audit-v2.json
        nas "build-liuxianmao $commit" < "$tmp/source.tar.gz"
        ;;
    deploy-all:deploy) nas "deploy-all $commit" ;;
    deploy-all:rollback) nas rollback ;;
    *) echo 'Unsupported release command for this workflow.' >&2; exit 2 ;;
esac
