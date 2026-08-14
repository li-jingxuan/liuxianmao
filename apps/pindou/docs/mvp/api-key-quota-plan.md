# API Key 次数配额与 PostgreSQL 技术方案

> 状态：待实施  
> 目标版本：MVP  
> 方案日期：2026-08-14  
> 影响范围：`apps/api` / 部署配置

## 1. 结论

新增两层密钥：

- **签发管理密钥**：固定值，仅从服务端环境变量 `KEY_ISSUER_API_KEY` 读取；调用签发接口时通过 `X-Admin-API-Key` 传入。它不能调用图片转换接口。
- **消费密钥**：由签发接口按已注册的来源前缀随机生成，调用方通过 `X-API-Key` 传入；每次被 `/api/v1/conversions` 接受处理时扣减一次，剩余次数为 0 后永久失效。

新增接口：

```text
POST /api/v1/access-keys
```

现有接口增加鉴权和扣次：

```text
POST /api/v1/conversions
X-API-Key: pdk_<source>_...
```

来源前缀保存于 `tb_api_key_prefixes` 注册表中；签发接口只接受存在且启用的前缀，因此可以识别密钥来源，并能通过数据库动态增加来源。消费密钥只在创建响应中明文返回一次，数据库仅保存不可逆摘要。数据访问统一使用 SQLModel/SQLAlchemy ORM；次数扣减与 `tb_api_key_usages` 历史追加处于同一事务，保证多个 API 实例和并发请求下不会透支或丢失审计记录。

```mermaid
flowchart LR
    A["调用方"] -->|"X-Admin-API-Key + prefix + allowed_uses"| I["签发 API"]
    I -->|"ORM 校验已启用来源"| S[("前缀注册表")]
    I -->|"生成带来源前缀的随机密钥"| H["HMAC-SHA-256"]
    H -->|"只保存摘要与次数"| P[("PostgreSQL")]
    I -->|"明文只返回一次"| A
    A -->|"X-API-Key + 图片"| C["Conversions API"]
    C -->|"ORM 原子条件更新"| P
    P -->|"成功"| W["图片转换"]
    P -->|"无可用次数"| E["401"]
```

## 2. 目标与非目标

### 2.1 目标

- 只有持有固定管理密钥的调用方才能签发消费密钥。
- 签发时指定系统已登记的来源前缀和正整数可用次数。
- 来源前缀存入独立注册表，可动态新增、停用，并可追溯每把密钥的来源。
- 每个消费密钥全局唯一，次数耗尽后不可恢复、不可再次使用。
- 并发调用时严格扣次，不出现负数或超额成功。
- 服务重启、扩容和多进程部署不影响配额正确性。
- 日志、异常和数据库中不出现完整明文密钥。

### 2.2 非目标

- MVP 不提供密钥列表、充值、撤销、延期或删除接口。
- MVP 不提供公开的前缀管理 HTTP API；前缀通过 Alembic 初始数据或受控管理命令动态维护，后续可复用同一 ORM service 增加管理接口。
- MVP 不提供用户、租户、角色或登录系统。
- MVP 不实现按 IP 限流、计费支付和用量报表。
- MVP 不为转换请求提供幂等重放或失败自动退款。
- 管理密钥不写入数据库，也不允许通过 API 修改。

## 3. HTTP 接口契约

### 3.1 签发消费密钥

```http
POST /api/v1/access-keys
Content-Type: application/json
X-Admin-API-Key: <KEY_ISSUER_API_KEY>

{
  "prefix": "wechat",
  "allowed_uses": 10
}
```

`prefix` 是业务来源代码，必须匹配 `^[a-z][a-z0-9]{0,31}$`，例如 `web`、`wechat`、`partner01`。接口先校验格式，再通过 ORM 查询 `tb_api_key_prefixes`；仅存在且 `is_active=true` 的前缀可以签发。接口不自动转小写，避免调用方输入错误时被静默归到另一来源。

`allowed_uses` 必须是 `1..1_000_000` 的严格整数（Pydantic 使用 `StrictInt`/strict mode，不能把 `true` 或 `1.5` 转成整数）。上限防止误操作；未来有更大套餐时应通过配置调整，而不是去掉边界。

成功响应使用 `201 Created`：

```json
{
  "key": "pdk_wechat_ZXhhbXBsZV9vbmx5",
  "prefix": "wechat",
  "allowed_uses": 10,
  "remaining_uses": 10,
  "created_at": "2026-08-14T10:00:00Z"
}
```

约束：

- `key` 仅在本次响应中出现，服务端之后无法找回；调用方必须自行安全保存。
- `prefix` 是来源标签，不是授权凭据；不能仅凭前缀判断密钥有效性。
- 响应和日志不得记录 `X-Admin-API-Key`、`X-API-Key` 或完整的 `key`。
- 不在响应中返回数据库主键，避免调用方依赖内部实现。

### 3.2 消费转换次数

现有 multipart 请求增加请求头：

```http
POST /api/v1/conversions
X-API-Key: pdk_wechat_<secret>
Content-Type: multipart/form-data
```

响应体保持现有 `ConversionResponse` 不变。成功响应增加两个头，方便可信客户端显示余额：

```text
X-RateLimit-Limit: 10
X-RateLimit-Remaining: 9
```

浏览器需要读取这两个头时，把它们加入 CORS `expose_headers`；不得回传密钥本身。

### 3.3 扣次边界

一次请求按以下顺序处理：

1. FastAPI 完成请求头、表单类型和必填字段解析；失败的 `422` 不扣次。
2. 执行现有网格尺寸、颜色数、颜色组、背景色、文件大小和图片解码校验；这些 `400/413` 不扣次。
3. 使用消费密钥执行一次原子扣减。
4. 扣减成功后再调用 Seedream、量化、备份并组装响应。

第 3 步成功即视为一次已消费调用。此后无论转换成功、客户端断连、上游超时还是服务内部错误，均不自动返还。原因是自动退款与客户端超时重试结合后容易产生重复执行和免费调用；如未来需要“只对成功结果计费”，应引入转换任务和幂等键后单独设计。

并发场景中，例如仅剩 1 次时两个请求同时进入，只有一个请求可以扣减并继续处理，另一个立即得到 `401`。

### 3.4 错误契约

沿用当前 `ApiError` 结构：

| HTTP | code | 场景 |
| --- | --- | --- |
| `401` | `ADMIN_API_KEY_INVALID` | 签发接口缺少或使用错误的管理密钥 |
| `401` | `API_KEY_INVALID_OR_EXHAUSTED` | 转换接口缺少、格式错误、不存在或次数耗尽 |
| `400` | `KEY_PREFIX_INVALID` | 前缀格式合法，但未登记或已停用 |
| `422` | FastAPI 标准校验错误 | 前缀格式错误，或 `allowed_uses` 不是合法整数/超出边界 |
| `503` | `DATABASE_UNAVAILABLE` | 数据库暂时不可用，且尚未确认扣减成功 |

消费接口故意不区分“不存在”和“已耗尽”，避免把接口变成密钥状态探测器。`401` 响应增加：

```text
WWW-Authenticate: ApiKey
```

数据库连接在扣减提交后才断开的极端场景可能出现“调用方收到 503，但次数已扣”的不确定结果；这是同步 API 在没有幂等键时无法完全消除的边界。MVP 按不退款处理，并通过 `request_id` 排障。

## 4. 密钥设计

### 4.1 格式与生成

消费密钥格式：

```text
pdk_<source_prefix>_<base64url(32 random bytes)>
```

- 使用 Python `secrets.token_urlsafe(32)` 生成，不使用 UUID、时间戳或伪随机数。
- `pdk_` 是产品标识，`source_prefix` 来自已启用的数据库注册项；例如 `pdk_wechat_...`。前缀便于归因和日志脱敏，不构成安全边界。
- 来源前缀不允许下划线，因此格式边界明确；消费时不依赖拆分结果查找记录，而是始终对完整密钥计算摘要。
- 数据库唯一约束冲突时重新生成，最多重试 3 次；仍冲突则返回内部错误并告警。

### 4.2 保存与校验

服务端以 `API_KEY_HASH_PEPPER` 为 HMAC 密钥，计算：

```text
HMAC-SHA-256(API_KEY_HASH_PEPPER, plaintext_key)
```

只把 32 字节摘要写入数据库。随机消费密钥本身已有足够熵，HMAC 额外降低数据库泄漏后的离线利用风险。

注意：

- `API_KEY_HASH_PEPPER` 必须是独立、高熵且稳定的服务端 Secret，不能与管理密钥或数据库密码复用。
- 丢失或直接轮换 pepper 会让所有已签发消费密钥失效。需要轮换时应增加 pepper 版本并保留旧版本验证窗口。
- 管理密钥比较使用 `secrets.compare_digest()`，不使用普通字符串比较。

## 5. PostgreSQL 与 ORM 数据模型

所有运行时数据库读写使用 SQLModel 声明模型、关系和约束，并通过 SQLAlchemy Session 执行。业务代码禁止拼接 SQL，也不使用 `text()` 执行原生 SQL。Alembic 迁移可以由 ORM metadata 自动生成后人工审查。

### 5.1 来源前缀表

表名：`tb_api_key_prefixes`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | `uuid` | PK | 内部标识 |
| `code` | `varchar(32)` | UNIQUE, NOT NULL | 来源代码，如 `wechat` |
| `display_name` | `varchar(100)` | NOT NULL | 管理端展示名，如“微信小程序” |
| `is_active` | `boolean` | NOT NULL, default true | 是否允许继续签发 |
| `created_at` | `timestamptz` | NOT NULL | 创建时间 |
| `updated_at` | `timestamptz` | NOT NULL | 最近更新时间 |

`code` 创建后不可修改，否则同一来源会出现两种密钥文本。需要更名时新增 code 并停用旧项；停用只阻止新签发，不会让既有密钥失效。若业务要求立即禁用该来源的所有密钥，应另行加入消费时的 `is_active` 条件并明确影响范围。

### 5.2 消费密钥表

表名：`tb_api_access_keys`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | `uuid` | PK | 服务端内部标识 |
| `key_hash` | `bytea` | UNIQUE, NOT NULL | HMAC-SHA-256 摘要 |
| `prefix_id` | `uuid` | FK, NOT NULL | 关联 `tb_api_key_prefixes.id`，用于来源归因 |
| `key_preview` | `varchar(48)` | NOT NULL | 脱敏预览，如 `pdk_wechat_ZXhh...` |
| `initial_uses` | `integer` | `> 0`, NOT NULL | 签发次数 |
| `remaining_uses` | `integer` | `0..initial_uses`, NOT NULL | 剩余次数 |
| `created_at` | `timestamptz` | NOT NULL | 签发时间，数据库 UTC 时间 |
| `last_used_at` | `timestamptz` | NULL | 最近一次成功扣减时间 |
| `exhausted_at` | `timestamptz` | NULL | 首次减到 0 的时间 |

ORM 模型通过 `Field`、`UniqueConstraint`、`CheckConstraint` 和 `ForeignKey` 声明以下数据库约束：`initial_uses > 0`、`remaining_uses >= 0`、`remaining_uses <= initial_uses`、`key_hash` 唯一，以及 `prefix_id` 外键。删除来源采用 `RESTRICT`，防止历史归因丢失。

不需要为 `remaining_uses` 单独建索引：消费请求始终通过唯一的 `key_hash` 定位一行。

### 5.3 消费历史表

表名：`tb_api_key_usages`

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | `uuid` | PK | 单次消费记录标识 |
| `access_key_id` | `uuid` | FK, NOT NULL | 关联 `tb_api_access_keys.id` |
| `request_id` | `varchar(128)` | NOT NULL | 与请求日志关联的 request ID |
| `operation` | `varchar(32)` | NOT NULL | 当前固定为 `conversion` |
| `remaining_uses_after` | `integer` | `>= 0`, NOT NULL | 本次扣减后的余额 |
| `consumed_at` | `timestamptz` | NOT NULL | 成功扣减时间 |

历史记录只追加、不提供修改或删除业务接口，并在 `(access_key_id, consumed_at)` 上建立联合索引。`request_id` 用于追踪而不是幂等约束：调用方可以重复使用同一个 request ID，每次实际进入处理链路仍独立扣次并生成历史。

## 6. 并发安全扣减

不要采用 ORM “先查询对象、离开事务后修改并保存”的普通读改写；两个并发请求可能读到相同余额。仓储层使用 SQLAlchemy 针对 ORM 模型的类型化 `update(ApiAccessKey)`、列运算表达式、`where()` 和 `returning()` 完成单语句条件更新，不写原生 SQL：

```python
statement = (
    update(ApiAccessKey)
    .where(
        ApiAccessKey.key_hash == key_hash,
        ApiAccessKey.remaining_uses > 0,
    )
    .values(
        remaining_uses=ApiAccessKey.remaining_uses - 1,
        last_used_at=func.now(),
        exhausted_at=case(
            (ApiAccessKey.remaining_uses == 1, func.now()),
            else_=ApiAccessKey.exhausted_at,
        ),
    )
    .returning(ApiAccessKey.initial_uses, ApiAccessKey.remaining_uses)
)
usage = session.exec(statement).one_or_none()
session.commit()
```

这是 ORM 映射模型上的 DML 表达式，由 SQLAlchemy 负责参数绑定和 SQL 生成，不存在手写/拼接 SQL。PostgreSQL 会对命中的行加锁并在锁释放后重新判断余额条件。返回一行后，Repository 使用返回的密钥 ID 和余额创建 `ApiKeyUsage` ORM 对象，再统一提交事务；历史 INSERT 失败会让扣次 UPDATE 一并回滚。返回空值统一映射为 `API_KEY_INVALID_OR_EXHAUSTED`。事务应短小，只包含扣次和历史追加，不能把耗时图片处理或外部 AI 调用放进事务中。

## 7. 后端模块设计

建议新增：

```text
apps/api/src/pindou/
├── api/routes/access_keys.py       # 签发 HTTP 契约
├── db/session.py                   # Engine 与请求级 Session 依赖
├── models/api_key_prefix.py        # 来源前缀 SQLModel table model
├── models/api_access_key.py        # 消费密钥 SQLModel table model
├── repositories/access_keys.py     # ORM 创建、查询与原子扣减
├── repositories/key_prefixes.py    # ORM 前缀注册与状态查询
├── schemas/access_key.py           # 请求/响应 Pydantic 模型
└── services/access_keys.py         # 前缀判定、生成、HMAC、签发、消费
```

实现建议：

- 使用同步 SQLModel/SQLAlchemy ORM Session 和 Psycopg 3，与当前同步转换路由保持一致；不要在 `def` 路由中混入异步数据库客户端，也不要在 repository 之外泄漏 ORM 查询细节。
- `AccessKeyPrefix` 与 `ApiAccessKey` 通过 ORM 外键建立一对多关系；签发服务先按 `code + is_active` 查询来源，再关联创建密钥模型。当前业务不需要反向加载整个密钥集合，因此模型不声明会误触发大集合加载的反向 relationship。
- 前缀动态维护走 `KeyPrefixRepository`/service。MVP 可提供受控 CLI（如 `pindou-api key-prefix add wechat --name 微信小程序`），CLI 与未来管理 API 必须复用同一 service，不能绕过 ORM 直接改表。
- 使用 `Annotated[..., Depends(...)]` 定义 `SessionDep`、`AdminApiKeyDep` 等复用依赖。
- 管理鉴权可作为 `access_keys` router 的共享 dependency；消费扣减不能简单放在 router 共享 dependency 中，因为它必须发生在现有低成本请求校验之后。
- `AccessKeyService.consume()` 返回不可变的 `QuotaUsage(initial, remaining)`，路由用它设置响应头。
- 数据库 Engine 在应用生命周期创建和释放；`/healthz` 保持轻量存活检查，另增 `/readyz`，通过 SQLAlchemy `select(literal(1))` 表达式检查数据库就绪状态，不写原生 SQL。
- 使用 Alembic 管理表结构；应用启动时不调用 `create_all()`，避免多副本启动时争用和生产环境结构漂移。

配置新增：

| 环境变量 | 类型 | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | `SecretStr` | 如 `postgresql+psycopg://pindou:...@localhost:5432/pindou` |
| `KEY_ISSUER_API_KEY` | `SecretStr` | 固定签发管理密钥 |
| `API_KEY_HASH_PEPPER` | `SecretStr` | 消费密钥 HMAC pepper |

三个变量在非测试环境缺失时应启动失败，不允许使用源码默认值。依赖增加 `sqlmodel`、`psycopg[binary]` 和 `alembic`，具体版本在实施时按项目锁文件固定。

## 8. Docker Compose

仓库根目录新增 `docker-compose.yml`，只承载当前新增的 PostgreSQL 基础设施；API 尚无 Dockerfile，继续在宿主机运行。配置包括：

- PostgreSQL 17 Alpine 镜像。
- 数据卷 `pindou_postgres_data`，容器重建后数据仍保留。
- `pg_isready` 健康检查。
- 用户名、库名、端口可覆盖；密码必须显式提供，不在仓库中给默认值。

本地启动示例：

```bash
POSTGRES_PASSWORD='请替换为本地密码' docker compose up -d postgres
docker compose ps
```

API 本地配置示例（只写入不提交的 `apps/api/.env`）：

```dotenv
DATABASE_URL=postgresql+psycopg://pindou:请替换为URL编码后的密码@localhost:5432/pindou
KEY_ISSUER_API_KEY=请使用高熵随机值
API_KEY_HASH_PEPPER=请使用另一份高熵随机值
```

`docker compose down` 只停止容器并保留数据卷；只有明确要清空本地密钥数据时才使用 `docker compose down -v`。

## 9. 实施顺序

1. 增加数据库依赖、Settings 字段、Engine/Session 生命周期和就绪检查。
2. 添加 Alembic 配置、`tb_api_key_prefixes`、`tb_api_access_keys` 与 `tb_api_key_usages` 迁移，并写入至少一个初始来源前缀。
3. 实现 ORM repository、前缀管理 service/CLI、密钥生成、HMAC 和原子消费服务。
4. 添加带 `prefix` 参数的 `/api/v1/access-keys` 路由和管理密钥依赖。
5. 在 `/api/v1/conversions` 完成既有低成本校验后接入消费服务，并设置余额响应头。
6. 更新 CORS 暴露头、`.env.example`、API README 和调用示例。
7. 完成单元、集成与真实 PostgreSQL 并发测试后发布。

迁移发布顺序必须是：先建表并部署数据库兼容代码，再切换客户端携带密钥。接口一旦强制鉴权，未升级的当前 Web 客户端会立刻收到 `401`；如需无中断发布，应增加一个有截止时间的配置开关作为短暂兼容期。

## 10. 测试与验收

### 10.1 单元测试

- 管理密钥缺失/错误时拒绝签发，正确时生成指定次数密钥。
- 前缀格式错误、未登记或已停用时拒绝签发；不同前缀生成的密钥文本和外键归因正确。
- 新增/停用前缀必须通过 ORM service 生效，停用前缀不影响已签发密钥。
- 生成值符合前缀和随机长度要求，数据库没有明文。
- 相同明文和 pepper 得到稳定摘要，不同 pepper 得到不同摘要。
- `allowed_uses` 的 0、负数、布尔值、浮点数和超上限值均被拒绝。
- 日志脱敏器不会输出两类密钥。

### 10.2 API 集成测试

- 签发 2 次的密钥，前两次有效，第三次返回 `401 API_KEY_INVALID_OR_EXHAUSTED`。
- `prefix=wechat` 只在注册表存在且启用时签发，响应密钥以 `pdk_wechat_` 开头。
- 缺少、错误、格式非法和耗尽的密钥均返回同一消费错误。
- 转换成功后的 `X-RateLimit-Remaining` 依次为 1、0。
- 每次成功扣减恰好产生一条消费历史，记录 request ID、操作类型、扣减后余额和时间；无效请求与余额耗尽请求不写历史。
- 框架 `422`、图片校验 `400/413` 不扣次；扣减后的 AI `5xx` 会扣次。
- 密钥 A 的调用不会改变密钥 B 的次数。
- API 响应、请求日志和数据库查询结果中不存在完整明文密钥。

### 10.3 PostgreSQL 并发测试

集成测试必须连接真实 PostgreSQL，不能只用 SQLite 模拟行锁语义：

- 签发 10 次，使用至少 50 个并发请求消费，最终恰好 10 次扣减成功。
- `remaining_uses` 最终为 0，从不出现负数。
- 最终消费历史恰好 10 条，且扣减后余额完整覆盖 9 到 0。
- API 多进程或两个独立应用实例共享数据库时结果相同。

### 10.4 验收标准

- 持有正确管理密钥可签发指定次数的唯一消费密钥。
- 每把密钥均关联有效的来源前缀，可通过 ORM 关系准确统计来源。
- 数据库和日志均无法找回完整消费密钥。
- 单个消费密钥最多让转换处理链路启动 `allowed_uses` 次。
- 次数耗尽后永久返回 `401`，服务重启后仍然如此。
- 仅剩一次时的并发请求不会有两个成功进入图片处理。
- PostgreSQL 容器健康、数据持久化，迁移可在空库重复部署流程中成功执行。

## 11. 风险与后续演进

- **浏览器泄漏风险**：当前 Web 若直接持有消费密钥，XSS 或浏览器扩展可以读取它。面向不可信终端时，应改为服务端会话或同源 BFF，不把长期密钥下发给浏览器。
- **管理接口暴露风险**：管理密钥本质是根权限。生产环境除请求头鉴权外，还应在网关限制来源网络并添加速率限制。
- **重试重复扣次**：MVP 明确一次进入处理链路就计费，消费历史不会把重复 request ID 当成同一次请求。后续可增加独立的 `Idempotency-Key`，并以 `(access_key_id, idempotency_key)` 唯一约束支持安全重试。
- **密钥生命周期**：后续可增加 `expires_at`、`revoked_at`、用途标签和管理端撤销接口，但 ORM 原子更新必须同步增加这些有效性条件。
