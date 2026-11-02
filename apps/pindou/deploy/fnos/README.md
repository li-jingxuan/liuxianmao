# 拼豆 fnOS Docker 应用包

“上传并生成链接”的飞牛相册接口与鉴权说明见 [相册上传与七天外链](../../docs/fnos-album-share-api.md)。飞牛包先保存完整 PNG，再上传到配置相册，为单张图纸创建 7 天外链并显示可复制链接。默认相册 ID 为 `25`；可在 `api.env` 中设置 `NAS_ALBUM_ID`、`NAS_ALBUM_BASE_URL`（默认 `http://host.docker.internal:5666`）。使用当前 NAS 用户的会话和相册权限，失效时提示重新登录。

需要按访问来源选择内网 IP 或网关时，可在 `api.env` 配置 `NAS_ALBUM_BASE_URLS='["http://192.168.1.10:5666","https://nas.example.com"]'`，示例地址需替换为同一 NAS 的实际地址。浏览器 POST 的 `Origin` 与候选精确匹配时优先该地址，否则按列表顺序；只在上传前连接失败或超时才回退，上传开始后不切换。新配置优先于旧单地址配置，最多 4 个可信来源。网关必须直接支持 `/p/api/...` 与 `/upload`，且后端必须能访问它并使用当前会话；登录重定向不会被自动跟随。

本目录遵循 `fnpack create pindou --template docker` 的官方目录结构。固定外部路径为 **`/app/pindou`**，仅使用飞牛统一网关，无宿主机 TCP 端口映射。初始 manifest 声明 `platform=x86`；发布 ARM 包前须实际构建、验证相应镜像并调整声明，不能仅修改 manifest 后假定兼容。

## 访问路径与服务

fnOS 校验 NAS 登录态后，将保留路径的请求交给 `${TRIM_APPDEST}/pindou.sock`。proxy 专用镜像内的 nginx 监听这个 Socket：

| 外部路径 | 容器内路径 |
| --- | --- |
| `/app/pindou`、`/app/pindou/...` | web:3111，保留完整前缀 |
| `/app/pindou/api/v1/...` | api:3112 `/api/v1/...`，剥除 `/app/pindou` |
| `/app/pindou/readyz` | api:3112 `/readyz`，代理健康检查使用 |

Web 镜像必须以 `NEXT_PUBLIC_BASE_PATH=/app/pindou` 和 **空** `NEXT_PUBLIC_API_BASE_URL` 构建；浏览器采用同源地址。API 保持普通 `/api/v1` 路由与空 `root_path`。四个服务是 proxy / web / api / postgres；服务名、Compose 项目名 `pindou-fnos` 和网关前缀须跨版本保持稳定。应用包使用独立项目名，避免与已有普通 Docker 部署的 `pindou` 项目冲突。健康检查逐层检查数据库、API、Web 与 Socket；`cmd/main status` 要求四个容器均 running/healthy。

统一网关的登录校验与业务 API Key 鉴权均会生效。通过网关进入应用的 NAS 用户可直接签发密钥和上传施工图：专用 proxy 仅为这两个接口的 POST 请求补充本实例的 `KEY_ISSUER_API_KEY`，浏览器无需填写或读取管理密钥。转换和额度查询仍要求消费密钥。proxy 不自动重试请求；nginx 访问日志只记 `$uri`，不记查询参数，运行错误日志禁用以免请求行中的密钥泄露。API 禁用 Uvicorn access log。上层 fnOS 网关的日志策略需在设备上单独核对。

飞牛首页提供“转换密钥”输入及“签发密钥”入口，输入立即生效，停止输入约 350 毫秒后查询额度；输入框保持密码显示，有内容时可点击框内的 × 清空，无独立“显示”“应用”或“清空”按钮。签发成功后点击“使用此密钥生成图纸”，返回首页自动填入并使用新密钥。密钥仅在当前标签页的运行时内存中传递，不写入跳转 URL 或浏览器存储，刷新后需重新填写；原有带 `k` 的链接仍可初始化首页。页面跳转只保留密钥，不保留待转换图片及图纸结果。普通 Web 的地址栏参数和手填管理密钥方式保持原有行为。

## 构建、发布与打包

需要 Python 3、Docker/Compose、官方 [fnpack](https://developer.fnnas.com/docs/cli/fnpack/)。不依赖 NAS 主机安装 Python：初始化 helper 使用 API 镜像中的 Python。

源码 Compose 的 `example.invalid/pindou/*` 是**故意不可拉取的占位值**，不是已发布镜像。`stage`/`package` 必须指定真实镜像引用；以下 `local` 标签仅适合预加载到测试 NAS，同一标签也必须真实存在于 NAS Docker 镜像库：

```sh
cd apps/pindou/deploy/fnos
export API_IMAGE=pindou-api:0.1.0-fnos-local
export WEB_IMAGE=pindou-web:0.1.0-fnos-local
export PROXY_IMAGE=pindou-proxy:0.1.0-fnos-local
./scripts/build.sh check
./scripts/build.sh images
./scripts/build.sh package
```

`images` 从本仓库 `deploy/api.Dockerfile`、`deploy/web.Dockerfile` 和本目录 `proxy/Dockerfile` 构建，默认 `linux/amd64`，不推送镜像、不调用方舟服务。支持 `PYTHON_IMAGE`、`PIP_INDEX_URL`、`NODE_IMAGE`、`NPM_REGISTRY`、`NGINX_IMAGE` 和 `DOCKER_PLATFORM`。发布时将三个引用改成自己的实际 registry/repository/tag（生产建议镜像 digest），构建并按自己的发布流程推送，确保 NAS 可拉取。打包不会自动推送或验证标签已发布。

`stage` 只生成干净的 `dist/pindou/`；`package` 在该目录执行 `fnpack build`，产物为 `dist/pindou/pindou.fpk`。每次执行重新生成 staging，不改源码中的占位引用、不包含开发脚本、下载的工具、真实配置或旧构建。可设置 `PACKAGE_VERSION=0.1.1` 和 `POSTGRES_IMAGE=postgres:17-alpine`（也支持 digest）。重复打包的配置输入稳定；fnpack 自身的时间戳/归档行为不保证二进制逐字节相同。图标使用 `apps/web/src/assets/app_icon_64_64.png` 和 `app_icon_256_256.png`，由 `python3 scripts/icons.py` 原样同步到包根目录及桌面入口；更新原图后重新同步。

离线测试时可使用 `docker save`/`docker load` 由管理员预加载镜像；本包不捆绑镜像 tar。初次安装 helper 会在镜像缺失时由 Docker 正常拉取 API 镜像；其容器使用 `--network none`，不会发起应用网络请求。

在已有业务运行的 NAS 上构建时，使用独立目录、独立镜像标签和受限的专用 BuildKit，不覆盖 `pindou-api:local`、`pindou-web:local` 或原部署的数据。以下示例不切换全局默认构建器，`images` 会串行构建并将镜像加载到当前 NAS：

```sh
printf '[worker.oci]\n  max-parallelism = 1\n' > /tmp/pindou-fnos-buildkit.toml
docker buildx create --name pindou-fnos-builder --driver docker-container \
  --driver-opt image=docker.m.daocloud.io/moby/buildkit:buildx-stable-1,memory=1536m,memory-swap=1536m,cpu-period=100000,cpu-quota=100000 \
  --buildkitd-config /tmp/pindou-fnos-buildkit.toml
DOCKER_BUILDER=pindou-fnos-builder \
  PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple \
  NGINX_IMAGE=docker.m.daocloud.io/library/nginx:1.28-alpine \
  ./scripts/build.sh images
docker buildx stop pindou-fnos-builder
```

仍需先设置上文三个 `*_IMAGE` 变量。不重启 Docker daemon，不执行全局 prune，不对旧的 `pindou` 项目执行 Compose 命令。首次安装只新增应用包的 `pindou-fnos` 项目，不自动迁移普通部署的数据库。

## 初始化、配置和升级

飞牛会在安装时校验并创建 Docker 项目资源；`install_init` 会在此之前通过 API 镜像中的一次性 helper 完整生成 `api.env`、`postgres.env` 和私有代理凭证片段，因此首次容器创建已经拥有有效配置。升级时 `upgrade_init` 在解析新 Compose 前补建代理片段。安装向导要求方舟 API Key，因为当前 API 拒绝生产环境的 `passthrough` 模式。向导不要求人工生成数据库密码。`install_callback` 会幂等地再次调用该 helper：

- `${TRIM_PKGETC}/postgres.env`：仅 PostgreSQL 用户、数据库和随机密码。
- `${TRIM_PKGETC}/api.env`：URL 编码的数据库连接串、随机管理密钥、随机哈希 Pepper、方舟密钥及 API 设置。
- `${TRIM_PKGETC}/proxy-admin-auth.conf`：从现有管理密钥生成的 nginx 私有片段，权限 `0600`，只读挂载到 proxy，不包含其他 API 配置。缺失或无效时 proxy 拒绝启动。
- `${TRIM_PKGVAR}/postgres`：PostgreSQL 数据；`api-images`、`api-logs`、`image-deliveries`：API 持久化目录。

两个 env 文件均为 0600。生成格式为双引号 `KEY="value"`，支持反斜杠/引号转义，字面 `$` 写成 `$$`；**不要 `source`**。普通管理员在配置目录中读取 `api.env` 获取管理密钥，不在终端输出整份文件，不把真实 env 提交到仓库。容器数据目录按镜像的 API UID/GID 10001 创建；PostgreSQL 目录由官方镜像 entrypoint 设置所有权。

签发页面默认使用 `/app/pindou/gk/fnos/`，管理授权由本应用代理自动补齐，页面显示“管理密钥：已自动配置”。飞牛包与普通 Web 是独立部署，不共用管理密钥、来源前缀或访问额度。使用 `/app/pindou/gk/nice/` 等自定义来源前，先在飞牛 API 容器注册对应前缀，例如 `docker exec pindou-fnos-api-1 python -m pindou.cli key-prefix add nice --name nice`；已存在的前缀无需重复注册。出现 `ADMIN_API_KEY_INVALID` 时需核对当前 API 与代理的管理凭证配置。

`config/privilege` 对生命周期脚本使用官方 `run-as=root` 模式：它们必须访问 Docker daemon，helper 还需创建 0600 配置和设置 API 数据目录 UID；不假定 fnOS 提供名为 docker 的用户组。生命周期脚本不启动本地 Web 进程，常驻 API/Web 仍按各自镜像的非 root 用户运行。PostgreSQL 官方 entrypoint 降权，proxy 的 nginx worker 使用 nginx 用户；proxy master 为创建安装目录 Socket 保留容器 root，只有应用安装目录可写，root filesystem 只读。Docker 套接字访问及这些 bind mount 的权限需要 NAS 实测。

重复安装/升级保留现有数据库密码、管理密钥和 Pepper。已有数据库缺少 env 时会失败并要求恢复备份，避免生成新 Pepper 导致旧访问密钥全部失效。默认 `fnos` 来源前缀在 API 启动后先查询，缺失时调用既有 `python -m pindou.cli key-prefix add fnos --name '飞牛 NAS'`；不会重新启用已停用前缀。每次 API 启动先执行 `alembic upgrade head`；已迁移版本重复执行为无操作，失败则不启动 API。

配置向导仅更新方舟密钥，留空保留原值。配置后按向导提示在应用中心停止再启动，使容器重新读取 env；不假定平台自动重建容器。复杂参数（例如模型 ID）可由管理员按生成文件格式维护 `api.env`，随后重启。`cmd/main start/stop` 不重复调用 Compose，整个项目由 fnOS `docker-project` 管理。生命周期 callback 使用的 `docker run` 仅是一次性配置 helper。

管理密钥变更后，须重新执行应用配置初始化，生成对应的代理片段，并通过平台重建 API 与 proxy 容器，使 env 和只读文件挂载同时更新；单纯 nginx reload 或容器 restart 不保证读取原子替换后的新文件。日常重复初始化会保留内容未变文件的 inode，不轮换现有密钥。

首次配置默认 AI 并发 1；交付图默认保留 7 天、单图最大 30 MiB、每小时清理。
应用代理上限 32 MiB，另需真机确认官方网关自身的上传与请求时限。
容器设有资源上限：API 1 核/1 GiB、Web 0.5 核/256 MiB、PostgreSQL 0.5 核/256 MiB、proxy 0.25 核/64 MiB，防止新增应用无上限占用 NAS 资源。资源上限不代表预留内存；较大图片需在目标设备验证峰值内存。

升级前备份整个配置目录（两个 env 文件及私有代理片段）和全部数据；数据库使用 `pg_dump`，或停止应用后复制整个数据库目录。迁移后降级可能需要恢复备份。卸载向导提示先备份，卸载脚本不主动删除数据，但**不保证飞牛自身卸载清理后目录保留**；以实际设备流程为准。本包不提供未经确认的数据删除按钮。

停机备份的具体做法：先在应用中心停止拼豆，再由 NAS 管理员执行下列命令。
备份目录必须位于本应用数据目录之外，替换示例路径；`tar -C` 会进入系统目录链接指向的实际目录，避免只备份符号链接。

```sh
pindou_backup_dir=/你的备份共享目录/pindou-before-upgrade
sudo install -d -m 0700 "$pindou_backup_dir"
sudo tar -C /var/apps/pindou/etc -cpf "$pindou_backup_dir/etc.tar" .
sudo tar -C /var/apps/pindou/var -cpf "$pindou_backup_dir/var.tar" .
sudo cp /var/apps/pindou/manifest "$pindou_backup_dir/manifest"
sudo chmod 0600 "$pindou_backup_dir/"*.tar "$pindou_backup_dir/manifest"
```

备份成功后可在应用中心启动应用。恢复时同样先停止应用，确认数据库镜像主版本匹配，再由管理员将两个归档分别恢复到应用 `etc`、`var` 的实际目录，保留 UID/GID、权限及 mtime，完成后启动并核对旧密钥与交付图。不要向运行中的 PostgreSQL 目录覆盖物理备份。

## 已做验证与设备验收

`scripts/build.sh check` 实际验证 JSON、Shell/Python 语法、PNG 尺寸、首次和重复初始化、密钥稳定性、配置更新、URL 特殊字符编码、Compose env 转义、缺失配置恢复保护、损坏/错误 PostgreSQL 版本目录保护、四服务无端口映射及状态退出码；另检查私有代理片段、安装与升级生成时机及自动授权范围。设置 `NGINX_BINARY` 或安装 nginx 后还会验证 nginx 语法、真实代理请求、特殊字符转义、请求头继承和尾斜杠归一。测试仅使用临时目录和虚构密钥，不读取真实 env。无 Docker 时会明确跳过 Compose 检查。

运行中的 Socket 可用 `python3 scripts/smoke.py /var/apps/pindou/target/pindou.sock` 检查（需有目录及 Socket 访问权限）。该检查覆盖四个页面、静态资源、色卡 API、GET/POST 尾斜杠重定向及前缀边界，不提交转换、不调用方舟、不修改数据库；POST 仅验证 307 响应且不跟随。它直接访问 Socket，NAS 登录校验仍需另行通过官方网关验证。

本次开发机已用 Docker Compose 2.40.2 通过 `config --format json`，并下载官方 fnpack 1.2.3 macOS ARM 工具，使用本地测试标签成功生成 `.fpk`（仅证明包结构和基础格式可打包）。开发机 Docker daemon 未启动，因此未构建或运行镜像，未运行 `nginx -t`，未在 NAS 安装，也未调用付费服务。这些结果不构成可部署镜像已经发布或网关可用的证明。

发布前在目标 fnOS 上验证：

1. 四个实际发布镜像可拉取，架构正确；用 proxy 镜像执行 `nginx -t`，安装向导成功初始化；确认 install callback 生成 env 后平台才解析/启动 Compose。
2. 容器健康、`cmd/main status` 返回 0，Socket 确实位于安装 target 目录；应用中心停止/启动/升级无重复 Compose 控制。
3. 登录 NAS 后打开 `/app/pindou`，验证 `_next` 静态资源、刷新深链、同源 API；未登录不能经网关直接进入。
4. 用单独测试额度执行一次转换和交付图下载，验证 `/app/pindou/api/v1` 路由与实际等待时间；检查所有层日志不泄露查询密钥。
5. 更新方舟配置后停止/启动，确认容器已重新读取 env；升级后保留已有业务密钥/数据，模拟恢复备份并核对权限。卸载前确认设备的数据清理提示。

实现依据：官方 [Docker 案例](https://developer.fnnas.com/docs/examples/docker/)、[统一网关](https://developer.fnnas.com/docs/core-concepts/gateway-registration/)、[应用框架](https://developer.fnnas.com/docs/core-concepts/framework/)、[环境变量](https://developer.fnnas.com/docs/core-concepts/environment-variables/)、[权限](https://developer.fnnas.com/docs/core-concepts/privilege/)、[资源](https://developer.fnnas.com/docs/core-concepts/resource/)、[向导](https://developer.fnnas.com/docs/core-concepts/wizard/)、[Manifest](https://developer.fnnas.com/docs/core-concepts/manifest/) 和 [图标](https://developer.fnnas.com/docs/core-concepts/icon/)。
