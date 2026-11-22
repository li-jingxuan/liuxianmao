#!/bin/sh
set -eu

if [ "$#" -gt 1 ]; then
    echo 'Usage: sh deploy/fnos/package.sh [output-dir]' >&2
    exit 2
fi

command -v fnpack >/dev/null 2>&1 || { echo 'Install the official fnpack CLI first.' >&2; exit 1; }
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
brand="$script_dir/../../apps/website/public/assets/brand"
output=${1:-"$script_dir/dist"}
mkdir -p -- "$output"
output=$(CDPATH= cd -- "$output" && pwd)
stage=$(mktemp -d "${TMPDIR:-/tmp}/liuxianmao-fpk.XXXXXXXX")
trap 'rm -rf -- "$stage"' EXIT
trap 'exit 1' HUP INT TERM

mkdir "$stage/liuxianmao"
cp -R "$script_dir/fpk/." "$stage/liuxianmao/"
cd "$stage/liuxianmao"
mkdir -p app/ui/images wizard
cp "$brand/liuxianmao-64.png" ICON.PNG
cp "$brand/liuxianmao-256.png" ICON_256.PNG
cp ICON.PNG app/ui/images/icon_64.png
cp ICON_256.PNG app/ui/images/icon_256.png
chmod 755 cmd/main
for hook in install upgrade uninstall config; do
    for phase in init callback; do
        script="cmd/${hook}_${phase}"
        printf '#!/bin/sh\nexit 0\n' > "$script"
        chmod 755 "$script"
    done
done

fnpack build --nosign
test -s liuxianmao.fpk
mv -- liuxianmao.fpk "$output/liuxianmao.fpk"
printf '%s\n' "$output/liuxianmao.fpk"
