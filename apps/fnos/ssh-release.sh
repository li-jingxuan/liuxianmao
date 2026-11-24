#!/bin/sh
set -eu

cd -- "$(dirname -- "$0")"
request=${SSH_ORIGINAL_COMMAND:-}
case "$request" in
    'deploy '*) exec sh ./build-release.sh "${request#deploy }" ;;
    rollback) exec sh ./deploy.sh rollback ;;
    *) echo 'Only deploy and rollback are authorized.' >&2; exit 2 ;;
esac
