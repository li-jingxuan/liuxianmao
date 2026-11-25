#!/bin/sh
set -eu
umask 077
export LC_ALL=C

fail() {
    printf '%s\n' "$*" >&2
    exit 1
}

valid_image() {
    case "$1" in *[!a-z0-9./:_@-]*) return 1 ;; esac
    printf '%s\n' "$1" | grep -Eq '^([a-z0-9][a-z0-9./:_-]*@)?sha256:[0-9a-f]{64}$'
}

valid_commit() {
    case "$1" in *[!0-9a-f]*) return 1 ;; esac
    [ "${#1}" -eq 40 ]
}

valid_release() {
    valid_commit "${1%% *}" && valid_image "${1#* }"
}

mode=${1:-}
case "$mode:$#" in
    deploy:3)
        valid_image "$2" || fail 'Expected an image digest or a local Docker image ID.'
        valid_commit "$3" || fail 'Expected a full Git commit SHA.'
        candidate="$3 $2"
        ;;
    rollback:1) ;;
    *) fail 'Usage: sh deploy.sh deploy IMAGE@sha256:DIGEST COMMIT | sh deploy.sh rollback' ;;
esac

cd -- "$(dirname -- "$0")"
exec 9>.deploy.lock
flock -x 9

LXM_APPDEST=$(cat appdest 2>/dev/null) || fail 'Store the installed FPK target directory in the appdest file.'
case "$LXM_APPDEST" in
    /*) [ -f "$LXM_APPDEST/ui/config" ] || fail "FPK target directory is missing its ui/config: $LXM_APPDEST" ;;
    *) fail 'appdest must contain the absolute path of the installed FPK target directory.' ;;
esac
export LXM_APPDEST

compose() {
    compose_image=$1
    shift
    LXM_IMAGE="$compose_image" docker compose --env-file /dev/null --project-name liuxianmao-fnos --file compose.yaml "$@"
}

apply() {
    image=${1#* }
    compose "$image" up --detach --force-recreate --pull never --wait --wait-timeout 90 &&
        compose "$image" exec -T gateway node /deployment/verify.cjs &&
        status=$(curl --noproxy '*' --unix-socket "$LXM_APPDEST/app.sock" --silent --show-error \
            --max-time 5 --output /dev/null --write-out '%{http_code}' http://localhost/app/liuxianmao) &&
        [ "$status" = 200 ]
}

report_logs() {
    compose "${1#* }" ps --all >&2 || true
    compose "${1#* }" logs --no-color --tail 60 >&2 || true
}

ensure_image() {
    case "$1" in
        sha256:*) docker image inspect "$1" >/dev/null ;;
        *) docker image inspect "$1" >/dev/null 2>&1 || docker pull "$1" ;;
    esac
}

current=''
previous=''
if [ -f releases ]; then
    current=$(sed -n '1p' releases)
    previous=$(sed -n '2p' releases)
    valid_release "$current" || fail 'Current release record is invalid.'
    [ -z "$previous" ] || valid_release "$previous" || fail 'Previous release record is invalid.'
fi

restore() {
    failed_release=$1
    if [ -z "$current" ]; then
        compose "${failed_release#* }" stop || return 1
        printf '%s\n' 'No previous healthy release. Stopped the failed release and kept container logs.' >&2
    else
        ensure_image "${current#* }" || return 1
        if ! apply "$current"; then
            report_logs "$current"
            return 1
        fi
        printf 'Restored %s\n' "$current"
    fi
    rm -f pending
}

if [ -f pending ]; then
    interrupted=$(cat pending)
    valid_release "$interrupted" || fail 'Pending release record is invalid.'
    printf 'Recovering interrupted release %s\n' "$interrupted" >&2
    restore "$interrupted" || fail 'Failed to recover the last healthy release.'
fi

if [ "$mode" = rollback ]; then
    [ -n "$previous" ] || fail 'No previous healthy release is recorded.'
    candidate=$previous
fi

# Pull before marking the switch in progress. Existing containers keep serving
# if the registry rejects or cannot deliver the candidate digest.
printf 'Deploying %s\n' "$candidate"
ensure_image "${candidate#* }"

new_previous=$previous
if [ "$candidate" != "$current" ]; then
    new_previous=$current
fi
printf '%s\n%s\n' "$candidate" "$new_previous" > releases.next
printf '%s\n' "$candidate" > pending.next
mv -f pending.next pending

if apply "$candidate" && mv -f releases.next releases; then
    rm -f pending
    printf 'Verified %s\n' "$candidate"
    exit 0
fi

report_logs "$candidate"
rm -f releases.next
if restore "$candidate"; then
    fail 'Deployment failed. See the release recovery result above.'
fi
fail 'Deployment failed and recovery did not complete. The pending release record has been kept.'
