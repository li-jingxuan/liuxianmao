# 飞牛 NAS 部署与配置

本目录集中保存构建参数和运行配置模板。飞牛应用由应用中心安装 `.fpk` 并管理四个容器；访问路径固定为 `/app/pindou/`，通过飞牛统一网关登录后访问，无新增宿主机端口。普通 Web 部署继续使用 `deploy/compose.yaml`，不使用本目录的配置。

## 目录结构

```text
fnos/
├── deployment/                 # 本部署说明与可复制的示例
│   ├── build.env.example       # 镜像构建、版本及打包参数
│   └── config/
│       ├── api.env.example     # API 环境变量格式及说明
│       └── postgres.env.example
├── app/docker/                 # 飞牛专用 Compose、初始化和启动脚本
├── cmd/                        # 应用中心生命周期脚本
├── config/                     # 飞牛权限与 Docker 项目声明，不是环境变量目录
├── proxy/                      # 网关 Socket 代理镜像源码
├── scripts/                    # 构建、打包与检查工具
└── dist/pindou/pindou.fpk       # package 命令生成的安装包，不提交 Git
```

NAS 安装后目录由飞牛创建，位于所选存储卷；通过以下稳定路径管理，不要手工创建或修改 `/var/apps` 的符号链接：

```text
/var/apps/pindou/
├── etc/                        # 真实配置（指向所选卷 @appconf/pindou）
│   ├── api.env
│   └── postgres.env
├── target/                     # 安装文件（指向 @appcenter/pindou）
│   ├── docker/docker-compose.yaml
│   └── pindou.sock             # 运行时生成的官方网关 Socket
├── var/                        # 持久数据（指向 @appdata/pindou）
│   ├── postgres/
│   ├── api-images/
│   ├── api-logs/
│   └── image-deliveries/
└── cmd/                        # 已安装的生命周期脚本
```

安装器也可能生成私有代理配置；这类文件由初始化程序维护，不要手写密钥到 nginx 源码或前端环境变量。

## 1. 准备构建配置

在完整仓库中操作，以下命令以 `apps/pindou/deploy/fnos/` 为当前目录：

```sh
cp deployment/build.env.example deployment/build.env
chmod 600 deployment/build.env
# 编辑 deployment/build.env 中的版本、镜像名和镜像源。
```

三个应用镜像必须使用飞牛版独立标签，不能覆盖正在运行的普通 Web 镜像。本机测试标签须在 NAS 中真实存在；发布到其他设备时，应使用自己的镜像仓库地址，并确保目标设备可拉取。

构建需要 Docker/Buildx；检查和打包需要 Python 3、Docker Compose 及官方 [fnpack](https://developer.fnnas.com/docs/cli/fnpack/)。实际安装不要求 NAS 安装 Python，初始化使用 API 镜像内的 Python。

## 2. 在 NAS 构建并打包

将完整 `apps/pindou/` 源码放在 NAS 的独立工作目录，例如 `/vol2/1000/pindou-fnos-build/`，进入该目录内的 `deploy/fnos/`。不要以已有业务数据目录作为构建目录。

NAS 上建议先按[主说明中的受限 BuildKit 配置](../README.md#构建发布与打包)创建 `pindou-fnos-builder`，再在 `deployment/build.env` 中启用 `DOCKER_BUILDER=pindou-fnos-builder`。这样构建器限制为 1 CPU、1536 MiB 内存、单任务并行；不切换系统默认构建器。

```sh
# 只加载自己编辑的构建参数文件，不要加载运行时的 api.env/postgres.env。
set -a
. ./deployment/build.env
set +a
./scripts/build.sh check
./scripts/build.sh images
./scripts/build.sh package
```

产物为 `dist/pindou/pindou.fpk`。`images` 会把 Web 固定构建为 `/app/pindou` 前缀和同源 API；不用额外编辑普通 Web 的 `.env`。打包不包含镜像 tar，也不会自动推送镜像；需要离线部署时由管理员另行 `docker save`/`docker load` 预加载四个镜像。

构建结束后，可停止专用构建器释放资源：

```sh
docker buildx stop pindou-fnos-builder
```

## 3. 在应用中心安装

在飞牛应用中心选择手动安装，上传 `.fpk`，选择存储卷，并在安装向导填写方舟 API Key。数据库密码、管理密钥及哈希 Pepper 由安装程序随机生成，不需要将配置模板复制到系统目录。安装后从应用中心启动拼豆。

运行项目名为 `pindou-fnos`，四个容器分别是 proxy、web、api、postgres；与普通部署的 `pindou` 项目及其数据独立。

已安装应用更新前先备份，再使用应用中心的更新流程。`appcenter-cli install-fpk` 对已安装应用可能只返回 installed，不代表版本已升级；更新后必须核对 manifest 版本、实际镜像及数据保留情况。不要卸载应用来模拟升级。

## 4. 查看和修改运行配置

| 文件/变量 | 用途 |
| --- | --- |
| `/var/apps/pindou/etc/api.env` | API 的实际运行配置，管理员读取和编辑 |
| `KEY_ISSUER_API_KEY` | 本部署签发管理密钥，对应 `X-Admin-API-Key` |
| `API_KEY_HASH_PEPPER` | 消费密钥哈希 Pepper，已有部署保持原值 |
| `ARK_DOUBAO_API_KEY` | 方舟上游服务密钥，与拼豆管理密钥不同 |
| `DATABASE_URL` | 与 postgres.env 匹配的连接串，密码须 URL 编码 |
| `ARK_DOUBAO_MAX_CONCURRENCY` | AI 并发，飞牛安装默认 1 |
| `IMAGE_DELIVERY_TTL_SECONDS` | 交付图有效期，默认 604800 秒（7 天） |
| `/var/apps/pindou/etc/postgres.env` | 数据库名称、用户和密码 |

模板位于本目录 `config/`，只用于对照格式，**不要覆盖已有配置**。真实配置权限应为 `0600`。值使用双引号；字面 `$` 写成 `$$`，引号写成 `\"`，反斜杠写成 `\\`。这不是可直接执行的 Shell 文件，禁止 `source`。

管理员可在 NAS 编辑，例如：

```sh
sudo vi /var/apps/pindou/etc/api.env
sudo chmod 600 /var/apps/pindou/etc/api.env /var/apps/pindou/etc/postgres.env
```

方舟密钥优先通过应用配置向导修改；手工编辑前先备份。修改后在应用中心停止再启动，并确认运行容器已读取新值；如果没有，应按平台支持的重建流程处理，不能只在容器内执行进程重启。不要更改现有数据库密码、管理密钥或 Pepper 来修复页面权限提示。

## 5. 访问和验收

登录飞牛后打开 `/app/pindou/`。密钥签发页为 `/app/pindou/gk/fnos/`；原始手工签发模式使用本应用 `KEY_ISSUER_API_KEY`，不能使用普通部署的旧管理密钥。自定义 `nice` 来源可由管理员注册一次：

```sh
docker exec pindou-fnos-api-1 python -m pindou.cli key-prefix add nice --name nice
```

随后访问 `/app/pindou/gk/nice/`。已存在的来源不必重复注册；飞牛登录凭据、拼豆管理密钥、消费密钥和方舟密钥是不同用途。

检查运行状态：

```sh
docker ps --filter label=com.docker.compose.project=pindou-fnos
sudo /var/apps/pindou/cmd/main status
docker exec pindou-fnos-proxy-1 nginx -t
```

在具有 Python 3 且可访问 Socket 的环境，还可从 `fnos/` 执行：

```sh
sudo python3 scripts/smoke.py /var/apps/pindou/target/pindou.sock
```

该检查不提交转换，不调用方舟；NAS 登录态仍需通过浏览器另行验证。网关返回 `invalid token` 时先检查飞牛登录状态；签发返回 `ADMIN_API_KEY_INVALID` 时检查当前部署管理密钥；来源无效则检查对应前缀是否注册。

## 6. 备份与恢复

先在应用中心停止拼豆，再将 `etc`、`var` 和 manifest 备份到本应用目录之外，具体命令见[备份说明](../README.md#初始化配置和升级)。备份包含凭据，应限制访问权限。恢复也须停机、保留 UID/GID 和权限，并确认 PostgreSQL 主版本为 17。不要向运行中的数据库覆盖文件。

`deployment/build.env`、`deployment/config/*.env` 及 `deployment/backups/` 已加入本目录忽略规则；`.example` 可提交，真实配置和备份不提交。
