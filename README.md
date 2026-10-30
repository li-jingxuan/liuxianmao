# Pindou

拼豆图纸转换项目，业务代码、测试、资源和部署配置均位于 `apps/pindou/`。

- `apps/pindou/apps/web/`：Next.js 前端，默认端口 `3111`。
- `apps/pindou/apps/api/`：FastAPI 后端，默认端口 `3112`。
- `apps/pindou/docs/`：拼豆文档及运行所需的 MARD 色卡资源。
- `apps/pindou/deploy/`：Docker 部署配置和脚本。

## 本地开发

需要 Python 3.12+、Node.js 20.9+ 和 pnpm 11.10.0。

先在拼豆项目目录启动 PostgreSQL：

```bash
cd apps/pindou
POSTGRES_PASSWORD='<local-password>' docker compose up -d postgres
```

安装并启动后端：

```bash
cd apps/api
python3.12 -m venv .venv
.venv/bin/python -m pip install -e .
cp .env.example .env
# 编辑 .env，配置数据库连接和服务密钥。
.venv/bin/alembic upgrade head
.venv/bin/python -m pindou.cli
```

在另一个终端中，从仓库根目录启动前端：

```bash
cd apps/pindou/apps/web
cp .env.example .env.local
pnpm install --frozen-lockfile
pnpm dev
```

## 验证

在 `apps/pindou/apps/web/` 中执行：

```bash
pnpm lint
pnpm test
pnpm exec tsc --noEmit
pnpm build
```

在 `apps/pindou/apps/api/` 中执行：

```bash
.venv/bin/python -m pip install pytest ruff
.venv/bin/ruff check src tests
.venv/bin/pytest -q
```

更多说明见 [Web 文档](apps/pindou/apps/web/README.md)、[API 文档](apps/pindou/apps/api/README.md) 和 [部署文档](apps/pindou/deploy/README.md)。
