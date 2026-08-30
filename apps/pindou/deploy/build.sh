#!/usr/bin/env bash

set -euo pipefail

# 固定从项目根目录执行，避免在其他目录调用脚本时找不到部署文件。
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

usage() {
  cat <<'EOF'
用法：
  ./deploy/build.sh [web-and-api|web|api|postgresql]

不传参数时，将通过交互菜单选择需要构建并启动的服务。
EOF
}

run_compose() {
  local -a services=("$@")

  echo "正在构建并启动：${services[*]}"
  docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build "${services[@]}"
}

# 将用户选择转换为 compose.yaml 中的实际服务名。
run_selection() {
  case "$1" in
    1 | web-and-api | web_and_api | "web and api")
      run_compose web api
      ;;
    2 | web)
      run_compose web
      ;;
    3 | api)
      run_compose api
      ;;
    4 | postgresql | postgres)
      run_compose postgres
      ;;
    -h | --help | help)
      usage
      ;;
    *)
      echo "无效的构建选项：$1" >&2
      usage >&2
      return 1
      ;;
  esac
}

if (($# > 1)); then
  echo "一次只能选择一个构建选项。" >&2
  usage >&2
  exit 1
fi

if (($# == 1)); then
  run_selection "$1"
  exit
fi

echo "请选择需要构建并启动的服务："
echo "  1) web and api"
echo "  2) web"
echo "  3) api"
echo "  4) postgresql"
read -r -p "请输入选项 [1-4]：" selection

run_selection "$selection"
