ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /workspace
ENV NEXT_TELEMETRY_DISABLED=1
ARG NPM_CONFIG_REGISTRY=https://registry.npmjs.org
RUN npm install --global pnpm@9.15.9
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/website/package.json apps/website/package.json
COPY packages/eslint-config/package.json packages/eslint-config/package.json
COPY packages/lxm-editor/package.json packages/lxm-editor/package.json
COPY packages/lxm-editor-react/package.json packages/lxm-editor-react/package.json
COPY packages/tsconfig/package.json packages/tsconfig/package.json
RUN pnpm install --frozen-lockfile
COPY apps/website apps/website
COPY packages packages
ENV NEXT_PUBLIC_BASE_PATH=/app/liuxianmao
RUN pnpm --filter @liuxianmao/website... build

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /workspace/apps/website/.next/standalone/ ./
COPY --from=build --chown=node:node /workspace/apps/website/.next/static/ ./apps/website/.next/static/
COPY --from=build --chown=node:node /workspace/apps/website/public/ ./apps/website/public/
USER node
CMD ["node", "apps/website/server.js"]
