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

## Check

```bash
pnpm lint
pnpm test
pnpm build
```
