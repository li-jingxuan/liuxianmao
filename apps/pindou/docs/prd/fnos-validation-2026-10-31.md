# 飞牛 NAS 验证记录（2026-10-31）

目标设备：x86_64，Docker 29.1.2。以下结果区分离线检查、真实容器和应用中心，不将打包成功等同于部署成功。记录不包含连接凭据、业务密钥或配置内容。

## 已完成

- 后端回归：166 passed，1 skipped；跳过项需要独立测试 PostgreSQL 地址。Alembic 特殊字符密码回归通过，修改过的后端文件通过 Ruff。
- 包检查：JSON、Shell/Python 语法、图标尺寸与源文件一致、首次和重复配置、凭据稳定性、恢复保护、Compose env 转义、四服务无宿主机端口、资源上限和生命周期状态检查通过。
- 图标使用 Web assets 中的 64×64、256×256 原图；官方 fnpack 1.2.3 成功生成安装包。
- NAS 上使用独立构建器，限制为 1 CPU、1536 MiB 内存、单任务并行，不切换默认构建器。遇到 Docker Hub/PyPI 超时后使用可访问的镜像源，不改系统配置。
- 新包固定使用 `pindou-fnos` Compose 项目，避免接管已有 `pindou` 服务；采用独立镜像标签和数据目录。
- 真实 API 镜像已构建；一次性配置 helper 在禁用网络及只读根文件系统下成功执行两次，文件未被重复改写，权限为 0600。
- 已检查原有五个容器的 ID、启动时间、状态；检查时没有重启，原有健康检查全部正常。

## 安装器问题与修复

第一次通过 `appcenter-cli install-fpk` 安装时，飞牛返回 10266：日志显示 Docker 项目校验早于 `install_callback`，而 Compose 的两个 `env_file` 尚不存在。安装器随后回滚，应用未登记、未留下 `/var/apps/pindou`，原有容器 ID 和启动时间未变化。

包最初改为在 `install_init` 创建两个空的 0600 占位文件；实机复核发现飞牛随后可能先创建 Compose 容器，空配置会造成启动失败。现已改为 `install_init` 在容器创建前直接调用 API 镜像中的初始化 helper，完整生成两个配置文件；`install_callback` 和升级流程继续幂等复用该 helper。另将 PostgreSQL 健康检查限定为 TCP、增加非空损坏/错误主版本数据目录的恢复保护，并重新打包通过离线检查。

## 已完成的设备验收

- 第二次安装登记成功；首次启动后应用中心状态为 running，四个容器均 healthy，`cmd/main status` 返回 0，proxy 执行 `nginx -t` 成功。
- 通过 NAS Socket 完成 readiness、四个页面、静态资源、色卡 API、尾斜杠重定向和前缀边界检查。
- 通过同一 Socket 完成测试 API Key 签发/配额、PNG 交付上传、元数据、预览与下载；未调用 AI 转换或付费服务。
- 浏览器经官方网关打开 `/app/pindou/` 成功；直接访问未登录路径得到网关拦截响应，登录后页面正常加载。
- 停止应用、备份 `etc`/`var`/manifest 后重新启动成功；配置文件内容、密钥、数据和原有普通 `pindou` 项目容器启动时间均保持不变。后续复核发现 `appcenter-cli install-fpk` 对已安装应用只返回 installed，manifest 仍为 0.1.0，因此该次操作不能作为版本升级成功的证据。

## 独立端口方案已撤回（2026-10-31）

按用户要求撤回新增的 3113 入口；NAS 恢复原 Compose 与 proxy 镜像，源码、检查脚本和部署说明恢复仅使用飞牛统一网关。回滚确认 proxy 无宿主机端口映射、Socket 检查通过，其余八个容器的 ID/启动时间及所有 env 内容均未变化。

## 待完成

- 完整初始化提前至 `install_init` 后的全新安装验收、配置更新重读、真实 FPK 版本升级和备份恢复演练。
- 有费用的转换、上层网关大文件/长请求限额，以及 NAS 重启和卸载流程。

包构建与检查命令见 [部署说明](../../deploy/fnos/README.md)。只读 Socket 验证脚本为 `deploy/fnos/scripts/smoke.py`，不会调用方舟或提交转换。
