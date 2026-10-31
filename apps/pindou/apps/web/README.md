# Pindou Web

Next.js frontend for the Pindou image converter.

## Run locally

Start the FastAPI service on port 3112, then run:

```bash
cd apps/web
cp .env.example .env.local
pnpm install
pnpm dev
```

Open `http://127.0.0.1:3111`. 普通用户继续使用原有 `k` 参数；管理员入口为：

```text
http://127.0.0.1:3111/?k=<转换消费Key>&user=<KEY_ISSUER_API_KEY>
```

Web 只要发现非空 `user` 就显示上传按钮，并把它通过 `X-Admin-API-Key` 原样传给
API；最终是否合法只由 API 进程的 `KEY_ISSUER_API_KEY` 判断，Web 不配置该环境变量。
如需切换后端地址，请修改 `.env.local` 中的 `NEXT_PUBLIC_API_BASE_URL`。

## 飞牛官方统一网关

NAS 镜像以 `NEXT_PUBLIC_BASE_PATH=/app/pindou`、空 `NEXT_PUBLIC_API_BASE_URL`
构建，浏览器始终请求同源 `/app/pindou/api/v1/...`，由 Socket 入口代理分流。
这两个公开变量在构建时固定，运行时改容器环境不会改变客户端地址。
生产使用 standalone `server.js`，不要用未设置构建前缀的 `next start` 启动该产物。
交付链接同样包含 `/app/pindou`，接收者仍需登录 NAS。

完整构建、打包及设备验收见 [飞牛包说明](../../deploy/fnos/README.md)。

## Check

```bash
pnpm lint
pnpm test
pnpm build
```
