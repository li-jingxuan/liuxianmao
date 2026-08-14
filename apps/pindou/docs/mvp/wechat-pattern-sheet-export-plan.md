# 微信内置浏览器图纸导出兼容方案

> 状态：待实施  
> 影响范围：`apps/web`、`apps/api`、`deploy`  
> 前置能力：[导出包含原图、色卡和图像信息的拼豆施工图](./fix-export-pattern-sheet-layout.md)  
> 关联计划：[MVP1 Next.js 实施计划](./mvp1-nextjs-plan.md)

## 1. 背景与问题

当前 Web 端在浏览器内生成完整施工图 PNG，随后通过临时 Object URL 和 `<a download>` 触发下载：

```ts
const url = URL.createObjectURL(blob);
const link = document.createElement("a");
link.href = url;
link.download = filename;
link.click();
URL.revokeObjectURL(url);
```

这条链路依赖浏览器同时支持 `blob:` URL 和 `HTMLAnchorElement.download`。微信内置浏览器虽然可以执行 Canvas 绘制和 PNG 编码，但不会稳定执行上述下载动作，部分版本会直接提示用户“请使用浏览器打开”。该提示来自微信 WebView，而不是 Pindou 的错误处理。

单纯延长 `revokeObjectURL` 时间、引入 FileSaver.js 或改用 Base64 都无法消除微信 WebView 的下载限制。MVP 需要为微信提供一条不依赖 `<a download>` 的交付路径。

## 2. 目标

- 微信内点击“导出图纸”后，在当前页面展示可长按保存的高清 PNG。
- 图片使用普通同源 HTTPS URL，不使用 `blob:`、`data:` 或下载响应。
- 普通浏览器继续使用现有本地导出和直接下载，不增加网络传输。
- 临时图纸默认只保留 30 分钟，到期后不可访问并自动清理。
- 不在数据库中持久化图纸，不建设用户文件中心、历史记录或分享系统。
- 不因上传临时图纸再次扣减转换次数。
- 上传大小、图片格式、像素数和存储目录均受服务端约束。

## 3. 非目标

- 不保证微信内能够一键写入系统相册；最终保存动作仍由用户长按图片完成。
- 不接入微信 JS-SDK 的素材、相册或分享接口。
- 不把 Web Share API 作为主路径；它可以在后续作为能力增强。
- 不支持 JPEG、WebP、SVG、PDF 或任意文件托管。
- 不为临时图纸生成永久链接、短链接、二维码或公开分享页。
- 不在服务端重新绘制施工图；施工图仍由浏览器 Canvas 生成。
- MVP 不引入 S3、TOS 等对象存储，也不支持多 API 实例共享临时文件。

## 4. 方案选择

### 4.1 选定方案：短时 HTTPS 图片 + 长按保存

```text
浏览器生成 PNG Blob
        │
        ├─ 普通浏览器 ──> <a download> ──> 本地文件
        │
        └─ 微信 WebView ─> POST 临时 PNG
                              │
                              v
                         API 临时目录
                              │
                              v
                    同源 HTTPS 图片 URL
                              │
                              v
                    页面预览 + 长按保存
```

该方案利用微信已经稳定支持的普通图片浏览和长按菜单，避开受限的文件下载能力。图纸只在微信路径上传；普通浏览器的速度、隐私边界和现有交互保持不变。

MVP 部署目前只有一个 FastAPI 容器，并已为运行时图片挂载持久目录，因此本地文件存储足以验证需求。存储能力通过独立 service 封装，未来改为对象存储时不改变 HTTP 契约和 React 页面。

### 4.2 未选方案

| 方案 | 结论 | 原因 |
| --- | --- | --- |
| 直接 `<a download>` | 保留给普通浏览器 | 微信 WebView 正是对该能力支持不完整 |
| `window.open(blobUrl)` | 不采用 | 仍然依赖 `blob:`，部分微信/iOS 版本无法长按保存或打开空白页 |
| Base64 Data URL | 不采用 | 体积增加约三分之一，长 URL 和大图会显著增加内存压力，兼容性仍不可靠 |
| FileSaver.js | 不采用 | 最终仍依赖浏览器下载能力，不能绕过 WebView 限制 |
| Web Share API + `File` | 后续增强 | 微信环境的文件分享能力不一致，不能作为唯一交付路径 |
| 微信 JS-SDK | 不采用 | 需要公众号配置、签名和域名白名单，且不是保存任意浏览器生成文件的通用能力 |
| 服务端重绘图纸 | 不采用 | 会复制前端 Canvas 排版逻辑，增加字体和渲染一致性成本 |
| 对象存储 | 后续扩展 | 当前单实例 MVP 无需增加外部依赖；多实例部署时再替换临时存储 adapter |

## 5. 前端设计

### 5.1 环境判断

微信 WebView 会暴露 `<a download>` 属性，因此不能只做 DOM 能力检测。将判断封装为纯函数，不把 User-Agent 分支散落在组件中：

```ts
export type ExportDeliveryMode = "download" | "wechat-preview";

export const resolveExportDeliveryMode = (
  userAgent: string,
): ExportDeliveryMode =>
  /MicroMessenger/i.test(userAgent) ? "wechat-preview" : "download";
```

首版只将 `MicroMessenger` 路由到远端预览。QQ、微博等其他 WebView 不提前猜测；若真机验证发现同类问题，再用测试覆盖后加入明确规则。

该函数建议放在 `apps/web/src/lib/export-delivery.ts`。React 组件只消费返回值，不直接解析 `navigator.userAgent`。

### 5.2 导出流程

`exportPatternSheet()` 继续只负责生成 `Blob`，不感知微信、上传或 UI。交付逻辑在新的模块中组合：

```ts
export type TemporaryExport = {
  url: string;
  expiresAt: string;
};

export const uploadTemporaryExport = async (
  blob: Blob,
  filename: string,
  options?: ApiRequestOptions,
): Promise<TemporaryExport> => {
  const form = new FormData();
  form.set("file", blob, filename);
  // POST /api/v1/export-images
};
```

页面点击流程：

1. 同步进入 `isExporting=true`，阻止重复点击。
2. 调用现有 `exportPatternSheet()` 生成 PNG Blob。
3. 普通浏览器调用本地 `downloadBlob(blob, filename)`。
4. 微信调用 `uploadTemporaryExport(blob, filename, { apiKey })`。
5. 上传成功后打开保存预览层，展示接口返回的普通图片 URL。
6. 用户关闭预览层时只清理页面状态；服务端文件按 TTL 清理。

`downloadBlob()` 也应从 React 组件抽成函数。Object URL 至少延迟 60 秒再释放，或在页面卸载时统一释放，避免部分 iOS 浏览器尚未接管下载时 URL 已失效。这个调整只能改善普通浏览器，不作为微信修复依据。

禁止把 Blob 转成 Base64。`FormData` 可以直接上传 Blob，避免额外一次大字符串分配。

### 5.3 保存预览层

微信上传成功后展示全屏或接近全屏的模态层：

```text
┌──────────────────────────────┐
│ 保存图纸                  ×  │
│                              │
│  长按下方图片，选择保存图片  │
│                              │
│  ┌────────────────────────┐  │
│  │                        │  │
│  │      完整施工图        │  │
│  │    可双指缩放查看      │  │
│  │                        │  │
│  └────────────────────────┘  │
│                              │
│  图片将在 30 分钟后失效      │
└──────────────────────────────┘
```

实现约束：

- 使用原生 `<img src={temporaryExport.url}>`，不要通过 Next.js Image Optimization 代理。
- 图片不得放在捕获 `touchstart`、禁止长按或 `pointer-events: none` 的容器中。
- 不设置 `draggable=false`、`user-select: none` 或 `-webkit-touch-callout: none`。
- 预览区域允许纵向滚动，图片按原始比例展示，CSS 宽度不超过容器。
- 文案明确写“长按图片，选择保存图片”，不声称已经自动保存。
- URL 过期或图片加载失败时展示“保存链接已失效，请重新导出”，并提供“重新生成”按钮。
- 模态层需具备 `role="dialog"`、标题关联、关闭按钮和键盘焦点管理；关闭后焦点返回“导出图纸”。

上传过程中按钮文案使用“正在生成保存图片…”。由于前端无法获得原生 `fetch` 上传进度，MVP 不展示伪造百分比。

### 5.4 失败降级

| 失败点 | 用户行为 |
| --- | --- |
| Canvas 编码失败 | 沿用“图纸尺寸过大，请降低网格尺寸后重试” |
| 临时图纸上传失败 | 保留已生成 Blob，显示“保存图片生成失败，请重试” |
| 网络断开 | 允许重试上传，不重复执行 Canvas 绘制 |
| HTTPS 图片加载失败 | 显示重新上传按钮；若 URL 已过期则生成新链接 |
| 普通浏览器下载失败 | 可提供“打开图片预览”作为手动后备入口 |

组件应把“已生成 Blob”和“已上传临时 URL”作为两个独立状态，避免一次网络重试重新消耗大量 CPU 和内存。关闭结果页、重新转换或组件卸载时释放 Blob Object URL。

## 6. API 设计

### 6.1 创建临时图纸

```http
POST /api/v1/export-images
Content-Type: multipart/form-data
X-API-Key: pdk_web_...

file=<PNG blob>
```

成功响应：

```http
HTTP/1.1 201 Created
Content-Type: application/json
Cache-Control: no-store

{
  "url": "/api/v1/export-images/L3y...Q8A",
  "expires_at": "2026-08-14T09:30:00Z"
}
```

约束：

- 只接受单个 `multipart/form-data` 文件字段 `file`。
- 请求必须携带有效的 `X-API-Key`，但只做校验，不扣减转换次数。
- 前端文件名只用于日志中的受控元数据，不参与服务端路径拼接。
- 响应返回相对同源 URL，避免反向代理、内网服务名或错误 Host 泄漏给浏览器。
- 创建响应必须 `Cache-Control: no-store`，避免包含临时 URL 的 JSON 被中间缓存。

错误码：

| HTTP | code | 条件 |
| --- | --- | --- |
| 400 | `EXPORT_IMAGE_INVALID` | 文件为空、不是合法 PNG 或图片尺寸无效 |
| 401 | `API_KEY_INVALID` | API Key 不存在或来源已停用；额度耗尽不影响已有结果导出 |
| 413 | `EXPORT_IMAGE_TOO_LARGE` | 压缩体积或解码像素数超过上限 |
| 507 | `EXPORT_STORAGE_UNAVAILABLE` | 临时目录不可写或磁盘空间不足 |

### 6.2 读取临时图纸

```http
GET /api/v1/export-images/{token}
```

成功响应：

```http
HTTP/1.1 200 OK
Content-Type: image/png
Content-Disposition: inline
Cache-Control: private, max-age=<实际剩余 TTL 秒数>
X-Content-Type-Options: nosniff
```

读取接口不能要求自定义 Header，因为原生 `<img>` 无法附带 `X-API-Key`。访问控制依赖不可猜测 token 和短 TTL：

- token 使用 `secrets.token_urlsafe(32)`，至少 256 bit 随机性。
- 路由只接受固定字符集和固定长度范围，不接受斜杠、点号或 URL 编码路径片段。
- token 不包含原始文件名、API Key、用户标识或时间戳。
- token 不在 info 日志中完整记录，只记录前 6 位或不可逆摘要。
- 文件不存在、token 非法和文件已过期统一返回 `404 EXPORT_IMAGE_NOT_FOUND`，不泄漏状态差异。
- 响应固定声明 `image/png` 和 `inline`，不能反射上传时的 MIME 或文件名。
- `max-age` 必须根据文件实际剩余 TTL 向下取整，不能固定返回完整的 1800 秒。

不提供目录列表、删除接口和续期接口。用户重新导出会创建新的独立 token。

## 7. 临时存储设计

### 7.1 配置

在 `Settings` 中增加：

```py
temporary_export_dir: Path
temporary_export_ttl_seconds: int = Field(default=1800, ge=300, le=86400)
temporary_export_max_bytes: int = Field(
    default=30 * 1024 * 1024,
    ge=1024,
)
temporary_export_max_pixels: int = Field(
    default=50_000_000,
    ge=1_000_000,
)
temporary_export_cleanup_interval_seconds: int = Field(
    default=600,
    ge=60,
)
```

建议生产路径为 `/var/lib/pindou/temporary-exports`，与 AI 图片备份分目录存放。临时导出不纳入备份或快照。

### 7.2 模块边界

建议新增：

```text
apps/api/src/pindou/
├── api/routes/export_images.py
├── schemas/export_image.py
└── services/temporary_exports.py
```

`TemporaryExportStore` 封装 token 生成、原子写入、查找、过期判断和清理：

```py
@dataclass(frozen=True, slots=True)
class StoredExport:
    token: str
    path: Path
    expires_at: datetime


class TemporaryExportStore:
    def create(self, content: BinaryIO) -> StoredExport: ...
    def get(self, token: str) -> StoredExport | None: ...
    def delete_expired(self, now: datetime) -> int: ...
```

路由不直接拼接路径或遍历目录。未来使用对象存储时，只替换此 service/adapter，并让 `StoredExport` 提供外部 URL 或读取句柄。

### 7.3 写入与校验

服务端按以下顺序处理上传：

1. 分块读取到“大小上限 + 1”，超过上限立即返回 413。
2. 检查 PNG signature，并用 Pillow `verify()` 确认真实格式为 PNG。
3. 读取宽高并验证 `width × height <= temporary_export_max_pixels`。
4. 在目标目录创建同文件系统临时文件。
5. 写完并刷新后用 `os.replace()` 原子移动为 `{token}.png`。
6. 以服务端当前 UTC 时间计算 `expires_at`，不信任客户端时间和文件名。

任何异常都必须清理未完成的临时文件。不能将用户上传路径传给 `FileResponse`，也不能允许 SVG、HTML 或浏览器提供的任意 Content-Type。

### 7.4 过期与清理

MVP 使用文件修改时间作为创建时间，TTL 到期后视为不存在：

- `GET` 每次读取前检查过期；过期则删除并返回统一 404。
- 应用 lifespan 启动一个低频后台清理任务，每 10 分钟删除过期 `.png`。
- 应用关闭时取消并等待清理任务，避免 lifespan 泄漏。
- 清理只遍历配置目录下符合 token 文件名规则的普通文件，不跟随符号链接。
- 删除应幂等；读取和清理并发时允许其中一方得到“文件不存在”。
- 启动时立即清理一次，处理容器异常退出后遗留的过期文件。

当前生产命令只有一个 Uvicorn worker，不存在多进程竞争。若未来扩展到多个 API 实例，必须先迁移到共享对象存储或增加独立清理任务；不能继续依赖实例本地 URL 在负载均衡后的可达性。

## 8. API Key 与配额

现有 `AccessKeyService.consume()` 会扣减一次转换额度，不应复用于临时图纸上传。增加只验证、不扣减的方法：

```py
class AccessKeyService:
    def validate(self, plaintext_key: str | None) -> None:
        ...
```

`validate()` 与 `consume()` 复用相同的长度限制、HMAC hash、启用状态和数据库错误映射，但不创建 `ApiKeyUsage`，也不改变 `remaining_uses`。

需要明确一个业务规则：额度已经耗尽的 Key 是否还能上传刚刚生成的图纸。MVP 采用“只要 Key 存在且来源启用即可上传”，不要求 `remaining_uses > 0`，原因是转换已经成功扣次，导出属于该结果的后续交付。为避免方法语义含糊，仓储层应提供 `get_active_by_hash()`，而不是伪造一次 consume 后补偿额度。

临时图纸上传仍应受反向代理请求体限制和按 IP/API Key 的基础速率限制。若当前入口暂未提供限流，至少记录上传次数、总字节数和拒绝次数，作为上线后增加限制的依据。

## 9. 部署设计

`deploy/compose.yaml` 为 API 增加独立目录：

```yaml
services:
  api:
    environment:
      TEMPORARY_EXPORT_DIR: /var/lib/pindou/temporary-exports
      TEMPORARY_EXPORT_TTL_SECONDS: 1800
      TEMPORARY_EXPORT_MAX_BYTES: 31457280
    volumes:
      - ./data/temporary-exports:/var/lib/pindou/temporary-exports
```

部署要求：

- `deploy/data/temporary-exports` 由 API 容器 UID/GID `10001` 可写。
- 该目录加入 `.gitignore`，不进入镜像、Git、数据库备份或 NAS 长期快照。
- 公网入口必须使用 HTTPS；否则微信可能限制图片能力，且临时 token 会明文传输。
- 反向代理需允许至少 30 MiB 请求体，并保持 `/api/v1/export-images/*` 同源转发。
- 反向代理不得把图片响应强制改为 attachment。
- 若设置全局 CSP，至少允许同源 `img-src 'self' blob:`；`blob:` 仍供本地预览使用。

目录挂载主要用于容器重启期间保持短期链接，不代表需要长期持久化。运营清理或磁盘告警时可以直接删除过期文件；删除未过期文件会使对应保存链接提前失效，但不影响转换数据和数据库。

## 10. 安全与隐私

导出的施工图包含用户原图，必须按用户内容处理：

- 页面在上传前或保存预览中提示“为支持微信保存，图纸会临时上传并在 30 分钟后删除”。
- 不记录文件内容、完整 token、原始文件名或可还原的图纸 URL。
- 临时目录使用最小文件权限，API 进程以非 root 用户运行。
- 读取路由不启用 CORS 通配凭证，不返回目录元数据。
- 上传只接受经过验证的 PNG，并固定以 `image/png` 返回，阻止任意文件托管。
- 使用随机 token 防止枚举，但它本质上是短期 bearer URL；获得 URL 的人可在过期前查看图片。
- 过期判断发生在应用层，不能仅依赖后台清理，否则清理间隔内仍可能访问过期文件。
- 图片响应不写永久缓存；TTL 不得超过文件实际剩余寿命。

如果未来需要永久分享、用户历史或多端同步，应单独设计登录、授权、数据库元数据、对象存储生命周期和删除能力，不能直接延长本接口 TTL。

## 11. 可观测性

服务端使用结构化日志记录以下事件：

- `temporary_export_created`：request id、token 摘要、字节数、宽高、过期时间。
- `temporary_export_fetched`：request id、token 摘要、剩余 TTL。
- `temporary_export_rejected`：稳定错误码、字节数或像素数，不记录文件内容。
- `temporary_export_cleanup`：扫描数、删除数、失败数和当前目录总大小。

前端至少区分 Canvas 失败、上传失败和图片加载失败，不能全部映射成“导出失败”。上线后重点观察：

- 微信导出请求成功率。
- 创建成功后图片 GET 成功率。
- 413、507 和过期 404 数量。
- 临时目录文件数、总占用和最老文件年龄。

## 12. 测试方案

### 12.1 Web 单元测试

新增 `apps/web/tests/export-delivery.test.ts`：

- iOS 微信 User-Agent 返回 `wechat-preview`。
- Android 微信 User-Agent 返回 `wechat-preview`。
- iOS Safari、Android Chrome、桌面 Chrome 返回 `download`。
- 大小写变化不影响微信判断。
- `uploadTemporaryExport()` 使用 `FormData` 直接提交 PNG Blob 和文件名。
- API 错误按稳定 code 映射为用户可理解文案。
- 普通浏览器分支不调用上传接口。
- 微信分支不创建或点击带 `download` 的链接。
- 上传重试复用同一个 Blob，不重新执行 `exportPatternSheet()`。

保存预览组件测试：

- 成功时使用接口 URL 渲染原生 `<img>`。
- 展示长按保存和过期时间提示。
- 图片 `error` 时显示重新生成入口。
- 关闭后恢复触发按钮焦点。

### 12.2 API 单元与集成测试

使用 `tmp_path` 注入隔离目录：

- 合法 PNG 创建后返回 201、相对 URL 和 UTC `expires_at`。
- GET 返回完全相同的 PNG 字节、`image/png`、`inline` 和 `nosniff`。
- 上传不会改变 API Key `remaining_uses`，也不创建 usage 记录。
- 无效 Key、停用来源和数据库异常返回稳定错误。
- 空文件、伪造 MIME、非 PNG、损坏 PNG、超字节和超像素均被拒绝。
- 客户端文件名包含 `../`、斜杠或 Unicode 控制字符时不能影响落盘路径。
- token 非法、不存在和过期统一返回 404。
- 过期文件在 GET 和定时清理两条路径都能删除。
- 临时写入失败时没有残留半文件。
- 并发 GET 与清理不会产生 500。
- lifespan 退出后清理任务已经取消。

测试时间通过注入 `Clock` 或显式 `now` 固定，不使用真实 `sleep()` 等待 30 分钟。

### 12.3 真机验收矩阵

自动化浏览器无法代表微信 WebView，发布前必须使用真实 HTTPS 测试环境验收：

| 环境 | 创建图纸 | 展示高清图 | 长按出现保存菜单 | 保存后相册可打开 | 过期后不可访问 |
| --- | --- | --- | --- | --- | --- |
| iOS 当前微信 | 必测 | 必测 | 必测 | 必测 | 必测 |
| Android 当前微信 | 必测 | 必测 | 必测 | 必测 | 必测 |
| iOS Safari | 必测回归 | 不走远端 | 不适用 | 下载文件可打开 | 不适用 |
| Android Chrome | 必测回归 | 不走远端 | 不适用 | 下载文件可打开 | 不适用 |
| 桌面 Chrome/Safari | 必测回归 | 不走远端 | 不适用 | 下载文件可打开 | 不适用 |

至少覆盖 52、104、156 三档网格，以及一张透明背景图片。156 网格用于确认移动端内存、上传体积和服务端像素上限是否合理；若设备 Canvas 本身无法生成，应继续展示已有尺寸错误，而不是误报为微信保存错误。

## 13. 实施步骤

### 阶段一：后端临时图片能力

1. 新增配置、schema、`TemporaryExportStore` 和路由。
2. 为 `AccessKeyService` 增加只验证不扣次的能力。
3. 在 lifespan 中接入启动清理和周期清理。
4. 补齐 API 测试、错误码和部署目录配置。
5. 用 curl 验证“上传 PNG → 普通 URL GET → 到期 404”的完整链路。

### 阶段二：Web 交付策略

1. 提取 `resolveExportDeliveryMode()` 和 `downloadBlob()`。
2. 在 API client 中增加 `uploadTemporaryExport()`。
3. 新增保存预览组件和无障碍交互。
4. 微信分支上传并展示 HTTPS 图片，普通浏览器维持下载。
5. 补齐单元测试和错误提示。

### 阶段三：部署与真机灰度

1. 创建并授权临时目录，配置 HTTPS 和代理请求体上限。
2. 先在测试域名完成 iOS/Android 微信验收。
3. 小流量发布，观察创建、读取、413、507 和目录空间。
4. 通过验收后全量；失败时只回滚 Web 微信分支，普通浏览器导出不受影响。

## 14. 验收标准

- 微信内点击“导出图纸”不再调用 `<a download>`，也不再触发“请使用浏览器打开”。
- iOS 和 Android 当前微信版本均能展示完整施工图，并可通过长按保存到系统相册。
- 保存后的 PNG 尺寸、色号、原图、图像信息与普通浏览器导出完全一致。
- 普通浏览器仍在本地直接下载，不向 `/export-images` 上传。
- 上传接口只接受合法 PNG，超限和伪造文件被稳定拒绝。
- 临时 URL 默认 30 分钟后返回 404，磁盘上的对应文件最终被清理。
- 一次转换加一次微信导出只扣减一次转换额度。
- API 重启、上传失败、过期清理和磁盘异常都有明确行为和测试覆盖。
- 日志中不出现 API Key、完整临时 token、原文件名或图纸内容。

## 15. 后续演进触发条件

满足任一条件时，将 `TemporaryExportStore` 迁移到对象存储：

- API 扩展为两个及以上实例。
- 临时图纸峰值占用超过单机磁盘安全水位。
- 需要跨区域访问、CDN、永久分享或独立生命周期策略。
- NAS 重启或滚动发布期间必须保证临时链接持续可用。

迁移时保持 `POST /api/v1/export-images` 响应结构不变。GET 可以继续由 API 代理，也可以返回受 TTL 限制的对象存储签名 URL；若改为跨域 URL，必须重新验证微信长按保存、缓存策略和 Referer/签名泄漏风险。
