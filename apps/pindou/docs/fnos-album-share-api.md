# 飞牛相册上传与七天外链接口

## 应用交付链路

飞牛 NAS 应用中的“上传并生成链接”执行（2026-11-02 修正统一网关会话适配）：

**生成完整 PNG 图纸 → 后端保存到应用交付目录 → 浏览器同源上传到飞牛相册 → 为单张图纸创建 7 天限时外链 → 展示完整链接、复制按钮及到期时间。**

飞牛统一网关会过滤系统登录 Cookie，不能依赖后端获取 `ost`。当前前端使用 `POST /app/pindou/api/v1/image-deliveries?share_mode=browser` 保存图纸并获取配置的 `nas_album_id`，然后直接调用本文的相册接口；系统 Cookie 由浏览器自动携带。旧后端相册适配保留作为兼容模式，不作为当前飞牛页面的上传路径。

普通 Web 部署使用原有交付页。飞牛部署返回相册官方外链，不拼接 NAS 内网地址。七天为 `7 × 24 × 60 × 60 = 604800` 秒，从创建分享时计算，不受普通 Web 的交付时长配置影响。

“上传相册”和“创建外链”是两个业务操作，其中上传相册还必须调用上传目录查询、文件传输和入库通知三个 HTTP 接口。只调用 `/upload` 不代表图片已经进入相册。

本文基于实机相册 `25`（“拼豆”）验证。接口属于飞牛内部接口，升级后需要验证兼容性。

## 一、上传到相册

### 查询本次上传目录

`GET /p/api/v2/photo/upload/path`

请求使用当前用户 NAS 登录 Cookie，并添加 `authx` 签名头。

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "upload": {
      "path": "/vol2/1001/Photos/.@#local",
      "hasAccess": true,
      "quotaCurr": 0,
      "quotaMax": 351781367808
    }
  }
}
```

检查 `hasAccess` 并使用实际返回的路径，不写死用户存储路径。

### 传输图片字节

`POST /upload`，请求体为 `multipart/form-data`，文件字段名为 **`trim-upload-file`**。

| 请求头 | 取值 |
| --- | --- |
| `Trim-Path` | 完整目标路径，按 JavaScript `encodeURI` 编码 |
| `Trim-Overwrite` | `false`，使用唯一文件名 |
| `Trim-Mtim` | 图片修改时间，Unix 秒 |
| `Trim-Flags` | `1` |
| `Trim-Token` | 当前会话上传 token，可为空；当前实机使用 HttpOnly `ost` Cookie |
| `Trim-Sign` | `Base64(HMAC-SHA256(Base64Decode(sessionSecret), encodedPath))` |

成功响应本次为 HTTP 200、空响应体，不应要求它返回 JSON。

### 通知相册入库

`POST /p/api/v1/photo/upload/notice`

```json
{
  "files": [
    {
      "file_create_time": "2026:11:02 02:00:00",
      "original_name": "pindou-pattern.png",
      "file_name": "pindou-<unique-id>.png"
    }
  ],
  "album_id": 25
}
```

`file_name` 必须与上传的目标文件名一致。时间使用 UTC，格式为 `YYYY:MM:DD HH:mm:ss`。`album_id` 为部署配置，由服务器指定。

响应示例（重复图片）：

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "list": [
      {"id": 48820, "repeat": true, "error": "", "errorCode": 0}
    ],
    "successCount": 0,
    "repeatCount": 1,
    "albumId": 25,
    "albumName": "拼豆"
  }
}
```

取得 `data.list[0].id` 作为后续 `photoIds`。`repeat: true` 且返回有效 ID、无错误时属于成功，不能仅凭 `successCount: 0` 判失败。

## 二、创建七天限时外链

`POST /p/api/v1/share_link/new`

```json
{
  "photoIds": [48820],
  "name": "拼豆图纸",
  "validTo": 1794163075
}
```

`validTo = floor(当前 Unix 毫秒 / 1000) + 604800`。请求只有时间戳，没有额外的“开启到期时间”布尔字段。示例时间戳仅用于说明；实际请求在创建时重新计算。

传入唯一一张生成图的 `photoIds`，不要使用整个相册作为分享对象。本流程不设密码，接收方通过链接访问。

成功响应主要字段：

```json
{
  "code": 0,
  "msg": "",
  "data": {
    "id": 5,
    "url": "https://share.fnnas.net/s/<share-id>",
    "validTo": 1794163075,
    "photoCount": 0,
    "albumId": 0
  }
}
```

`data.url` 是向用户展示和复制的链接。创建瞬间的 `photoCount: 0`、`albumId: 0` 本次实机属于正常异步状态，稍后详情可返回 1 张图片。需要等待就绪时可查询：

`GET /p/api/v1/share_link/detail?id=<data.id>`

本次验证过单图预览中的“分享外部链接 → 开启到期时间”，接口与列表选择单张图片分享相同。关闭到期时间的参数形式未验证，本功能始终设置七天有效期。

## 登录与签名

当前飞牛页面的所有相册请求发往 `window.location.origin` 的固定接口路径。网页端读取 `localStorage["fnos-Secret"]` 和可选 `fnos-token` Cookie；手机飞牛 App 则通过原生桥 `getUserMessage` 获取当前用户会话，优先于可能残留的网页会话。secret 仅在页面内生成上传签名，不发送给拼豆后端。可选上传 token 只发送到同源 `/upload`。HttpOnly `ost` 由浏览器自动携带，应用不尝试读取它。应用不保存 NAS 账号密码、Cookie 或 App 返回的会话材料，也不在响应或日志中输出它们。

JSON API 另需 `authx: nonce=...&timestamp=...&sign=...`：

1. GET 参数按键名排序并 URL 编码，空格用 `%20`；POST 使用实际发送的紧凑 JSON。
2. 对上述字符串执行 `decodeURIComponent`，计算 UTF-8 MD5。
3. 使用网页公开签名材料、包含 `/p` 的完整接口路径、六位随机数、毫秒时间戳、参数 MD5、网页固定材料，按原网页格式连接后计算 MD5。
4. 将随机数、时间戳、签名组成 `authx`。`Trim-Sign` 是上传路径的另一套签名，不可互换。

浏览器签名实现在 `apps/web/src/lib/fnos-album.ts` 中维护，并与保留的后端适配器使用相同固定向量验证，不动态依赖带构建哈希的 NAS JS 文件。请求体序列化必须和签名完全一致。

手机适配位于 `apps/web/src/lib/fnos-session.ts`，使用 `window.flutter_inappwebview.callHandler("getUserMessage")`。就绪判断与 `@trimjs/web-app` 0.5.0 一致：Apple 平台允许直接使用已有桥，其他平台等待 `_platformReady` 或 `flutterInAppWebViewPlatformReady` 事件，并记住一次性就绪事件；兼容延迟注入，初始化和调用共用 5 秒上限，纳入原上传流程的 90 秒总时限，支持取消。按照 SDK 的双层 JSON 格式解析 `result`，尝试读取 `secret` 与可选 `token`，也接受已解码对象和 `code: 0, data` 包装。响应格式或凭据无效时不开始相册请求，错误提示不包含桥返回内容。

用户在 Android App 1.37.3 的实机诊断已确认：当前页面桥存在且就绪，原生调用直接返回 `null`，不是字段别名不匹配。`20261103.2` 兼容版在原生直接返回 `null`/`undefined` 时，尝试读取同源可读 Cookie `fnos-Secret` 与可选 `fnos-token`。该来源有 NAS 自带 Docker 前端 `KE()`/`WE()` 的实际代码依据；不推断 Android 必然注入这些 Cookie。有效原生会话始终优先，不混用 Cookie token；原生拒绝、超时、拒绝业务码、格式错误或字符串形式的 `"null"` 不触发此回退。

Cookie 值只解码一次并校验格式，同名多值或无效 token 拒绝，不记录凭据，不回退到手机可能残留的 localStorage。Cookie 的格式有效不等于身份或新鲜度已验证；后续仍由同源 NAS 会话及相册接口检查权限，不能仅凭 Cookie 存在宣称与原生账号一致。`FNS_NATIVE_EMPTY` 单独表示原生空结果且没有可用 Cookie；诊断增加 `build`、`credentialSource` 和 `cookieSession` 固定枚举（`missing`/`invalid`/`blocked`/`available`，最后一种仅指格式可用）。

未找到有文档依据的其他手机凭据接口或调用参数。SDK 初始化中的 `getAppMessage()` 只读取 appApi，不能证明会启用会话方法；`GET /app/token` 成功只返回空响应、不会返回 secret。因此不猜测额外 handler、字段或通过后端服务账号替代当前用户。若新诊断仍为 `FNS_NATIVE_EMPTY` 且 Cookie 缺失，需要确认宿主支持的凭据提供方式，不能称手机故障已解决。

协议证据：[SDK 0.5.0 发布包](https://registry.npmjs.org/@trimjs/web-app/-/web-app-0.5.0.tgz) 确认就绪条件、双层 JSON 解码，其 README 提及手机使用 `getUserMessage`；[NAS 相册上传 worker](http://192.168.2.13:5666/p/assets/CnPv0tpVPBFeCbFD.js) 确认上传需要 `secret` 和可选 `token`。但 SDK 没有声明 `getUserMessage` 的 payload 字段；README 中 `code: 0, data: { secret, token? }` 明确属于 Desktop 的另一接口。此处的手机字段映射是待实机确认的兼容实现，不能据此宣称手机协议已验证。若实际字段不同，需要取得只包含字段名、类型及存在性的诊断信息后调整，不能收集原始会话响应。

没有可用原生桥时提示检查 App 会话；会话字段无法识别时，诊断仅附带有长度和深度限制的字段名及类型，不包含凭据值、用户 ID 或其他字段值，便于手机用户反馈真实格式。NAS 接口明确返回 401 时仍提示重新登录。不使用共享管理员账号替代当前用户。官方 SDK 的 `getSessionCredentials()` 只适用于获授权的 Desktop 官方应用，不能替代手机端 `getUserMessage`，因此此处直接使用原生桥，未新增 SDK 依赖。

后续测试版将完整诊断放在可选择、可复制的独立文本区，包含版本号、平台类别、从 UA 提取的 App 数字版本、是否在同源框架内、桥所在层级、就绪标记、失败阶段和经过裁剪的字段结构。字段名仅显示固定白名单，其他键名统一替换为 `unknown`，防止凭据被当作对象 key 时出现在诊断中。不会包含完整 UA、页面地址、原生错误文本、字段值或原始响应。失败阶段区分 `FNS_NO_BRIDGE`、`FNS_NOT_READY`、`FNS_HANDLER_TIMEOUT`、`FNS_HANDLER_REJECTED`、`FNS_RESPONSE_UNRECOGNIZED`；成功检查为 `FNS_READY`。手动“检查 App 会话”只调用桥或读取当前网页会话，不上传、不创建分享、不调用 AI。

同源 iframe 可以使用直接父页面注入的桥，并监听父页面的一次性就绪事件；此回退是本项目的兼容逻辑，SDK 没有公开保证父页面会提供桥。每个桥只使用其所属页面的就绪标记，优先选择已就绪的桥。跨来源父页面不读取、不调用、不发送会话消息。原生桥调用仍保持当前用户上下文，页面不缓存凭据。

官方[调用方式](https://developer.fnnas.com/api/calling/)要求应用包声明 `micro_app=true` 才能初始化 JS SDK 运行环境，源 manifest 已补充该声明。此声明的安装元数据是否在目标 App 生效，需要结合实际安装升级及新诊断验证，不能假设仅修改 Web 镜像就能让宿主注入桥。

## 临时无 AI 测试入口

手机 App 实测上传成功后，已移除首页的临时测试开关及 Docker 构建参数，首页固定恢复完整转换器。原生桥和 Cookie 会话兼容继续用于正式“上传并生成链接”。相册测试组件及测试用例保留作回归参考，不再作为页面入口，也不会因旧构建参数意外替换正式首页。

## 本项目调用方式与部署

当前飞牛前端调用 `POST /app/pindou/api/v1/image-deliveries?share_mode=browser`，文件字段为 `file`。后端仍校验管理授权和 PNG，保存成功后返回本地图纸信息及 `nas_album_id`，不请求相册、不要求会话 Cookie。浏览器再使用同一 Blob 执行相册流程，成功后在前端合并 `share_url` 和七天 `expires_at`，交给原页面展示：

```json
{
  "token": "<local-delivery-token>",
  "image_url": "/api/v1/image-deliveries/<token>/image",
  "download_url": "/api/v1/image-deliveries/<token>/download",
  "nas_album_id": 31,
  "share_url": "https://share.fnnas.net/s/<share-id>",
  "expires_at": "<与七天外链一致的 UTC 时间>"
}
```

飞牛模式必须收到 `share_url` 才展示成功结果；失败时保留错误提示，允许重试。现有完整 PNG 导出缓存保证保存、上传的是同一份图纸。

未传 `share_mode` 时默认 `server`，保留原有后端适配行为。普通 Web 仍使用本地交付页。NAS 会话材料不再发送给拼豆 API，飞牛模式配置跨域 API 时会在保存前拒绝。切换/重试图纸会取消旧上传并忽略迟到结果。

飞牛包启用 `NAS_ALBUM_ENABLED=true`。应用的 `api.env` 可指定：

```dotenv
NAS_ALBUM_BASE_URL="http://host.docker.internal:5666"
NAS_ALBUM_ID="25"
```

Docker API 服务通过 `host.docker.internal:host-gateway` 访问宿主 NAS，端口应与设备实际 HTTP 端口一致。不要使用容器内的 `127.0.0.1`，也不从客户端传入上游地址。当前用户必须有目标相册的访问权限；多个用户使用时需分别验证相册权限。

也可配置多个指向同一 NAS 的可信来源（最多 4 个），新配置优先于 `NAS_ALBUM_BASE_URL`：

```dotenv
NAS_ALBUM_BASE_URLS='["http://192.168.1.10:5666","https://nas.example.com"]'
```

浏览器上传 POST 自带的 `Origin` 如精确匹配候选来源（协议、主机、有效端口），优先使用该来源。因此通过已配置的内网 IP 访问时优先 IP，通过已配置的网关访问时优先网关。缺少或不匹配的 `Origin` 不会引入新地址，仍按配置顺序尝试。默认端口和主机名大小写规范化后匹配，路径不参与上游配置。

仅在只读上传目录查询发生连接失败或超时时回退到下一候选；后续上传、入库及分享固定使用选中地址，不自动重放写请求。鉴权、业务、HTTP 状态错误、重定向及证书校验错误不会触发回退。所有候选共享原有 90 秒总时限。

上述候选列表仅作用于保留的 `server` 兼容模式。当前飞牛浏览器分享模式直接使用当前页面来源，因此通过内网 IP 访问时自动使用同一 IP，通过外网网关访问时使用同一网关，不需要服务端跨来源转发 NAS Cookie。

外链到期仅使链接失效，不自动删除相册图片。应用本地文件按原有清理策略处理。相册创建成功但响应丢失时，重试可能产生额外分享记录。

## 验证边界

实机已验证原图上传及去重、指定相册、单图限时外链、免登录浏览和下载，下载字节与原图 SHA-256 相同。当前网络访问官方链接会自动内网直连，外网中继和手机宿主会话仍需独立验证。FN Connect 需正常启用，NAS 保持联网。

本次还直接运行了项目新增的 Python 适配器，使用当前登录会话上传一张新的 128×128 测试 PNG：相册返回新图片 ID `48828`，生成七天外链 `https://share.fnnas.net/s/65f4d46ae2724d36bf`，到期时间 `2026-11-08T19:16:28Z`。未登录浏览器确认仅一张图片且缩略图加载成功。这覆盖了新图片上传和入库，不只是原图去重路径。测试通过本机临时桥传递会话，不向磁盘保存凭据；临时桥已退出。

此历史结果仅验证服务端适配器到 NAS 的实际调用。后续实机检查确认官方网关不向应用后端保留 `ost`，现已改为浏览器同源调用。

手机会话适配已通过模拟原生桥的回归：双层 JSON、可选 token、App 优先于旧网页会话、Android 延迟就绪与桥注入、iOS 已有桥、缺失/失败/超时/取消，以及使用原生 secret 计算真实 HMAC、上传入库和创建七天分享。当前未连接真实手机 WebView；实际 App 返回字段、同源 Cookie 和完整上传链路仍需手机验收。模拟测试不代表已在手机上上传成功。
