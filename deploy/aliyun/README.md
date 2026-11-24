# 六线猫 Web · 阿里云轻量应用服务器部署

目标实例位于北京 `cn-beijing`，系统为 Alibaba Cloud Linux 3，架构为 `x86_64`，规格为 2 核 1 GB。在构建机打包 `linux/amd64` 镜像，轻量服务器只负责运行。通过 Workbench CLI 上传文件和执行服务器命令。

## 准备服务器

按阿里云的 Alibaba Cloud Linux 3 章节安装 Docker Engine 和 Compose v2 插件，并将 Docker 服务设为开机启动。使用 Docker Engine 28.0 或更新版本，确保映射到 `127.0.0.1` 的端口仅供宿主机访问。云防火墙保持 `3000/tcp` 不对公网开放。[阿里云安装说明](https://help.aliyun.com/zh/ecs/use-cases/install-and-use-docker) · [Docker 端口映射说明](https://docs.docker.com/engine/network/port-publishing/)

## 构建和打包

在仓库根目录执行以下 Bash 命令。`HEAD` 须指向包含本部署配置的已提交版本，可换成要发布的分支、标签或提交。`git archive` 以该提交提供完整的 monorepo 构建上下文。阿里云镜像将路径前缀留空，供 `/` 和 `/editor` 等路由直接访问。

```bash
set -euo pipefail

release_sha=$(git rev-parse --verify 'HEAD^{commit}')
release_dir=$(mktemp -d)
image="liuxianmao-web:sha-${release_sha}"

git archive --format=tar --output="$release_dir/source.tar" "$release_sha"
docker buildx build --platform linux/amd64 --load \
  --build-arg NEXT_PUBLIC_BASE_PATH= --tag "$image" - < "$release_dir/source.tar"
docker image save --output "$release_dir/web-image.tar" "$image"
gzip "$release_dir/web-image.tar"

# 将实际镜像标签写进发布用的 Compose 文件。
git show "$release_sha:deploy/aliyun/compose.yaml" |
  sed "s/REPLACE_WITH_GIT_SHA/$release_sha/" > "$release_dir/compose.yaml"
docker compose -f "$release_dir/compose.yaml" config --quiet
```

构建机无法访问默认镜像源时，可以追加 `--build-arg NODE_IMAGE=public.ecr.aws/docker/library/node:22-bookworm-slim`，从 Docker Official Images 的公共镜像库获取同版本基础镜像。[Node 公共镜像库](https://gallery.ecr.aws/docker/library/node)

## 上传和启动

在同一个构建机终端运行以下命令。Workbench 使用已配置的阿里云凭证。第一条远程命令会返回服务器上的临时目录，把实际路径填入 `remote_dir` 后再上传。

```bash
lxm_workbench() {
  workbench "$@" --product swas --region cn-beijing \
    --instance-id 5dc1a8c249d140b88c3c936ca34f952a --user-name admin
}

lxm_workbench exec --command 'mktemp -d /tmp/liuxianmao-release.XXXXXX'
remote_dir=/tmp/liuxianmao-release.XXXXXX  # 替换为上一条命令输出的实际目录
lxm_workbench upload "$release_dir/web-image.tar.gz" "$remote_dir/"
lxm_workbench upload "$release_dir/compose.yaml" "$remote_dir/"
```

在启动命令中导入镜像并检查标签和架构。每个版本的 Compose 文件放在对应的 Git SHA 目录中，Compose 项目名固定，切版本时会更新同一个服务。首次启动和版本切换都等待容器健康检查通过。

```bash
server_release_dir="/opt/liuxianmao/releases/$release_sha"
lxm_workbench exec --timeout 300 --command "
  set -eu
  sudo docker image load --input '$remote_dir/web-image.tar.gz'
  test \"\$(sudo docker image inspect --format '{{.Os}}/{{.Architecture}}' '$image')\" = linux/amd64
  sudo install -D -m 0644 '$remote_dir/compose.yaml' '$server_release_dir/compose.yaml'
  sudo docker compose -f '$server_release_dir/compose.yaml' up -d --wait --wait-timeout 90
"
```

## 本机验收和回滚

通过 Workbench 检查容器状态、首页和编辑器的 HTTP 响应，以及容器和宿主机的内存余量。还应确认首页引用的 `/_next/static/` 资源和预览图片可以通过同一个本机地址访问。

```bash
lxm_workbench exec --command "
  set -eu
  sudo docker compose -f '$server_release_dir/compose.yaml' ps
  curl -fsS --max-time 10 -o /dev/null -w '首页 HTTP %{http_code}\n' http://127.0.0.1:3000/
  curl -fsS --max-time 10 -o /dev/null -w '编辑器 HTTP %{http_code}\n' http://127.0.0.1:3000/editor
  sudo docker compose -f '$server_release_dir/compose.yaml' stats --no-stream web
  free -h
"
```

若启动或验收失败，通过对应发布目录的 `docker compose logs --tail=100 web` 检查日志。已有健康版本时，将 `previous_sha` 设置为上一版的完整 Git SHA，再运行下列命令并重复本机验收。保留当前版和上一健康版的本机镜像及 Compose 文件，以便回滚。

```bash
previous_sha=上一健康版本的完整GitSHA
lxm_workbench exec --timeout 120 --command "
  sudo docker compose -f '/opt/liuxianmao/releases/$previous_sha/compose.yaml' up -d --wait --wait-timeout 90
"
```

## 备案通过后开放公网

备案期间保持站点仅供本机访问。备案通过后，在宿主机配置 Nginx，将 `https://www.liuxianmao.com` 的请求代理到 `http://127.0.0.1:3000`。为两个域名配置有效证书，并将 `liuxianmao.com` 以 301 跳转至 `https://www.liuxianmao.com$request_uri`，保留路径和查询参数。上线验收覆盖 HTTPS、裸域跳转、`/editor` 刷新和备案号展示。[阿里云轻量应用服务器备案说明](https://help.aliyun.com/zh/simple-application-server/user-guide/apply-for-an-icp-filing-for-a-domain-name)
