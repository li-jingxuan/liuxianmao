# 六线猫飞牛 NAS 部署

## 首次安装

1. 用官方 fnpack 1.3.3 打包。在 `192.168.2.13` 的飞牛应用中心手动安装生成的 `deploy/fnos/dist/liuxianmao.fpk`。安装包用于本机调试，飞牛桌面入口会在新标签页打开 `/app/liuxianmao/`。 [fnpack](https://developer.fnnas.com/docs/cli/fnpack) · [飞牛统一网关](https://developer.fnnas.com/docs/core-concepts/gateway-registration)

   ```sh
   sh deploy/fnos/package.sh
   ```

2. 在 NAS 的 `nice007` 账号下创建发布目录 `/home/nice007/.local/share/liuxianmao`，将 `build-release.sh`、`extract-main.py`、`ssh-release.sh`、`deploy.sh`、`compose.yaml`、`compose-legacy.yaml`、`proxy.cjs` 和 `verify.cjs` 复制到该目录。老版本回滚会使用宿主机原有的 `proxy.cjs` 和 `verify.cjs`，升级发布脚本时保留这两份文件。部署账号需能操作 Docker、写入发布目录以及连接 FPK 目录内的 Socket。NAS 需提供 `python3`、`curl`、`flock` 和支持 `up --wait` 的 Docker Compose。
3. 在发布目录写入 `appdest`，内容为本次 FPK 安装的实际 `target` 目录。安装位置随飞牛存储卷变化，可通过安装后创建的链接查询。

   ```sh
   target=$(readlink -f /var/apps/liuxianmao/target) &&
     test -f "$target/ui/config" &&
     printf '%s\n' "$target" > appdest
   ```

4. 为 Woodpecker 生成专用 SSH 密钥。把它的公钥装到 `nice007` 的 `authorized_keys`，在该行公钥前添加 `restrict,command="sh /home/nice007/.local/share/liuxianmao/ssh-release.sh"`。将私钥和已核验的 NAS SSH host key 行分别存入 Woodpecker 项目 Secret `lxm_nas_ssh_key` 和 `lxm_nas_known_hosts`，事件均选择 `manual`。流水线通过公开 Git 地址检出指定提交。
5. 从 Woodpecker 手动部署 `main`。成功后，从飞牛桌面点击「六线猫」，并检查登录状态校验、首页和编辑器刷新。通过 `appdest` 确认 `app.sock` 的实际位置和飞牛网关访问权限。

## 发布和回滚

在 [Woodpecker 仓库页](https://nice007.fnos.net/app/woodpecker/repos/5) 选择 **Run pipeline**，分支选 `main`，然后选择工作流。

- **`build-gateway`** 检查飞牛 Socket 代理并在 NAS 构建网关镜像。
- **`build-liuxianmao`** 运行 lint、类型检查、测试和生产构建，并在 NAS 构建应用镜像。
- **`deploy-all`** 运行以上两项，等待镜像就绪后更新两个容器并验证服务。选择 **All workflows** 也会执行同一套构建和发布。

默认执行所选工作流的构建或发布，也可显式填 `RELEASE_ACTION=deploy`。只需要校验时填写 `RELEASE_ACTION=check`。通过全量工作流回滚时填写 `RELEASE_ACTION=rollback`，会恢复上一健康版本。NAS 按 GitHub `main` 核验源码和发布提交。如果等待期间 `main` 已更新，请从最新 `main` 创建新流水线。

NAS 上的 Docker runner 通过网桥地址 `172.17.0.1` 访问主机。源码检出使用该地址的 `7890` 出口代理，发布使用 SSH，并按 NAS 局域网地址 `192.168.2.13` 核验主机公钥。迁移 runner 时需更新 `.woodpecker/` 中的连接地址。

两张镜像各自以完整 Git SHA 标记，切换记录固定到本机镜像 ID。NAS 发布目录中也可直接执行切换和回滚。

```sh
sh deploy.sh deploy "$WEB_IMAGE_ID" "$GATEWAY_IMAGE_ID" "$COMMIT_SHA"
sh deploy.sh rollback
```

Compose 从独立镜像启动 Next.js 和 Node Socket 代理。代理保留 `/app/liuxianmao` 请求路径，Next.js 监听 Compose 网络内的 `3000`，飞牛通过 `app.sock` 访问。脚本核对两个运行容器的镜像 ID，再从 Socket 检查首页、编辑器、品牌图标和当前和弦目录，并从宿主机验证同一个 Socket。切换版本期间可能短暂中断访问。

`releases` 第一行为当前通过检查的提交、应用镜像 ID 和网关镜像 ID，第二行为上一健康版本。候选版本检查失败时，脚本恢复当前健康版本并仍以失败退出。首发失败时，脚本停止失败容器并保留其日志。`pending` 记录中断或恢复失败的切换，下次调用时先完成恢复。保留当前和上一版本的 `liuxianmao-local:sha-*`、`liuxianmao-gateway-local:sha-*` 标签和镜像，用于恢复或回滚。

FPK 由飞牛应用中心管理。FPK 升级、重装或迁移存储卷后，更新 `appdest` 并重新部署当前镜像，使代理在新的安装目录创建 Socket。
