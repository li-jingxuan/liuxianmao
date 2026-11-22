# REQ-078 飞牛 NAS 部署与 Woodpecker CI/CD 技术方案

## 1. 交付目标

将六线猫网站部署到现有飞牛 NAS。用户登录飞牛 Web 桌面后，点击「六线猫」图标，通过同一个飞牛访问地址打开网站。Woodpecker 手动运行 `main` 的校验、部署和回滚。 [飞书需求第 79 行](https://pcnhehlhivqu.feishu.cn/wiki/UEivw1G7Liuaqnk20d1cqCoxnHb?sheet=tcgLfi&range=A79)

## 2. 运行架构

**飞牛桌面「六线猫」 → `/app/liuxianmao/` → 飞牛统一网关 → Unix Socket → Compose 内部的 Next.js 服务。**

### 飞牛入口

- 用 `fnpack` 打包轻量 FPK。`app/ui/config` 注册 `liuxianmao.main`、品牌图标、`gatewayPrefix=/app/liuxianmao` 和 `gatewaySocket=app.sock`，入口打开 `/app/liuxianmao/`。建议使用独立浏览器标签页，复用现有 64px / 256px 品牌图片，为编辑器保留完整窗口宽度。飞牛网关负责 NAS 会话校验。[飞牛应用入口](https://developer.fnnas.com/docs/core-concepts/app-entry) · [飞牛统一网关](https://developer.fnnas.com/docs/core-concepts/gateway-registration)
- Compose 内用轻量 HTTP 代理监听 FPK 安装目录 `${TRIM_APPDEST}` 下的 `app.sock`，将带前缀的请求转发到内部 Next.js HTTP 服务。代理负责创建 Socket，并配置可被飞牛网关访问的权限。应用服务与代理均在 NAS 上运行，应用容器端口留在 Compose 网络内。首次部署先验证目标系统的前缀转发、Socket 权限和容器重启后的重新连接。
- FPK 负责注册和维护飞牛入口。由部署脚本管理唯一的 Compose 项目，发布状态和 Compose 配置保存在 NAS 上独立于 FPK 安装目录的位置。日常网站更新只替换镜像，入口变动时才更新 FPK。首次安装由飞牛应用中心完成，记录安装卷与 Socket 的实际路径。FPK 更新后复核路径及权限。

### 网站镜像

- 以仓库根目录作为 Docker 构建上下文，用锁文件和 `pnpm@9.15.9` 安装依赖，复用网站现有的和弦目录生成与 `next build --webpack` 流程。开启 Next.js `standalone` 输出，把文件追踪根目录指向 monorepo 根，并将 `.next/static` 和 `public` 复制到随站点启动的运行目录。按 NAS 实测架构产出 Linux 镜像，运行用户为非 root。[Next.js standalone](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- NAS 镜像在构建时设置 `basePath=/app/liuxianmao`。页面导航交给 Next.js 路由，浏览器直接读取的 `public` 资源共用同一个前缀配置。重点检查首页图片、品牌图标、和弦目录及试听音频在内的已发布资源，同时验证编辑器、训练模块等页面的直达和刷新。现有和弦目录加载器已支持 `NEXT_PUBLIC_BASE_PATH`，可复用该约定。[Next.js basePath](https://nextjs.org/docs/app/api-reference/config/next-config-js/basePath)
- 谱文件沿用现有导入导出。和弦偏好、训练进度等本地数据仍按浏览器来源存储。第一次换到飞牛访问地址时，原访问地址的浏览器存储不会自动迁移。在同一飞牛地址下更新容器时，按现有行为读取浏览器本地数据。

## 3. Woodpecker 发布流程

1. **接入 GitHub。** 使用现有 Woodpecker 实例中的 `li-jingxuan/liuxianmao` 仓库，项目编号为 `5`。Runner 通过 NAS 的 Docker 网桥接入现有出口代理，从 GitHub 检出流水线指定的提交。 [Woodpecker 仓库](https://nice007.fnos.net/app/woodpecker/repos/5)
2. **手动校验。** `main` 仅接受手动事件。`RELEASE_ACTION=check` 或留空时运行 lint、类型检查、测试和 standalone 生产构建。 [Woodpecker 工作流事件](https://woodpecker-ci.org/docs/usage/workflow-syntax)
3. **手动部署。** `RELEASE_ACTION=deploy` 通过同样的校验后，经受限 SSH 命令把构建所需的 Git 归档交给 NAS。NAS 根据当前 `main` 的 Git tree 校验源码，在本机构建镜像，再串行切换 Compose 服务并检查 Socket、首页、编辑器和静态资源。
4. **回滚。** 发布记录保存当前和上一健康版本的完整 Git SHA 与本机镜像 ID。健康检查失败时自动恢复原版本并报告失败。`RELEASE_ACTION=rollback` 手动恢复上一健康镜像。采用单实例，切换期间可能短暂中断。

## 4. 实施和验收

1. 目标 NAS 为 x86_64，使用 Docker 29.1.2 和 Compose 5.0.0。FPK `0.1.2` 已安装在存储卷 2。应用中心状态为运行中。
2. 登录飞牛 Web 桌面，图标打开指定的首页。直接访问同一网关 URL 时，未登录会被飞牛拦截或引导登录。已登录账号的访问范围符合确认口径，NAS 网络上无法通过独立网站端口绕过网关。
3. 通过网关打开并刷新编辑器和一个训练模块详情页，验证静态资源、谱文件导入、编辑、导出，以及发布版本中已具备的和弦目录和试听功能。
4. 在 Woodpecker 手动运行 `main`，验证部署及回滚。通过流水线和 NAS 发布记录核对 Git SHA 与镜像 ID，确认切换后原地址和桌面图标仍可正常打开。

## 5. 待确认口径

首期在局域网内用已登录的飞牛账号验收，桌面图标在新标签页打开。FN Connect 外网访问待单独确认。
