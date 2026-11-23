ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}
WORKDIR /deployment
# 把代理和探活脚本一起固定在镜像内，确保发布和回滚使用对应版本。
COPY proxy.cjs verify.cjs ./
ENTRYPOINT ["node", "/deployment/proxy.cjs"]
