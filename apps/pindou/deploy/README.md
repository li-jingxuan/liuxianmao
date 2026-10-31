# Docker 独立部署

适用于支持 Docker Compose 的主机，以下命令在 `apps/pindou/` 目录执行。
飞牛应用中心安装及官方 `/app/pindou` 统一网关接入请使用 [飞牛 Docker 应用包](fnos/README.md)。

## 1. 准备配置

```bash
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
mkdir -p deploy/data/postgres deploy/data/api-images deploy/data/api-logs deploy/data/image-deliveries deploy/backups
# API 容器以 10001 用户运行，图片和日志目录都必须允许它写入。
sudo chown -R 10001:10001 deploy/data/api-images deploy/data/api-logs deploy/data/image-deliveries
```

编辑 `deploy/.env`，至少替换：

- `POSTGRES_PASSWORD`
- `DATABASE_URL` 中经过 URL 编码的数据库密码
- `KEY_ISSUER_API_KEY`
- `API_KEY_HASH_PEPPER`
- `ARK_DOUBAO_API_KEY`
- `POSTGRES_DB`、`POSTGRES_USER`（与 DATABASE_URL 一致）

可以生成 API 随机密钥：

```bash
./generate-api-secrets.sh
```

当前生产转换使用 Seedream，需能够访问方舟。旧 ONNX 部署参数不影响当前转换路径。

## 2. 构建并启动

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml config
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

访问地址：`http://<NAS IP>:3111`。
普通部署须在构建前将 `NEXT_PUBLIC_API_BASE_URL` 设置为浏览器可访问的 API 地址
（例如 `http://<NAS IP>:3112`，不包含 `/api`）；不要将客户端 `localhost` 当作 NAS 地址。

Web 构建默认使用 DaoCloud Node 镜像和 npmmirror npm 源，并缓存 pnpm 依赖。
如果镜像不可用，可在 `deploy/.env` 中切回官方源：

```dotenv
NODE_IMAGE=node:22-alpine
NPM_REGISTRY=https://registry.npmjs.org
```

## 3. 查看日志

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml logs -f --tail=100
```

只查看单个服务：

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml logs -f web
docker compose --env-file deploy/.env -f deploy/compose.yaml logs -f api
```

## 4. 更新、停止与备份

更新代码后重新构建：

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
```

停止服务：

```bash
docker compose --env-file deploy/.env -f deploy/compose.yaml down
```

备份 PostgreSQL：

```bash
./deploy/backup-postgres.sh
```

数据库、AI 排查图片、短期交付图和备份分别保存在 `deploy/data/postgres/`、
`deploy/data/api-images/`、`deploy/data/image-deliveries/` 和 `deploy/backups/`。
交付图默认 7 天后自动删除，不应纳入长期快照。不要提交 `deploy/.env`，也不要将
API 或 PostgreSQL 端口直接暴露到公网。当前 Compose 默认将 API 映射到
`API_HOST_PORT`（默认 `3112`）；若不需要从 NAS 宿主机或局域网直接访问 API，可删除
`api` 服务的 `ports` 配置。

API Compose 健康检查使用 `/readyz`，验证数据库连通性；
`/healthz` 只代表进程存活。
