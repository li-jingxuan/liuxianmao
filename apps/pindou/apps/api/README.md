# Pindou API

FastAPI service that converts an uploaded image into a square MARD bead grid. It can use
Seedream 5.0 lite before deterministic MARD quantization and returns grid JSON. 管理员还可以
把完整施工图短期保存为公开交付链接；该目录与 AI 排查备份完全隔离并按 TTL 清理。

## Setup

```bash
cd apps/api
python3 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/python -m pip install pytest httpx ruff
```

## Run

Start PostgreSQL from the repository root, then apply migrations:

```bash
POSTGRES_PASSWORD='<local-password>' docker compose up -d postgres
cd apps/api
.venv/bin/alembic upgrade head
```

Configure `DATABASE_URL`, `KEY_ISSUER_API_KEY`, and `API_KEY_HASH_PEPPER` in `apps/api/.env`.
The issuer key and pepper must be different high-entropy secrets.

管理员图纸交付使用以下配置；环境变量用途和默认值均在示例中保留中文说明：

```dotenv
IMAGE_DELIVERY_DIR=/absolute/path/to/image-deliveries
IMAGE_DELIVERY_TTL_SECONDS=604800
IMAGE_DELIVERY_MAX_BYTES=31457280
IMAGE_DELIVERY_MAX_PIXELS=50000000
IMAGE_DELIVERY_CLEANUP_INTERVAL_SECONDS=3600
```

For local deterministic conversion, keep `IMAGE_ENHANCER=passthrough` in `.env`. To enable
Seedream, configure the server-only key and switch the enhancer:

```dotenv
IMAGE_ENHANCER=seedream
ARK_DOUBAO_API_KEY=<secret>
ARK_DOUBAO_IMAGE_MODEL=doubao-seedream-5-0-lite-260128
```

Never expose the key through a `NEXT_PUBLIC_*` variable. Tests force `passthrough` and never
call the paid API.

```bash
.venv/bin/python -m pindou.cli
```

After reinstalling the editable package, `.venv/bin/pindou-api` is an equivalent shortcut.

The server listens on `0.0.0.0:3112` by default. OpenAPI is available from the same machine at
`http://127.0.0.1:3112/docs`, or from another device on the LAN at
`http://<host-lan-ip>:3112/docs`.

The listener can be changed in `.env`:

```dotenv
API_HOST=0.0.0.0
API_PORT=3112
API_RELOAD=true
```

`0.0.0.0` is a bind address and should not be entered in the browser. Use the computer's actual
LAN IP, such as `http://192.168.1.20:3112`. The operating-system firewall must also allow the
configured port. Set `API_RELOAD=false` outside development.

## CORS

The API currently allows requests from every browser origin, IP, method, and request header.
Cross-origin credentials are intentionally disabled, while `x-request-id`,
`x-ratelimit-limit`, and `x-ratelimit-remaining` are exposed for client diagnostics and quota
display. If cookie-based authentication is added later, replace the wildcard origin with an
explicit trusted-origin list before enabling credentials.

## Check

```bash
.venv/bin/ruff check src tests
.venv/bin/pytest -q
```

## API examples

List MARD color sets:

```bash
curl http://127.0.0.1:3112/api/v1/color-sets
```

Convert an image:

```bash
curl -X POST http://127.0.0.1:3112/api/v1/conversions \
  -H 'X-API-Key: pdk_web_<secret>' \
  -F 'image=@/absolute/path/source.png' \
  -F 'grid_size=52' \
  -F 'color_set_size=48' \
  -F 'background_mode=solid' \
  -F 'background_color=#FFFFFF'
```

Issue a two-use key for the registered `web` source:

```bash
curl -X POST http://127.0.0.1:3112/api/v1/access-keys \
  -H 'Content-Type: application/json' \
  -H 'X-Admin-API-Key: <KEY_ISSUER_API_KEY>' \
  -d '{"prefix":"web","allowed_uses":2}'
```

Upload a complete PNG pattern and receive a temporary token:

```bash
curl -X POST http://127.0.0.1:3112/api/v1/image-deliveries \
  -H 'X-Admin-API-Key: <KEY_ISSUER_API_KEY>' \
  -F 'file=@/absolute/path/pindou-pattern.png'
```

The public metadata, inline image, and download endpoints are respectively
`/image-deliveries/{token}`, `/image-deliveries/{token}/image`, and
`/image-deliveries/{token}/download` under the `/api/v1` prefix.

Manage source prefixes through the ORM-backed CLI:

```bash
.venv/bin/pindou-api key-prefix add wechat --name '微信小程序'
.venv/bin/pindou-api key-prefix disable wechat
.venv/bin/pindou-api key-prefix enable wechat
```

`background_mode` supports `simplify`, `solid`, and `keep`. `solid` defaults to pure white
`#FFFFFF`; callers may submit another `#RRGGBB` value. Automatic color caps are 30 for 52×52 and
54 for 78×78/104×104 grids. Seedream prompts remain independent from those hard caps.

All returned palette codes are guaranteed to belong to the selected MARD color set.
