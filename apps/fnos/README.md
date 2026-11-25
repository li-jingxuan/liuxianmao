# 六线猫飞牛应用

## 打包与安装

在仓库根目录用官方 fnpack 1.3.3 打包。 [fnpack](https://developer.fnnas.com/docs/cli/fnpack)

```sh
sh apps/fnos/package.sh
```

在飞牛应用中心手动安装生成的 `apps/fnos/dist/liuxianmao.fpk`。这个安装包用于本机调试。飞牛桌面的「六线猫」入口会在新标签页打开 `/app/liuxianmao/`。 [飞牛统一网关](https://developer.fnnas.com/docs/core-concepts/gateway-registration)

首次配置 NAS、发布网站和回滚的步骤见 [飞牛 NAS 部署](../../deploy/fnos/README.md)。
