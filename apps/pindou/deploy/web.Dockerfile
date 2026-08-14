ARG NODE_IMAGE=docker.m.daocloud.io/library/node:22-alpine

FROM ${NODE_IMAGE} AS base

WORKDIR /app

ARG NPM_REGISTRY=https://registry.npmmirror.com
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH

# 固定 pnpm 版本，并让 pnpm 自身也从国内镜像安装。
RUN npm install --global pnpm@11.10.0 --registry="${NPM_REGISTRY}" \
    && pnpm config set registry "${NPM_REGISTRY}" \
    && pnpm config set store-dir /pnpm/store \
    && pnpm config set fetch-retries 5 \
    && pnpm config set fetch-retry-mintimeout 20000 \
    && pnpm config set fetch-retry-maxtimeout 120000 \
    && pnpm config set fetch-timeout 600000 \
    && pnpm config set network-concurrency 8

FROM base AS deps

COPY apps/web/package.json apps/web/pnpm-lock.yaml apps/web/pnpm-workspace.yaml ./

# 先下载到可复用的 BuildKit store，再离线链接 node_modules；网络中断后重试
# 构建时无需重新下载已经进入 store 的 Next.js、SWC 和 Sharp 包。
RUN --mount=type=cache,id=pindou-web-pnpm,target=/pnpm/store \
    pnpm fetch --frozen-lockfile
RUN --mount=type=cache,id=pindou-web-pnpm,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile

FROM base AS builder

WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/web ./
ARG NEXT_PUBLIC_API_BASE_URL=https://tppixel-api.cpolar.top
ARG PINDOU_API_ORIGIN=http://127.0.0.1:3112
ENV NEXT_PUBLIC_API_BASE_URL=${NEXT_PUBLIC_API_BASE_URL} \
    PINDOU_API_ORIGIN=${PINDOU_API_ORIGIN}
RUN mkdir -p public && pnpm exec next build --webpack

FROM ${NODE_IMAGE} AS runner

WORKDIR /app
ENV NODE_ENV=production PORT=3111 HOSTNAME=0.0.0.0
RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3111
CMD ["node", "server.js"]
