# 管理员上传图纸并生成交付链接方案

> 状态：待实施  
> 目标版本：MVP  
> 技术栈：Next.js / React / TypeScript / FastAPI / Pillow  
> 范围：管理员在现有转换结果中上传最终施工图，用户通过公开预览页缩放查看并保存  
> 不包含：新管理员页面、用户工单、订单关联、上传历史、永久分享和对象存储

## 1. 背景与目标

当前用户可以在首页上传图片、生成拼豆网格，并由浏览器使用 Canvas 导出完整施工图 PNG。部分用户对自动结果不满意时，管理员会在闲鱼中与用户沟通、调整参数或重新制作图纸，再把最终图纸交付给用户。

本功能只解决最后一步交付：管理员在现有首页生成满意结果后，点击按钮把当前施工图上传到 API，获得一个可复制的 Web 预览链接，再通过闲鱼发送给用户。用户打开后可以放大、缩小、还原、查看有效期，并按页面步骤保存原始 PNG。

目标流程：

```text
管理员通过带固定管理密钥的专用 URL 打开首页
  → 正常上传原图并生成结果
  → 点击“上传并生成链接”
  → Web 复用现有导出逻辑生成 PNG
  → API 使用现有管理密钥校验并临时保存 PNG
  → Web 展示并复制 /delivery/{token} 交付链接
  → 用户在闲鱼中打开预览页缩放查看
  → 用户按页面提示长按保存或下载原图
```

## 2. 核心决策

### 2.1 不新增管理员页面

首页通过查询参数携带现有固定管理密钥：

```text
/?user=${KEY_ISSUER_API_KEY}&k=<转换消费 Key>
```

`apps/web/src/app/page.tsx` 读取 `user`。只要参数去除首尾空白后非空，就把原始 value 作为 `deliveryAdminKey` 传给 `PindouConverter`；组件通过该属性是否存在决定是否显示“上传并生成链接”。Web 不配置、读取或比较 `KEY_ISSUER_API_KEY`。

`k` 继续作为现有转换接口的消费 Key，`user` 只用于管理员交付能力。上传时 Web 把 `user` 原值放入 `X-Admin-API-Key`，API 复用现有 `AdminApiKeyDep` 再与 API 进程的 `KEY_ISSUER_API_KEY` 比较。前端只做非空展示判断，按钮可见不代表已经通过权限校验。

不新增单独的管理员上传页；管理员仍只使用首页。新增的是面向闲鱼用户的公开预览路由：

```text
/delivery/{token}
```

预览页不包含管理能力，也不接收 `user`、`k` 或任何管理员密钥。

> MVP 风险说明：`KEY_ISSUER_API_KEY` 同时拥有访问密钥签发权限，把它放入查询参数会使其出现在浏览器历史、复制的地址、代理访问日志或 Referer 中。本方案按当前明确需求复用该固定 Key，但部署必须增加第 8 节中的泄漏防护；后续应优先拆分权限更小的交付专用 Key。

### 2.2 不让管理员再次选择文件

按钮直接调用现有 `exportPatternSheet()`，生成与“导出图纸”完全相同的 PNG Blob，然后使用 `multipart/form-data` 上传。这样本地下载版本与交付链接版本不会出现布局、色号或原图信息差异。

“导出图纸”和“上传并生成链接”共享当前结果的 PNG Blob 缓存。图片、裁剪或转换结果变化时必须清空缓存，避免上传上一张图纸。

### 2.3 不使用现有 AI 图片备份目录

`IMAGE_BACKUP_DIR` 保存的是增强前后的内部排查图片，文件没有访问控制、有效期或交付语义，不能直接公开。

交付图片使用独立目录：

```text
/var/lib/pindou/image-deliveries/
```

MVP 使用单机持久卷和随机 token 文件名，不引入数据库。文件修改时间作为创建时间，API 根据固定 TTL 判断过期并定期清理。

### 2.4 复制 Web 预览地址，API 提供元数据、原图和下载

管理员上传成功后，API 返回 token、原图地址、下载地址和过期时间。首页使用当前 Web origin 生成并复制：

```text
https://<Web 公网域名>/delivery/{token}
```

预览页再通过 token 查询 API：

- `metadata_url`：返回图片地址、下载地址和准确过期时间。
- `image_url`：返回 `inline` 原始 PNG，供预览和移动端长按保存。
- `download_url`：返回 `attachment` 原始 PNG，供普通浏览器下载。

管理员不能复制 API 原图地址代替预览页，否则用户看不到缩放控件、有效期和保存步骤。

## 3. Web 设计

### 3.1 首页参数

扩展 `apps/web/src/app/page.tsx`。Web 不需要任何管理员密钥环境变量：

```ts
type HomeProps = {
  searchParams: Promise<{
    k?: string | string[];
    user?: string | string[];
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const apiKey = Array.isArray(params.k) ? params.k[0] : params.k;
  const user = Array.isArray(params.user) ? params.user[0] : params.user;
  // 只判断是否非空，必须把原始 value 交给 API 做最终校验。
  const deliveryAdminKey = user?.trim() ? user : undefined;

  return (
    <PindouConverter
      apiKey={apiKey}
      deliveryAdminKey={deliveryAdminKey}
    />
  );
}
```

组件不解释 `user` 的业务含义。`deliveryAdminKey` 不存在时不显示按钮，存在时作为上传请求的候选管理密钥：

```ts
type PindouConverterProps = {
  apiKey?: string;
  deliveryAdminKey?: string;
};
```

`deliveryAdminKey` 未经 Web 验证，会进入客户端组件并由浏览器发送给 API。API 的 `AdminApiKeyDep` 是唯一权限边界，不能因为前端显示了按钮而跳过后端鉴权。

### 3.2 结果区交互

按钮不放在底部“重试/导出图纸”操作区，而是放在结果卡片标题栏中，并严格位于“转换完成”状态标识左侧：

```text
转换结果                         [上传并生成链接] [✓ 转换完成]

                    ……图纸预览与信息……

                              [重试] [导出图纸]
```

`processing` 状态仍只显示“处理中…”；必须在 `status === "complete" && result` 时同时渲染上传按钮和“转换完成”。建议在标题栏右侧增加一个容器，使按钮与状态标识保持同组布局，移动端允许换行但顺序不能颠倒。

上传状态：

```ts
type DeliveryUploadStatus = "idle" | "exporting" | "uploading" | "complete";
```

建议交互：

1. 点击后立即禁用按钮，文案显示“正在生成图纸…”。
2. 生成 PNG 后切换为“正在上传…”。
3. 上传成功后，根据返回 token 生成完整 Web 预览地址，在标题栏下方或结果内容顶部显示预览地址、有效期和“复制链接”按钮，不挤压右侧状态标识。
4. 默认复制 `https://<当前 Web origin>/delivery/{token}`，成功后短暂显示“已复制”。
5. 上传失败时保留已经生成的 Blob，重试只重新上传，不重复执行 Canvas 导出。
6. 更换图片、重新裁剪、重新转换或点击“重试”时，清空 Blob 和旧交付链接。
7. 缺少 `deliveryAdminKey` 时不显示按钮；即使 UI 判断遗漏，API 也必须返回 401。

建议状态：

```ts
type ImageDelivery = {
  token: string;
  previewUrl: string;
  imageUrl: string;
  downloadUrl: string;
  expiresAt: string;
};

const [exportBlob, setExportBlob] = useState<Blob | null>(null);
const [delivery, setDelivery] = useState<ImageDelivery | null>(null);
const [isUploadingDelivery, setIsUploadingDelivery] = useState(false);
```

### 3.3 API Client

在 `apps/web/src/lib/api.ts` 增加：

```ts
export type ImageDeliveryResponse = {
  token: string;
  image_url: string;
  download_url: string;
  expires_at: string;
};

export const createImageDelivery = async (
  blob: Blob,
  { adminApiKey, signal }: AdminApiRequestOptions,
): Promise<ImageDeliveryResponse> => {
  const form = new FormData();
  form.set("file", blob, "pindou-pattern.png");

  const response = await fetch(`${BASE_URL}/api/v1/image-deliveries`, {
    method: "POST",
    headers: { "X-Admin-API-Key": adminApiKey },
    body: form,
    signal,
  });
  return parseResponse<ImageDeliveryResponse>(response);
};

/** 公开预览页按 token 查询原图地址和有效期，不携带管理员密钥。 */
export const getImageDelivery = async (
  token: string,
  signal?: AbortSignal,
): Promise<ImageDeliveryResponse> => {
  const response = await fetch(
    `${BASE_URL}/api/v1/image-deliveries/${encodeURIComponent(token)}`,
    { cache: "no-store", signal },
  );
  return parseResponse<ImageDeliveryResponse>(response);
};
```

API 图片地址和下载地址使用相对 API 路径，Web 使用现有 `NEXT_PUBLIC_API_BASE_URL` 拼成完整地址。对外分享的预览地址属于 Web 路由，应使用浏览器的 `window.location.origin` 拼成 `/delivery/{token}`，不能错误地拼到 API 域名。

建议新增错误文案：

| code | 页面提示 |
| --- | --- |
| `ADMIN_API_KEY_INVALID` | 当前链接没有图纸上传权限 |
| `DELIVERY_IMAGE_INVALID` | 生成的图纸格式无效，请重新导出 |
| `DELIVERY_IMAGE_TOO_LARGE` | 图纸尺寸过大，请降低网格尺寸后重试 |
| `DELIVERY_STORAGE_UNAVAILABLE` | 图纸存储暂时不可用，请稍后重试 |

### 3.4 用户交付预览页

新增：

```text
apps/web/src/app/delivery/[token]/page.tsx
apps/web/src/components/image-delivery-preview.tsx
apps/web/src/components/image-delivery-preview.module.scss
```

`page.tsx` 只负责读取并传递 token、设置页面标题和禁止 Referer；图片加载、缩放和过期状态放在 Client Component 中。页面不得使用管理员密钥，也不得复用带管理员参数的首页 URL。

页面结构：

```text
┌──────────────────────────────────┐
│ 拼豆图纸                         │
│ 链接有效期至：2026-09-01 18:30   │
├──────────────────────────────────┤
│        [－] [100%] [＋] [还原]   │
│                                  │
│   ┌──────────────────────────┐   │
│   │                          │   │
│   │       高清施工图         │   │
│   │    可缩放并滚动查看      │   │
│   │                          │   │
│   └──────────────────────────┘   │
│                                  │
│          [下载原图]              │
├──────────────────────────────────┤
│ 保存步骤                         │
│ 1. 手机可长按图纸选择保存图片    │
│ 2. 若长按无效，点击“下载原图”    │
│ 3. 闲鱼内无法下载时用浏览器打开  │
│                                  │
│ 注意事项                         │
│ · 请在过期前保存，过期无法访问   │
│ · 预览缩放不改变原图清晰度       │
│ · 制作时请以下载的原图为准       │
└──────────────────────────────────┘
```

#### 缩放行为

- 默认缩放比例为 `100%`，支持范围 `100%–400%`，按钮每次调整 `25%`。
- “还原”恢复 `100%` 并把滚动容器复位到左上或居中初始位置。
- 放大后使用带 `overflow: auto` 的容器滚动查看细节，不把超大图片直接撑破页面。
- 图片宽度按缩放比例变化，保持原始宽高比，不使用 Canvas 二次绘制或有损压缩。
- 保留浏览器原生双指缩放能力，设置 `touch-action: pan-x pan-y pinch-zoom`；MVP 不实现会拦截长按保存的自定义 Pointer 手势。
- 缩小、放大、还原按钮必须有中文 `aria-label`，当前百分比使用 `aria-live="polite"`。
- 禁用达到边界的缩放按钮，防止状态继续越界。

使用原生 `<img>`，不要使用 Next.js Image Optimization。交付图可能非常大，优化代理会增加一次编码、缓存和内存开销，也可能改变原始 PNG。图片不能设置 `pointer-events: none`、`-webkit-touch-callout: none` 或阻止 `contextmenu`，否则移动端无法长按保存。

“下载原图”使用普通 `<a href={downloadUrl}>` 访问 API 的 attachment 路由，不在 Web 中再次 `fetch` 大图并创建 Blob，避免移动端同时持有预览图片和第二份完整 PNG。链接点击后若闲鱼内置浏览器不支持下载，页面提示用户使用长按保存或通过右上角菜单在系统浏览器中打开。

#### 页面状态

```ts
type DeliveryPreviewStatus = "loading" | "ready" | "expired" | "error";
```

- `loading`：显示“正在加载图纸…”，不展示虚假百分比。
- `ready`：展示原图、缩放控件、下载按钮、准确过期时间和操作步骤。
- `expired`：API 返回 `DELIVERY_IMAGE_NOT_FOUND` 时展示“图纸链接已过期或不存在，请联系卖家重新发送”，隐藏缩放和下载按钮。
- `error`：网络异常时展示“加载失败，请检查网络后重试”，保留重试按钮，不误报为过期。
- 图片元素自身触发 `error` 时也进入可重试错误态；重新请求元数据，避免一直展示破图图标。

有效期使用服务端返回的 ISO 8601 时间，按浏览器本地时区格式化，并显示“剩余不足 24 小时，请尽快保存”等临近过期提示。客户端倒计时只能用于展示；是否过期始终以 API 判断为准。

### 3.5 Blob 生命周期

PNG Blob 可在当前转换结果有效期内复用，但不能无限保留：

- `result` 变化时清空缓存。
- 重新选择或裁剪图片时清空缓存。
- 组件卸载时释放为预览创建的 Object URL。
- Blob 本身不需要 `URL.revokeObjectURL()`；只有通过 `URL.createObjectURL()` 创建的 URL 需要释放。

## 4. API 设计

统一前缀为 `/api/v1`。

### 4.1 创建交付图片

```http
POST /api/v1/image-deliveries
Content-Type: multipart/form-data
X-Admin-API-Key: <KEY_ISSUER_API_KEY>

file=<PNG blob>
```

成功响应：

```http
HTTP/1.1 201 Created
Content-Type: application/json
Cache-Control: no-store
```

```json
{
  "token": "r4Nd0mToken",
  "image_url": "/api/v1/image-deliveries/r4Nd0mToken/image",
  "download_url": "/api/v1/image-deliveries/r4Nd0mToken/download",
  "expires_at": "2026-08-31T10:00:00Z"
}
```

约束：

- 只接受字段名为 `file` 的单个 PNG。
- 必须携带与 API 进程 `KEY_ISSUER_API_KEY` 相等的 `X-Admin-API-Key`。
- 复用现有 `AdminApiKeyDep` 和常量时间比较逻辑；上传不访问消费 Key 数据库，也不会扣减转换次数。
- 服务端生成文件 token，忽略客户端文件名，不允许客户端输入参与路径拼接。
- JSON 响应返回 token 和相对 API 路径，防止代理 Host 配置错误或 Host Header 注入产生错误链接。Web 使用 token 生成 `/delivery/{token}` 预览地址。
- 创建响应使用 `Cache-Control: no-store`。

错误响应：

| HTTP | code | 条件 |
| --- | --- | --- |
| 400 | `DELIVERY_IMAGE_INVALID` | 文件为空、不是合法 PNG 或尺寸无效 |
| 401 | `ADMIN_API_KEY_INVALID` | 缺少管理 Key 或与 `KEY_ISSUER_API_KEY` 不一致 |
| 413 | `DELIVERY_IMAGE_TOO_LARGE` | 压缩体积或解码像素数超限 |
| 507 | `DELIVERY_STORAGE_UNAVAILABLE` | 目录不可写或磁盘空间不足 |

### 4.2 查询交付元数据

```http
GET /api/v1/image-deliveries/{token}
```

成功响应：

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store
```

```json
{
  "token": "r4Nd0mToken",
  "image_url": "/api/v1/image-deliveries/r4Nd0mToken/image",
  "download_url": "/api/v1/image-deliveries/r4Nd0mToken/download",
  "expires_at": "2026-08-31T10:00:00Z"
}
```

预览页使用该接口恢复刷新后的交付状态并显示准确有效期。接口不要求 API Key，但必须先执行 token 格式、文件存在性和过期检查。

### 4.3 查看交付原图

```http
GET /api/v1/image-deliveries/{token}/image
```

成功响应：

```http
HTTP/1.1 200 OK
Content-Type: image/png
Content-Disposition: inline; filename="pindou-pattern.png"
Cache-Control: private, max-age=<实际剩余秒数>
X-Content-Type-Options: nosniff
```

该接口不要求 API Key。随机 token 是短期 bearer credential，拿到链接的人可以在过期前查看图片。原图响应不得经过缩放、转码或重新压缩。

### 4.4 下载交付图片

```http
GET /api/v1/image-deliveries/{token}/download
```

响应内容与原图接口完全相同，只把响应头改为：

```http
Content-Disposition: attachment; filename="pindou-pattern.png"
```

### 4.5 404 语义

非法 token、不存在文件和已过期文件统一返回：

```json
{
  "error": {
    "code": "DELIVERY_IMAGE_NOT_FOUND",
    "message": "图纸链接不存在或已过期",
    "request_id": "req_xxx"
  }
}
```

统一语义可以避免向外部调用方泄漏 token 是否曾经存在。

## 5. 管理员 Key 验证

上传路由直接复用现有 `AdminApiKeyDep`。该依赖从 `X-Admin-API-Key` 读取调用方提供的值，并使用 `secrets.compare_digest()` 与 API 进程配置的 `KEY_ISSUER_API_KEY` 做常量时间比较。

```python
@router.post("", status_code=status.HTTP_201_CREATED)
def create_image_delivery(
    file: Annotated[UploadFile, File()],
    _admin_api_key: AdminApiKeyDep,
    settings: SettingsDep,
) -> ImageDeliveryResponse:
    ...
```

本功能不修改 `AccessKeyService`、`AccessKeyRepository` 或消费次数模型。`k` 仅供现有 `/conversions` 使用，上传交付图片只认 `X-Admin-API-Key`。

现有 `require_admin_api_key()` 返回的错误码是 `ADMIN_API_KEY_INVALID`，本功能直接沿用该错误码，避免为同一认证失败维护两套不一致逻辑。Web 只把它映射成“当前链接没有图纸上传权限”，不向页面区分缺失和不匹配。

## 6. 临时存储设计

### 6.1 配置

在 `Settings` 中增加：

```python
image_delivery_dir: Path
image_delivery_ttl_seconds: int = Field(default=7 * 24 * 60 * 60, ge=3600, le=30 * 24 * 60 * 60)
image_delivery_max_bytes: int = Field(default=30 * 1024 * 1024, ge=1024)
image_delivery_max_pixels: int = Field(default=50_000_000, ge=1_000_000)
image_delivery_cleanup_interval_seconds: int = Field(default=3600, ge=60)
```

对应环境变量：

```text
IMAGE_DELIVERY_DIR=/var/lib/pindou/image-deliveries
IMAGE_DELIVERY_TTL_SECONDS=604800
IMAGE_DELIVERY_MAX_BYTES=31457280
IMAGE_DELIVERY_MAX_PIXELS=50000000
```

当前完整施工图使用每格 36 px；最大 156 网格的主体区域约为 `5616 × 5616`，加上底部信息区后仍应纳入像素上限测试。若实际最大导出超过 5000 万像素，应以测试样例为依据上调配置，不能在路由中硬编码绕过校验。

### 6.2 存储模块

建议新增：

```text
apps/api/src/pindou/
├── api/routes/image_deliveries.py
├── schemas/image_delivery.py
└── services/image_deliveries.py
```

服务边界：

```python
@dataclass(frozen=True, slots=True)
class StoredImageDelivery:
    token: str
    path: Path
    expires_at: datetime


class ImageDeliveryStore:
    def create(self, content: bytes) -> StoredImageDelivery: ...
    def get(self, token: str) -> StoredImageDelivery | None: ...
    def delete_expired(self, now: datetime) -> int: ...
```

路由不直接拼接文件路径，未来迁移 OSS、S3 或 MinIO 时只替换 Store 实现。

### 6.3 文件写入

1. 读取“大小上限 + 1”字节，超限立即返回 413。
2. 检查 PNG signature，并使用 Pillow `verify()` 验证真实格式。
3. 校验宽高、总像素数和零尺寸异常。
4. 使用 `secrets.token_urlsafe(32)` 生成至少 256 bit 随机 token。
5. 在目标目录内写入同文件系统临时文件。
6. 写入成功后使用 `os.replace()` 原子移动为 `{token}.png`。
7. 用服务端 UTC 时间和固定 TTL 计算 `expires_at`。
8. 任意异常必须删除未完成的临时文件。

token 路由只接受固定 URL-safe 字符集和合理长度，不接受斜杠、点号或编码后的路径片段。Store 只处理符合 `{token}.png` 规则的普通文件，不跟随符号链接。

### 6.4 过期清理

- 每次 GET 在返回文件前检查过期时间；已过期则尝试删除并返回统一 404。
- 应用启动时立即清理一次历史过期文件。
- lifespan 中启动低频清理任务，默认每小时执行一次。
- 应用关闭时取消并等待清理任务。
- 删除操作必须幂等，允许 GET 与清理并发时其中一方发现文件已不存在。
- 日志只记录 token 摘要，例如前 6 位或 SHA-256 截断值，不记录完整公开链接。

## 7. 部署变更

`deploy/api.Dockerfile` 创建并授权目录：

```dockerfile
RUN mkdir -p /var/lib/pindou/images /var/lib/pindou/image-deliveries \
    && chown -R pindou:pindou /app /var/lib/pindou
```

`deploy/compose.yaml` 增加：

```yaml
services:
  api:
    environment:
      IMAGE_DELIVERY_DIR: /var/lib/pindou/image-deliveries
      IMAGE_DELIVERY_TTL_SECONDS: 604800
      IMAGE_DELIVERY_MAX_BYTES: 31457280
      IMAGE_DELIVERY_MAX_PIXELS: 50000000
    volumes:
      - ./data/image-deliveries:/var/lib/pindou/image-deliveries

```

`KEY_ISSUER_API_KEY` 只配置在 API 服务。Web 服务不声明该变量，也不增加任何 `NEXT_PUBLIC_` 管理密钥。

部署要求：

- 宿主机目录必须允许容器用户 `10001:10001` 写入。
- 目录不进入 Git、PostgreSQL 备份或长期图片备份。
- 公网 API 必须使用 HTTPS，否则闲鱼内置浏览器中的链接和 token 会以明文传输。
- 反向代理请求体上限至少为 30 MiB。
- 代理不得把 `inline` 图片响应统一重写成 `attachment`。
- 单机存储只适用于当前单 API 实例；多实例前必须迁移到共享对象存储。

## 8. 安全与隐私

- `page.tsx` 只根据 `user` 非空显示按钮，不执行密钥判断。
- Web 把 `user` 原值通过 `X-Admin-API-Key` 发送，不能误用现有转换请求的 `X-API-Key`；API 再与自身的 `KEY_ISSUER_API_KEY` 比较。
- 上传只接受经过真实解码验证的 PNG，固定以 `image/png` 返回，避免接口变成任意文件托管服务。
- 客户端文件名、MIME 和 URL 参数都不参与服务端路径生成。
- 公开链接默认 7 天过期；获得链接的人在有效期内可以访问，管理员发送前应确认闲鱼会话对象正确。
- 管理密钥位于查询参数 `user`，会进入浏览器历史、复制的地址、代理日志和 Referer；Web/API/反向代理必须关闭或脱敏查询字符串日志。
- 首页响应增加 `Referrer-Policy: no-referrer`，避免管理员从该页面跳转到第三方资源时通过 Referer 泄漏完整 URL。
- 管理员不得把带 `user` 和 `k` 的首页地址发给用户；只发送 Web 生成的 `/delivery/{token}` 预览地址。
- 发现密钥可能泄漏时必须立即轮换 API 的 `KEY_ISSUER_API_KEY`；Web 无需同步环境变量，只需管理员改用新的 `user` 参数值。
- 由于该密钥同时拥有签发消费 Key 的能力，本方案只接受为 MVP 运维便利性折中；后续应拆分 `IMAGE_DELIVERY_ADMIN_KEY`，降低单个链接泄漏的影响范围。
- 日志中不得出现 API Key、完整 token、原始图纸内容或可直接访问的完整 URL。
- 图片响应设置 `X-Content-Type-Options: nosniff`，缓存时间不能超过实际剩余 TTL。

## 9. 测试方案

### 9.1 Web 测试

扩展现有组件和 API 测试：

- `user` 非空时把原始 value 作为 `deliveryAdminKey` 传给 `PindouConverter`。
- `user` 缺失、空字符串或只有空白时不传候选密钥，也不显示上传按钮。
- 错误的非空 `user` 仍会显示按钮，但上传接口返回 `ADMIN_API_KEY_INVALID`。
- 普通首页不显示“上传并生成链接”。
- 管理员模式只在转换完成后显示按钮，且按钮位于“转换完成”左侧。
- 点击上传使用当前 `result`、`file` 和 `details` 调用 `exportPatternSheet()`。
- `createImageDelivery()` 使用 `FormData` 上传 PNG Blob，并携带 `X-Admin-API-Key`。
- 上传成功后展示完整 Web 预览链接和有效期。
- 复制按钮默认复制当前 Web origin 下的 `/delivery/{token}`，不复制 API 原图地址。
- 上传失败后重试复用已经生成的 Blob。
- 更换图片或重新转换后旧 Blob 和旧链接被清空。
- 普通“导出图纸”行为保持不变。
- 公开预览路由不接收或渲染管理员 Key。
- 预览页加载元数据后展示服务端过期时间、原图和下载按钮。
- 放大、缩小和还原分别正确限制在 `100%–400%`。
- 放大后容器可以横向和纵向滚动，图片保持原始宽高比。
- 图片不经过 Next.js Image Optimization，且没有阻止长按或右键保存的样式和事件。
- API 404 展示过期页，网络错误展示可重试错误页，两者不能混淆。
- 底部完整展示手机保存步骤、浏览器降级步骤和三条注意事项。

### 9.2 API 测试

使用 `tmp_path` 注入隔离目录，并固定测试时钟：

- 与 `KEY_ISSUER_API_KEY` 相等的管理 Key 上传合法 PNG，返回 201、token、原图路径、下载路径和过期时间。
- 上传不调用消费 Key 服务，不会扣减次数或创建 usage 记录。
- 缺少、为空或不匹配的 `X-Admin-API-Key` 均返回 401。
- 空文件、伪造 MIME、非 PNG、损坏 PNG、超字节和超像素均被拒绝。
- 恶意文件名不能影响落盘路径。
- 元数据接口返回 `no-store`、准确过期时间和两个相对 API 路径。
- 原图接口返回相同 PNG 字节、`inline`、`nosniff` 和正确剩余缓存时间。
- 下载接口返回相同 PNG 字节和 `attachment`。
- token 非法、不存在和过期统一返回 404。
- 已过期文件在 GET 和定时清理两条路径都能删除。
- 临时写入失败不残留半文件。
- 并发读取与清理不会返回未处理的 500。
- lifespan 退出后清理任务已取消。

### 9.3 手工验收

- 使用管理员 URL 生成 52、104、156 三档图纸并上传。
- 对比本地“导出图纸”和交付链接图片，像素尺寸及内容完全一致。
- 在闲鱼 iOS、闲鱼 Android、微信和桌面浏览器分别打开 `/delivery/{token}`。
- 验证按钮缩放、浏览器双指缩放、放大后滚动和还原行为。
- 验证移动端可以查看并长按保存，普通浏览器可以通过“下载原图”下载。
- 把系统时间推进到 TTL 之后，预览页、原图地址和下载地址都显示或返回统一过期语义。
- 使用错误的 `user` 参数确认按钮不显示；绕过 UI 直接请求上传接口仍返回 401。
- 确认页面响应包含 `Referrer-Policy: no-referrer`，访问日志不记录完整 `user` 查询参数。

## 10. 实施顺序

1. 新增配置、`ImageDeliveryStore`、Pydantic schema 和四个 API 路由，上传路由复用 `AdminApiKeyDep`。
2. 在应用 lifespan 接入启动清理、周期清理和关闭取消。
3. 更新 Dockerfile、Compose、部署说明与 API 测试，并确认管理密钥只存在于 API 环境。
4. 扩展首页参数和 `PindouConverter` 属性，Web 仅判断 `user` 非空并原样传值。
5. 在 Web API Client 增加 `X-Admin-API-Key` 上传方法、公开元数据查询和完整预览 URL 拼接。
6. 在“转换完成”左侧增加上传按钮，在结果顶部增加链接展示和复制交互。
7. 新增 `/delivery/[token]` 预览页、缩放控件、下载入口、有效期和操作说明。
8. 增加 `Referrer-Policy` 和查询参数日志脱敏配置。
9. 补齐 Web 测试并完成闲鱼真机验收。

## 11. 验收标准

- 普通用户首页和现有转换、导出流程不受影响。
- `user` 非空时，生成结果标题栏在“转换完成”左侧显示“上传并生成链接”。
- 点击一次即可上传当前完整施工图，不弹出文件选择器。
- 上传后的图片与本地导出的 PNG 完全一致。
- API 使用同一 `KEY_ISSUER_API_KEY` 校验 `X-Admin-API-Key`，错误密钥无法上传。
- 页面可以一键复制完整 HTTPS `/delivery/{token}` 预览链接并发送到闲鱼。
- 用户打开预览链接可以在 `100%–400%` 范围缩放、还原并滚动查看图纸细节。
- 预览页底部明确展示准确过期时间、手机保存步骤、下载降级方式和注意事项。
- 用户可以长按保存原图，或在支持的浏览器中通过“下载原图”下载完全相同的 PNG。
- 链接默认 7 天后不可访问，磁盘文件最终被自动清理。
- 非 PNG、损坏图片、超限文件和路径攻击均被拒绝。
- 日志和 Referer 不包含完整管理 Key、完整 token 或图纸内容。

## 12. 后续演进触发条件

满足以下任一条件时，再引入数据库或对象存储：

- API 扩展为两个及以上实例。
- 需要查看上传历史、手动作废链接或重新发送旧链接。
- 需要把交付与闲鱼订单、客户或管理员关联。
- 需要链接长期有效或跨区域访问。
- 单机交付目录达到磁盘安全水位。

迁移时保持四个 HTTP 接口和响应结构不变，Web 无需感知底层从本地文件切换到对象存储。
