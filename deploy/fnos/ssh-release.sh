#!/bin/sh
set -eu

cd -- "$(dirname -- "$0")"
request=${SSH_ORIGINAL_COMMAND:-}
# 专用密钥仅能请求固定构建目标、全量切换或回滚，提交参数由构建脚本校验。
case "$request" in
    'build-gateway '*|'build-liuxianmao '*|'deploy-all '*)
        exec sh ./build-release.sh "${request%% *}" "${request#* }" ;;
    rollback) exec sh ./deploy.sh rollback ;;
    *) echo 'Only build-gateway, build-liuxianmao, deploy-all and rollback are authorized.' >&2; exit 2 ;;
esac
