#!/bin/sh
set -eu

commit=${1:-}
if [ "${#commit}" -ne 40 ] || ! printf '%s\n' "$commit" | grep -Eq '^[0-9a-f]{40}$'; then
    echo 'Expected a full Git commit SHA.' >&2
    exit 2
fi

release_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
umask 077
source_dir=$(mktemp -d)
trap 'rm -rf -- "$source_dir"' EXIT
trap 'exit 1' HUP INT TERM
tar -xzf - -C "$source_dir"

exec 8>"$release_dir/.build.lock"
flock -x 8
tag="liuxianmao-local:sha-$commit"
if ! image=$(docker image inspect --format '{{.Id}}' "$tag" 2>/dev/null); then
    docker build --tag "$tag" --label "org.opencontainers.image.revision=$commit" \
        --build-arg NODE_IMAGE=docker.m.daocloud.io/library/node:22-bookworm-slim \
        --build-arg NPM_CONFIG_REGISTRY=https://registry.npmmirror.com "$source_dir"
    image=$(docker image inspect --format '{{.Id}}' "$tag")
fi
revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
test "$revision" = "$commit"
sh "$release_dir/deploy.sh" deploy "$image" "$commit"
