# 飞牛 NAS Docker 部署指引

本目录是 Pindou 的生产部署入口，适用于飞牛 NAS（fnOS）或其他支持 Docker Compose 的 Linux 主机。

## 目录说明

- `compose.yaml`：PostgreSQL、FastAPI API、Next.js Web 的生产编排文件。
- `api.Dockerfile`：API 生产镜像，启动时先执行 Alembic migration。
- `web.Dockerfile`：Next.js standalone 生产镜像。
- `.env.example`：配置模板；不要把真实 `.env` 提交到 Git。
- `backup-postgres.sh`：生成 PostgreSQL 压缩逻辑备份。
- `data/postgres/`：PostgreSQL 数据目录，容器重建后保留数据。
- `data/api-images/`：API 运行时图片备份目录。
- `backups/`：数据库备份目录。

## 1. 准备配置

在仓库根目录执行：

```bash
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
```

编辑 `deploy/.env`，至少替换：

- `POSTGRES_PASSWORD`
- `DATABASE_URL` 中的 URL 编码密码
- `KEY_ISSUER_API_KEY`
- `API_KEY_HASH_PEPPER`

可用仓库中的脚本生成两项 API 随机密钥：

```bash
./generate-api-secrets.sh
```

首次使用 bind mount 时，给 API 图片目录授予镜像内非 root 用户（UID/GID `10001`）写权限：

```bash
mkdir -p deploy/data/postgres deploy/data/api-images deploy/backups
sudo chown -R 10001:10001 deploy/data/api-images
```

当前代码历史中出现过开发默认密钥，正式部署前必须将它们视为已泄露并重新生成。`ARK_DOUBAO_API_KEY` 只允许出现在 API 容器环境变量中，不能使用 `NEXT_PUBLIC_*` 或写入 Web 镜像。

## 2. 本机构建并启动

在仓库根目录执行：

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml config
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

Web 镜像默认通过 DaoCloud 拉取 Node 基础镜像，并通过 npmmirror 下载 pnpm
和前端依赖。依赖下载使用 BuildKit cache；构建因网络中断后再次执行时，会复用
已经下载到 pnpm store 的 Next.js、SWC 和 Sharp 等包。

如果当前网络使用企业 npm 代理，或默认镜像暂时不可用，可在 `deploy/.env`
中覆盖：

```dotenv
# 国内默认值
NODE_IMAGE=docker.m.daocloud.io/library/node:22-alpine
NPM_REGISTRY=https://registry.npmmirror.com

# 需要切回官方源时使用
# NODE_IMAGE=node:22-alpine
# NPM_REGISTRY=https://registry.npmjs.org
```

Compose 只把 Web 映射到 NAS 宿主机，默认访问地址为：

```text
http://<NAS 的局域网 IP>:3000
```

API 和 PostgreSQL 只在 Compose 内部网络中可访问。API 容器启动时会先执行 `alembic upgrade head`，然后启动 Uvicorn。

## 3. 镜像仓库部署（推荐长期运行）

在开发机或 CI 中构建并推送固定版本 tag：

```bash
docker build -f deploy/api.Dockerfile -t registry.example.com/pindou-api:20260814 .
docker build -f deploy/web.Dockerfile -t registry.example.com/pindou-web:20260814 .
docker push registry.example.com/pindou-api:20260814
docker push registry.example.com/pindou-web:20260814
```

在 NAS 的 `deploy/.env` 中设置：

```dotenv
API_IMAGE=registry.example.com/pindou-api:20260814
WEB_IMAGE=registry.example.com/pindou-web:20260814
```

然后执行：

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml pull
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
```

如果 NAS 是 ARM64，CI 需要构建对应架构或 multi-arch 镜像；不要把 amd64 镜像直接部署到 ARM64 NAS。

## 4. 健康检查与验收

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail=100 api
docker compose --env-file deploy/.env -f deploy/compose.yaml exec api \
  python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz')"
docker compose --env-file deploy/.env -f deploy/compose.yaml exec api \
  python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/readyz')"
```

浏览器开发者工具应看到同源请求 `/api/v1/color-sets` 和 `/api/v1/conversions`，不能出现 `localhost:8000`。上传一张小图片完成一次转换后，再重启容器确认数据库和图片备份仍存在。

## 5. 备份与升级

生成 PostgreSQL 备份：

```bash
./deploy/backup-postgres.sh
```

`deploy/backups/` 和 `deploy/data/api-images/` 应纳入 fnOS 快照或同步到另一块磁盘。升级前先备份，再拉取新镜像并启动：

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d
```

保留上一个 API/Web 镜像 tag 以便回滚。若数据库迁移不可逆，不要直接把数据库降级到旧版本，应先恢复到隔离实例验证。

## 6. 故障排查

- API 启动失败：查看 `logs api`，优先检查 `DATABASE_URL`、三个 API 必需配置和 migration 日志。
- Web 页面打开但 API 报错：确认 Web 镜像重新构建过；API 代理地址在构建阶段固定为 `http://api:8000`。
- 数据库连接失败：容器内主机名必须是 `postgres`，不能写 `localhost` 或 NAS IP。
- 上传图片丢失：检查 `deploy/data/api-images/` 是否可写，以及 `IMAGE_BACKUP_DIR` 是否为 `/var/lib/pindou/images`。
- 502/504：确认 API healthcheck 通过；若启用 Seedream，检查 NAS 出网、方舟密钥、额度和 API 日志。

## 7. 安全基线

1. 不要映射 API 或 PostgreSQL 端口到 NAS 宿主机；公网访问使用 fnOS 反向代理、HTTPS 和 VPN/认证。
2. 固定镜像版本 tag，不使用 `latest`。
3. 限制 `.env` 权限，定期轮换数据库密码、签发密钥、pepper 和方舟 API Key。
4. 生产环境设置 `APP_ENV=production`、`API_RELOAD=false`；先以 `IMAGE_ENHANCER=passthrough` 验证，再按需开启 Seedream。
