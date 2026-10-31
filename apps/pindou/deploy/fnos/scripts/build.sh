#!/bin/sh
set -eu
fnos_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
project_dir=$(CDPATH= cd -- "$fnos_dir/../.." && pwd)
case "${1:-check}" in
    check)
        exec python3 "$fnos_dir/scripts/check.py"
        ;;
    images)
        : "${API_IMAGE:?Set API_IMAGE}" "${WEB_IMAGE:?Set WEB_IMAGE}" "${PROXY_IMAGE:?Set PROXY_IMAGE}"
        build_image() {
            if [ -n "${DOCKER_BUILDER:-}" ]; then
                docker buildx build --builder "$DOCKER_BUILDER" --load "$@"
            else
                docker build "$@"
            fi
        }
        # Defaults to x86 because this package initially targets x86 fnOS devices.
        build_image --platform "${DOCKER_PLATFORM:-linux/amd64}" \
            --build-arg "PYTHON_IMAGE=${PYTHON_IMAGE:-docker.m.daocloud.io/library/python:3.12-slim}" \
            --build-arg "PIP_INDEX_URL=${PIP_INDEX_URL:-https://pypi.org/simple}" \
            -f "$project_dir/deploy/api.Dockerfile" -t "$API_IMAGE" "$project_dir"
        build_image --platform "${DOCKER_PLATFORM:-linux/amd64}" \
            --build-arg "NODE_IMAGE=${NODE_IMAGE:-docker.m.daocloud.io/library/node:22-alpine}" \
            --build-arg "NPM_REGISTRY=${NPM_REGISTRY:-https://registry.npmmirror.com}" \
            --build-arg NEXT_PUBLIC_BASE_PATH=/app/pindou \
            --build-arg NEXT_PUBLIC_API_BASE_URL= \
            -f "$project_dir/deploy/web.Dockerfile" -t "$WEB_IMAGE" "$project_dir"
        build_image --platform "${DOCKER_PLATFORM:-linux/amd64}" \
            --build-arg "NGINX_IMAGE=${NGINX_IMAGE:-nginx:1.28-alpine}" \
            -f "$fnos_dir/proxy/Dockerfile" -t "$PROXY_IMAGE" "$fnos_dir/proxy"
        ;;
    stage|package)
        action=$1
        python3 "$fnos_dir/scripts/check.py"
        python3 "$fnos_dir/scripts/stage.py"
        if [ "$action" = package ]; then
            command -v fnpack >/dev/null 2>&1 || { echo 'fnpack is required; see README.' >&2; exit 1; }
            cd "$fnos_dir/dist/pindou"
            fnpack build
        fi
        ;;
    *) echo 'Usage: scripts/build.sh [check|images|stage|package]' >&2; exit 1 ;;
esac
