# 备份 Seedream 与 ONNX 阶段图片技术方案

> 日期：2026-08-28  
> 版本：v1  
> 状态：已被 [v2](./20260828_备份Seedream与最终前景阶段图片_v2.md) 取代，仅保留历史记录  
> 影响范围：`apps/api` 图片增强、前景准备、调试备份与测试

## 1. 背景与目标

当前 AI 转换只保存两张图片：

- `{timestamp}-original.png`：上传图片解码后的 RGBA 原图；
- `{timestamp}-enhanced.png`：`ForegroundPreparer` 的最终输出。Solid 成功时，该图已经应用 ONNX 软蒙版，无法单独查看 Seedream 的原始增强结果。

本次改造目标是在不改变转换结果、HTTP 契约和量化算法的前提下，同时保存 Seedream 增强输出和 ONNX 抠图输出，便于对比定位风格重绘与前景分离问题。

## 2. 文件命名与生成规则

同一次请求的所有备份共用同一个 13 位毫秒时间戳：

| 阶段 | 文件名 | 生成条件 |
| --- | --- | --- |
| 上传原图 | `{timestamp}-original.png` | 使用非 passthrough 增强器时始终生成 |
| Seedream 增强图 | `{timestamp}-seedream-enhanced.png` | Seedream 成功返回图片后生成 |
| ONNX 抠图图 | `{timestamp}-onnx-matted.png` | `solid` 且本地蒙版通过校验并成功写入 Alpha 时生成 |

特殊情况：

- `keep` / `simplify`：不运行 ONNX，只保存 `original` 和 `seedream-enhanced`；
- `solid` 蒙版低置信并显式降级为 `simplify`：只保存 `original` 和 `seedream-enhanced`，不生成虚假的 `onnx-matted`；
- Seedream 请求失败：本次不生成阶段备份，保持当前失败语义；
- passthrough：继续不保存 AI 阶段图片。

新文件不重命名历史的 `*-enhanced.png`，避免破坏现有排查资料。上线后新请求不再产生含义模糊的 `*-enhanced.png`。

## 3. 领域对象与图片所有权

在 `PreparedForeground` 中增加一个仅供调试备份使用的可选 Seedream 中间图引用，例如：

```python
@dataclass(frozen=True, slots=True)
class PreparedForeground:
    image: Image.Image
    enhancer_image: Image.Image | None = None
    # 其他现有字段保持不变
```

所有权规则：

1. `image` 始终是即将进入量化的最终图片。
2. Solid + 蒙版成功时，`enhancer_image` 保留应用蒙版前的 Seedream 输出，`image` 是 ONNX 处理后的新 RGBA 对象。
3. 未运行 ONNX 时，不为了备份额外复制整张图片；`enhancer_image` 可为 `None`，备份层直接使用 `image` 作为 Seedream 输出。
4. 路由层负责关闭所有互不相同的 Pillow 对象；通过对象身份判断避免重复 `close()`。
5. 异常路径仍由 `ForegroundPreparer` 关闭尚未转移给调用方的中间图，避免内存和文件句柄泄漏。

## 4. 备份模块调整

将 `backup_enhanced_images()` 替换为阶段语义明确的备份入口，例如 `backup_ai_processing_images()`：

```python
def backup_ai_processing_images(
    original: Image.Image,
    seedream_enhanced: Image.Image,
    *,
    onnx_matted: Image.Image | None,
    directory: Path,
) -> tuple[Path, ...]:
    ...
```

保留现有并发安全策略：

- 使用 `xb` 防止同毫秒请求互相覆盖；
- 任一文件写入失败时，删除本次已创建的全部文件，不留下不完整图组；
- 冲突时整组递增时间戳后重试；
- 图片仍统一保存为 PNG，以保留 ONNX 产生的 Alpha。

## 5. 路由编排调整

`POST /api/v1/conversions` 在 `ForegroundPreparer.prepare()` 成功后执行：

1. 取得 Seedream 阶段图和最终前景图；
2. 当 `enhancer_name != "passthrough"` 时写入阶段备份；
3. 将最终 `prepared.image` 传入 `build_bead_grid()`；
4. `finally` 中关闭原图、Seedream 中间图和最终图，且同一对象只关闭一次。

备份仍位于量化之前，因此 `onnx-matted` 精确代表量化器实际消费的输入图。

## 6. 测试方案

### 6.1 备份模块单元测试

- 传入原图、Seedream 图和 ONNX 图时，生成同一时间戳的三张 PNG；
- 三张图的尺寸、RGB 和 Alpha 与各自输入一致；
- `onnx_matted=None` 时只生成两张 PNG；
- 验证时间戳冲突时不覆盖旧文件；
- 验证中途写入失败不留下部分图组。

### 6.2 前景准备单元测试

- Solid 蒙版成功时，Seedream 中间图保持不透明，最终图具有 ONNX Alpha；
- `keep` / `simplify` 不额外复制图片；
- 低置信降级时不标记为 ONNX 成功输出；
- 测试显式关闭新增的中间图引用，验证所有权契约。

### 6.3 API 集成测试

- Fake Seedream + Solid + 有效蒙版生成 `original`、`seedream-enhanced`、`onnx-matted` 三张图；
- Fake Seedream + Keep 只生成 `original` 和 `seedream-enhanced`；
- 响应 Schema、统计、MARD 网格与现有行为保持不变。

建议验证命令：

```bash
apps/api/.venv/bin/pytest \
  apps/api/tests/test_image_backup.py \
  apps/api/tests/test_foreground.py \
  apps/api/tests/test_api.py
```

## 7. 兼容性与风险

- 无数据库、HTTP 或前端契约变更。
- Solid AI 请求由每次写入 2 张图增加为 3 张，备份空间约增加 50%；本方案不扩展现有备份保留策略。
- 中间 Seedream 图的生命周期延长到量化完成，单请求峰值内存会增加一张 Seedream 输出图的像素缓冲。已有并发上限仍能限制放大效应。
- 若备份写盘失败，继续沿用当前行为：请求失败，不带着不完整的调试证据继续量化。

## 8. 实施范围

审查通过后预计修改：

- `apps/api/src/pindou/imaging/foreground.py`
- `apps/api/src/pindou/imaging/image_backup.py`
- `apps/api/src/pindou/api/routes/conversions.py`
- `apps/api/tests/test_foreground.py`
- `apps/api/tests/test_image_backup.py`
- `apps/api/tests/test_api.py`

不修改 Seedream Prompt、ONNX 推理算法、MARD 量化算法、前端交互或对外 API 契约。
