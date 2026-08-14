#!/usr/bin/env sh

set -eu

deploy_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$deploy_dir"

if [ ! -f .env ]; then
  echo "错误：请先复制 .env.example 为 .env 并填写配置" >&2
  exit 1
fi

mkdir -p backups
stamp=$(date +%Y%m%d-%H%M%S)
output="backups/pindou-${stamp}.dump"

docker compose --env-file .env -f compose.yaml exec -T postgres \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$output"

echo "已生成 PostgreSQL 备份：$output"
