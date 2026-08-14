# 拼豆在飞牛 NAS（fnOS）上的 Docker 部署方案

本文面向当前仓库的 `apps/api`（FastAPI）和 `apps/web`（Next.js），目标是在飞牛 NAS 上用 Docker Compose 部署一套可维护的局域网服务。方案默认先服务于家庭/团队局域网；如果需要公网访问，再在此基础上增加 HTTPS、域名和访问控制。

## 1. 现状与目标

### 1.1 仓库现状

| 项目 | 当前情况 | 部署影响 |
| --- | --- | --- |
| API | Python 3.12、FastAPI、Uvicorn，入口为 `pindou.main:app` | 需要独立 API 镜像，并在启动前执行 Alembic migration |
| 数据库 | PostgreSQL 17，根目录 Compose 目前只定义了 `postgres` | 生产 Compose 需要补齐 API/Web，并且数据库只加入内部网络 |
| Web | Next.js App Router，使用 pnpm，浏览器端直接读取 `NEXT_PUBLIC_API_BASE_URL` | 生产应改为同源 `/api` 代理，避免把 NAS 内部地址写入前端或产生 HTTPS 混合内容 |
| 运行时文件 | API 会写入 `apps/api/src/pindou/assets/images` | 必须挂载 NAS 目录，否则容器重建会丢失图片备份 |
| 色卡 | 默认从仓库的 `docs/MARD_色卡.json` 读取 | API 镜像必须复制该文件，或通过 `MARD_COLOR_CHART_PATH` 指向挂载文件 |
| 配置 | `apps/api/src/pindou/core/config.py` 中有开发默认值，且当前仓库已有默认密钥/数据库连接字符串 | 上线前必须移除生产可用的代码默认密钥，改用 `.env`/Docker secrets，并轮换已经暴露的密钥 |

### 1.2 目标架构

```text
局域网浏览器
      |
      | 仅暴露 3111（可选再由 fnOS 反代为 80/443）
      v
  pindou-web  ---- 内部网络 ---->  pindou-api  ---->  postgres
   Next.js                         FastAPI             PostgreSQL
                                      |
                                      +---- API 备份卷
                                      +---- 火山方舟（可选）
```

推荐只对 NAS 暴露 Web 端口；API、PostgreSQL 和 Compose 内部网络不做端口映射。Web 的 Next.js rewrite 将 `/api/*` 转发给 `api:3112`，浏览器始终访问同源地址。

## 2. 飞牛 NAS 准备

1. 在 fnOS 的 Docker/容器管理中确认 CPU 架构（`amd64` 或 `arm64`），并选择与之匹配的基础镜像。若仓库要同时支持两种架构，应在 CI 构建 multi-arch 镜像。
2. 创建一个专用共享目录，例如：

   ```text
   /vol1/1000/docker/pindou/
   ├── compose.yaml
   ├── .env
   ├── postgres-data/        # PostgreSQL 数据目录
   ├── backups/             # PostgreSQL 逻辑备份
   └── api-images/          # API 运行时图片备份
   ```

   实际卷路径以 fnOS 的存储卷名称为准，不要直接照抄 `/vol1`。
3. 为该目录设置仅管理员可读的权限；`.env` 不要提交 Git，也不要放在 Web 静态目录。
4. 预留至少 2 核 CPU、4 GB RAM 和足够的图片/数据库空间。Seedream 会增加网络等待和内存峰值，建议 API 容器限制并发为 2。
5. 若仅局域网使用，给 NAS 配置固定 DHCP 租约（例如 `192.168.1.20`），客户端访问 `http://<NAS_IP>:3111`。公网使用时优先在 fnOS 反向代理中配置域名和 HTTPS，不要直接转发 PostgreSQL 端口。

## 3. 代码改造清单（部署前完成）

以下改造属于部署所需的最小代码变更，建议单独提交，便于回滚。

### 3.1 API 生产配置

- 将 `API_RELOAD` 的生产值设为 `false`，`APP_ENV=production`。
- 将 `DATABASE_URL`、`KEY_ISSUER_API_KEY`、`API_KEY_HASH_PEPPER`、`ARK_DOUBAO_API_KEY` 的代码默认值删除或改为 `None`，缺失时让启动校验失败。当前仓库中的默认值已视为泄露，部署前应全部轮换。
- `DATABASE_URL` 在容器内使用服务名 `postgres`，不要使用 `localhost`：

  ```text
  postgresql+psycopg://pindou:<URL 编码后的密码>@postgres:5432/pindou
  ```

- 将 `IMAGE_BACKUP_DIR=/var/lib/pindou/images`，并在 Compose 中挂载 NAS 目录。
- 将 `MARD_COLOR_CHART_PATH=/app/docs/MARD_色卡.json`，确保镜像内路径稳定。
- 生产先用 `IMAGE_ENHANCER=passthrough` 验证链路；确认方舟 API 密钥、额度和出网后再切换 `seedream`。

### 3.2 Web 同源 API 代理

建议修改 `apps/web/src/lib/api.ts`，把默认地址改为同源路径：

```ts
const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "/api";
```

并在 `apps/web/next.config.ts` 开启 rewrite。`PINDOU_API_ORIGIN` 是构建阶段参数，生产固定为 Compose 网络中的 `http://api:3112`：

```ts
import type { NextConfig } from "next";

const apiOrigin = process.env.PINDOU_API_ORIGIN ?? "http://api:3112";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiOrigin}/api/:path*` }];
  },
};

export default nextConfig;
```

这样 `NEXT_PUBLIC_API_BASE_URL` 不需要写入 NAS IP，且 API 不需要对宿主机开放端口。由于 Next.js rewrite 配置会随构建产物固化，若更换 Compose 服务名或网络，必须重新构建 Web 镜像。若暂时不改 Web 代码，必须把 `NEXT_PUBLIC_API_BASE_URL=http://<NAS_IP>:3112` 注入 Web 构建，并额外映射 API 端口；这只是过渡方案，不推荐作为公网部署方案。

### 3.3 构建上下文与忽略文件

在仓库根目录增加 `.dockerignore`，至少排除 `.git`、`.next`、`node_modules`、`.venv`、测试缓存和 `.env*`。API 镜像需要 `docs/MARD_色卡.json`，因此不要把整个 `docs/` 排除后又忘记复制色卡。

## 4. 推荐镜像与 Compose 设计

### 4.1 API Dockerfile

新增 `apps/api/Dockerfile`，使用多阶段构建，运行时只保留依赖和应用文件：

```dockerfile
FROM python:3.12-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/apps/api/src
WORKDIR /app/apps/api

RUN addgroup --system pindou && adduser --system --ingroup pindou pindou
COPY apps/api/pyproject.toml /app/apps/api/pyproject.toml
COPY apps/api/src /app/apps/api/src
COPY apps/api/migrations /app/apps/api/migrations
COPY apps/api/alembic.ini /app/apps/api/alembic.ini
COPY docs/MARD_色卡.json /app/docs/MARD_色卡.json

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir /app/apps/api
RUN mkdir -p /var/lib/pindou/images \
    && chown -R pindou:pindou /app /var/lib/pindou

USER pindou
EXPOSE 3112
CMD ["uvicorn", "pindou.main:app", "--host", "0.0.0.0", "--port", "3112"]
```

实际构建时应在仓库根目录执行；如果项目采用锁文件，建议在构建阶段使用锁定依赖，避免 `>=` 范围在每次构建时漂移。

### 4.2 Web Dockerfile

新增 `apps/web/Dockerfile`，利用 Next standalone 输出：

```dockerfile
FROM node:22-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY apps/web/package.json apps/web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:22-alpine AS builder
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY apps/web ./
ARG NEXT_PUBLIC_API_BASE_URL=/api
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL}
ARG PINDOU_API_ORIGIN=http://api:3112
ENV PINDOU_API_ORIGIN=${PINDOU_API_ORIGIN}
RUN mkdir -p public && pnpm build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3111 HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3111
CMD ["node", "server.js"]
```

若当前项目没有 `public/` 目录，可在 Dockerfile 中先创建空目录，或删除对应的 `COPY` 行；构建前应以实际目录为准验证。

### 4.3 生产 Compose 示例

将下列文件保存为 NAS 上的 `compose.yaml`。镜像名可替换为企业镜像仓库地址；初期也可以在 NAS 本机构建。

```yaml
name: pindou

services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:?请在 .env 中设置 POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER:?请在 .env 中设置 POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?请在 .env 中设置 POSTGRES_PASSWORD}
    volumes:
      - ./postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      timeout: 5s
      retries: 12
      start_period: 10s
    networks: [pindou]

  api:
    image: ${API_IMAGE:-pindou-api:local}
    build:
      context: .
      dockerfile: apps/api/Dockerfile
    restart: unless-stopped
    env_file: [.env]
    environment:
      APP_ENV: production
      API_HOST: 0.0.0.0
      API_PORT: 3112
      API_RELOAD: "false"
      DATABASE_URL: ${DATABASE_URL:?请在 .env 中设置 DATABASE_URL}
      MARD_COLOR_CHART_PATH: /app/docs/MARD_色卡.json
      IMAGE_BACKUP_DIR: /var/lib/pindou/images
    command: ["sh", "-c", "alembic -c /app/apps/api/alembic.ini upgrade head && uvicorn pindou.main:app --host 0.0.0.0 --port 3112"]
    depends_on:
      postgres:
        condition: service_healthy
    volumes:
      - ./api-images:/var/lib/pindou/images
    expose: ["3112"]
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3112/healthz')"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks: [pindou]

  web:
    image: ${WEB_IMAGE:-pindou-web:local}
    build:
      context: .
      dockerfile: apps/web/Dockerfile
      args:
        NEXT_PUBLIC_API_BASE_URL: /api
        PINDOU_API_ORIGIN: http://api:3112
    restart: unless-stopped
    depends_on:
      api:
        condition: service_healthy
    ports:
      - "${WEB_PORT:-3111}:3111"
    healthcheck:
      test: ["CMD", "wget", "--spider", "--quiet", "http://127.0.0.1:3111/"]
      interval: 15s
      timeout: 5s
      retries: 5
      start_period: 20s
    networks: [pindou]

networks:
  pindou:
    driver: bridge
```

说明：`DATABASE_URL` 中的密码必须进行 URL 编码；如果密码含 `@`、`:`、`/` 等字符，建议不要在 Compose 中拼接，而是在 `.env` 中直接提供完整的 `DATABASE_URL`。生产环境也可以把 `build` 换成固定版本镜像，并删除 `ports` 中 API/PostgreSQL 的映射。

## 5. 环境变量与密钥

在 NAS 的 Compose 目录创建 `.env`（示例值必须全部替换）：

```dotenv
POSTGRES_DB=pindou
POSTGRES_USER=pindou
POSTGRES_PASSWORD=替换为高熵随机密码
DATABASE_URL=postgresql+psycopg://pindou:URL编码后的密码@postgres:5432/pindou

KEY_ISSUER_API_KEY=替换为新的随机密钥
API_KEY_HASH_PEPPER=替换为另一个随机密钥
IMAGE_ENHANCER=passthrough
ARK_DOUBAO_API_KEY=
ARK_DOUBAO_IMAGE_MODEL=doubao-seedream-5-0-lite-260128

WEB_PORT=3111
API_IMAGE=registry.example.com/pindou-api:2026-08-14
WEB_IMAGE=registry.example.com/pindou-web:2026-08-14
```

可在有 OpenSSL 的机器上生成两项 API 密钥：

```bash
./generate-api-secrets.sh
```

更安全的生产做法是使用 fnOS 的 secrets/环境变量管理能力，或将 `.env` 权限收紧为 `600`。密钥不应写入镜像层、Git、前端 `NEXT_PUBLIC_*` 变量、浏览器 URL 或截图。

## 6. 首次部署步骤

### 6.1 在开发机验证镜像

```bash
docker build -f apps/api/Dockerfile -t pindou-api:local .
docker build -f apps/web/Dockerfile -t pindou-web:local .
docker compose -f compose.yaml config
```

先运行测试和构建：

```bash
cd apps/api && pytest -q && ruff check src tests
cd ../web && pnpm lint && pnpm test && pnpm build
```

### 6.2 复制到飞牛 NAS

将 `compose.yaml`、`.env` 和所需镜像放到 NAS 的专用目录。两种交付方式任选其一：

- **NAS 本机构建**：把仓库（至少包含 Dockerfile、`apps/`、`docs/MARD_色卡.json`）复制到 NAS，然后执行 `docker compose build`。
- **镜像仓库交付**：CI 构建并推送带不可变版本号的 API/Web 镜像，NAS 只执行 `docker compose pull`。这是长期运行更推荐的方式。

### 6.3 启动与验收

```bash
cd /vol1/1000/docker/pindou
docker compose pull                 # 使用镜像仓库时
docker compose up -d                # 本机构建时改为 --build
docker compose ps
docker compose logs -f --tail=100 api
```

验收清单：

1. `docker compose ps` 中 PostgreSQL、API、Web 均为 `healthy`/`running`。
2. `curl http://127.0.0.1:3111/` 返回页面；从另一台局域网设备打开 `http://<NAS_IP>:3111`。
3. 在 API 容器内检查 `http://127.0.0.1:3112/healthz` 和 `http://127.0.0.1:3112/readyz`；从 Web 入口验证 `/api/v1/color-sets` 能返回 JSON。
4. 浏览器开发者工具确认请求为同源 `/api/v1/color-sets` 和 `/api/v1/conversions`，没有请求 `localhost`。
5. 上传一张小图片完成一次转换；若启用 API Key，再验证无效 key、额度耗尽和数据库重启后的行为。

## 7. 备份、升级与回滚

### 7.1 数据备份

PostgreSQL 数据卷不能替代逻辑备份。每天至少执行一次 `pg_dump`，并保留 7~30 天：

```bash
mkdir -p backups
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "backups/pindou-$(date +%Y%m%d-%H%M%S).dump"
```

将 `backups/` 同步到另一块磁盘或远端存储；定期演练恢复：

```bash
docker compose exec -T postgres sh -c 'createdb -U "$POSTGRES_USER" pindou_restore_test'
docker compose exec -T postgres sh -c \
  'pg_restore -U "$POSTGRES_USER" -d pindou_restore_test --clean --if-exists' \
  < backups/<某个备份>.dump
```

API 图片备份目录 `api-images/` 也应纳入 fnOS 快照或 rsync 计划。若产品不需要长期保留原图，可在应用层增加 TTL 清理，避免 NAS 被图片耗尽。

### 7.2 升级流程

1. 先在开发机执行测试、镜像构建和 `docker compose config`。
2. 生成数据库备份，记录当前镜像 tag 和 `alembic_version`。
3. 拉取新镜像，执行 `docker compose up -d`；API 容器启动命令会先执行 `alembic upgrade head`。
4. 依次检查 `/healthz`、`/readyz`、Web 页面和实际转换。
5. 观察 API 日志和 NAS 资源 10~30 分钟。

### 7.3 回滚流程

保留上一个 API/Web 镜像 tag，回滚应用镜像时执行 `docker compose up -d`。如果迁移包含不可逆变更，不要直接降级数据库；应先恢复备份到隔离实例并确认兼容性，再决定应用回滚或补偿迁移。

## 8. 监控与故障排查

- 日志：`docker compose logs --since=30m api web postgres`；应用已有 `x-request-id`，排查时记录该 ID。
- 健康状态：API `/healthz` 只检查进程，`/readyz` 检查数据库；Web 健康检查访问根路径。
- 资源：重点观察 NAS 的 CPU、内存、存储空间、容器重启次数和 PostgreSQL 卷增长。
- API 启动失败：优先查 `DATABASE_URL`、三项必需密钥、色卡路径和迁移日志。
- Web 页面能打开但请求打到 `localhost`：检查 `NEXT_PUBLIC_API_BASE_URL` 是否仍为旧值，并重新构建 Web 镜像（该变量在构建时写入客户端包）。
- `502/504`：检查 API 是否 healthy、`PINDOU_API_ORIGIN` 是否为 `http://api:3112`，以及 API 是否因 Seedream 超时或并发限制持续重启。
- 数据库连接失败：确认 Compose 网络中的主机名是 `postgres`，不要使用 NAS 宿主机 IP 或 `localhost`；检查数据库健康日志和磁盘空间。
- 上传后文件消失：确认 `api_images` 卷挂载到 `/var/lib/pindou/images`，并核对应用的 `IMAGE_BACKUP_DIR`。

## 9. 安全基线

1. API 和 PostgreSQL 不映射宿主机端口；如确需临时调试，限制到 NAS 管理网段并在完成后移除。
2. fnOS 防火墙仅允许可信局域网访问 Web 端口；公网场景必须使用 HTTPS、强认证或 VPN。
3. 关闭生产 API docs（如不需要）或在反向代理层限制 `/docs`、`/redoc` 的访问来源。
4. 不把方舟密钥、签发密钥、pepper 和数据库密码传到浏览器；`NEXT_PUBLIC_*` 只能放公开配置。
5. 固定镜像版本，不直接使用 `latest`；每月更新基础镜像和 Python/Node 依赖，并在升级前备份。
6. 使用非 root 用户运行 API/Web；PostgreSQL 使用官方镜像默认用户即可，但卷目录权限要与容器 UID/GID 兼容。

## 10. 分阶段落地建议

| 阶段 | 范围 | 退出标准 |
| --- | --- | --- |
| P0 本地容器化 | Dockerfile、Compose、同源 `/api` rewrite、移除硬编码密钥 | 三个容器能启动，API/Web 测试和一次真实转换通过 |
| P1 NAS 局域网 | 固定 IP、NAS 卷、健康检查、备份脚本 | 其他设备可访问，重启 NAS 后数据和图片仍在 |
| P2 稳定运行 | 镜像仓库、固定 tag、定时备份、资源告警 | 可在 30 分钟内完成升级和回滚 |
| P3 公网（可选） | fnOS 反代、域名、TLS、VPN/认证、访问日志 | 外网只看到 443，数据库/API 无公网暴露 |
