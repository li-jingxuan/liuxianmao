#!/bin/sh
set -eu

action=${1:-}
commit=${2:-}
if [ "${#commit}" -ne 40 ] || ! printf '%s\n' "$commit" | grep -Eq '^[0-9a-f]{40}$'; then
    echo 'Expected a full Git commit SHA.' >&2
    exit 2
fi

release_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
umask 077

image_for_commit() {
    image=$(docker image inspect --format '{{.Id}}' "$1") || return 1
    revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image") || return 1
    [ "$revision" = "$commit" ] || { echo "Unexpected revision for $1" >&2; return 1; }
    printf '%s\n' "$image"
}

app_tag="liuxianmao-local:sha-$commit"
gateway_tag="liuxianmao-gateway-local:sha-$commit"
case "$action" in
    deploy-all)
        # 和构建共用锁，读取两张镜像的不可变 ID。切换前再次确认提交仍是 GitHub main。
        exec 8>"$release_dir/.build.lock"
        flock -x 8
        python3 "$release_dir/extract-main.py" check-main "$commit"
        app_image=$(image_for_commit "$app_tag")
        gateway_image=$(image_for_commit "$gateway_tag")
        exec sh "$release_dir/deploy.sh" deploy "$app_image" "$gateway_image" "$commit"
        ;;
    build-liuxianmao) tag=$app_tag ;;
    build-gateway) tag=$gateway_tag ;;
    *) echo 'Unknown release action.' >&2; exit 2 ;;
esac

source_dir=$(mktemp -d)
trap 'rm -rf -- "$source_dir"' EXIT
trap 'exit 1' HUP INT TERM
python3 "$release_dir/extract-main.py" "$action" "$commit" "$source_dir"

# NAS 上串行构建，避免应用镜像和其他发布同时争抢宿主机资源。
exec 8>"$release_dir/.build.lock"
flock -x 8
if ! docker image inspect "$tag" >/dev/null 2>&1; then
    case "$action" in
        build-liuxianmao)
            set -- --build-arg NPM_CONFIG_REGISTRY=https://registry.npmmirror.com "$source_dir"
            ;;
        build-gateway)
            set -- --file "$source_dir/deploy/fnos/gateway.Dockerfile" "$source_dir/deploy/fnos"
            ;;
    esac
    docker build --tag "$tag" --label "org.opencontainers.image.revision=$commit" \
        --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim "$@"
fi
image=$(image_for_commit "$tag")
printf 'Ready %s %s\n' "$tag" "$image"
