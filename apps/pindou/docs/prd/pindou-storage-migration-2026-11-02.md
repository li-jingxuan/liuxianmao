# 拼豆 NAS 目录迁移验收（2026-11-02）

## 最终布局

管理根目录：`/vol2/1000/apps/liuxianmao/apps/pindou/`。

| 用途 | 路径 |
| --- | --- |
| 唯一维护的主配置 | `deploy/.env`（0600） |
| 普通版数据 | `deploy/data/` |
| 飞牛版数据 | `deploy/fnos/data/` |
| 备份与回滚资料 | `deploy/backups/migration-20261102/` |
| 飞牛运行配置 | `/var/apps/pindou/etc/api.env`、`postgres.env`，从主配置生成 |

两套 PostgreSQL 17 保持独立；两套管理密钥、数据库密码、哈希 Pepper 和有效 API 设置分别保留。相同配置使用公共项，差异使用 `FNOS_` 覆盖。没有合并数据库，也没有调用付费转换。飞牛 Socket 和平台应用中心控制保留，无新增宿主机端口。

## 已执行

- 原运行容器的有效 Settings 与凭据在 NAS 本机导入主配置，未输出到聊天或写入仓库。
- API、普通 Web、飞牛 Web 和 proxy 在 NAS 受限 BuildKit 内构建，使用 `migrated-20261102` 标签；基于已提交源码 `21b10d0` 加错误提示与权限修复，未带入工作区其他会话正在开发的 UI 改动。
- 停止写入，分别生成 PostgreSQL 自定义格式逻辑备份、停机数据 tar、配置和安装文件备份；原目标目录中的闲置旧 data 另存，未与运行数据混合。
- 用 rsync 保留所有者、权限、ACL 与扩展属性，逐项校验后重建七个拼豆容器。
- 主配置生成器可独立渲染普通 Compose 与飞牛 env；飞牛 `cmd/configure` 实测能从同一主文件重新生成配置并幂等初始化新数据目录。
- 新建 root 所属 `pindou-managed-builder` 的受限构建器元数据，统一入口通过该构建器运行后续构建；本次临时构建容器已停止并移除。

## 回滚保护与修复

第一次复制因飞牛共享目录在 ACL 复制后呈现根目录 `000` 权限而未通过校验，自动恢复原服务。显式恢复根目录模式后复制校验通过。

第二次切换发现新 API 镜像继承了 NAS 源文件的 `000` 权限，非 root 用户无法读取 Alembic 的 pyproject.toml，自动恢复原服务。Dockerfile 已显式设置 `/app` 代码目录和文件权限；临时无公开端口容器验证迁移初始化与 readiness 成功后重新切换。

最终切换成功；每次失败尝试的数据副本仍在受限备份目录中，不覆盖有效备份。

## 最终验证

- 七个拼豆容器全部 healthy，飞牛应用中心 running；`cmd/main status` 返回 0。
- 两套所有数据库表的行数及内容 SHA-256 与停机前完全一致；两套原数据库连接串、管理密钥、Pepper、方舟密钥均保持原值。
- API 容器不包含另一套部署的 `FNOS_` 凭据，也不再接收 PostgreSQL 管理密码环境变量。
- 普通 Web 返回 200，普通 API `/readyz` 正常。
- 飞牛 Socket 四页面、静态资源、色卡 API、GET/POST 尾斜杠重定向和路径边界检查通过，`nginx -t` 通过。
- 旧测试访问密钥的额度查询、旧 PNG 元数据、预览与下载字节摘要均验证通过。
- MySQL、cli-proxy-api 的容器 ID 与启动时间均未变化。
- 扫描全部（含停止状态）容器，无挂载或 Compose 标签再指向 `/vol2/1000/projects/`。
- 清理旧拼豆 data 后只移除空父目录；最终 `/vol2/1000/projects` 已不存在。旧飞牛平台 data 子目录已在备份后清理，平台 `var` 链接保留。
- 旧 `/vol2/1000/pindou-fnos-debug-20261031/` 资料已移入迁移备份目录，统一在 apps 根目录内管理。
- 新增配置生成与存储 staging 测试共 12 项通过，飞牛包现有离线检查通过。
- 最终同步后显式恢复 NAS 源码中部署脚本、生命周期脚本的执行权限，清理归档夹带的 macOS AppleDouble 元数据；NAS 上 `run.py fnos check` 与 `run.py web config --quiet` 均通过。

后续操作见 [统一目录部署说明](../../deploy/fnos/deployment/统一目录部署.md)。真实主配置、数据、逻辑备份、tar 归档与容器完整元数据均不提交 Git。本次直接更新已安装的 Compose 与数据目录，不宣称应用中心 FPK 版本已经升级。
