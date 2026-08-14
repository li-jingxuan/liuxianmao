# Pindou Web

Next.js frontend for the Pindou image converter.

## Run locally

Start the FastAPI service on port 3112, then run:

```bash
cd apps/web
pnpm install
pnpm dev
```

Open `http://127.0.0.1:3111`. Requests under `/api/*` are proxied to `http://127.0.0.1:3112`. To use another backend origin:

```bash
PINDOU_API_ORIGIN=http://127.0.0.1:9000 pnpm dev
```

## Check

```bash
pnpm lint
pnpm test
pnpm build
```
