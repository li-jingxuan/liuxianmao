# React 19 会话与本地保存示例

将整个 `examples/react/` 复制到一个新目录，在包含本文件和 `package.json` 的目录运行下列命令。需要 Node.js 22.12 或更新版本及 npm。

## 安装

**从候选包安装**。将同版本的 Core 和 React tarball 放到示例目录，执行一次安装。

```sh
npm install ./liuxianmao-lxm-editor-1.0.0.tgz ./liuxianmao-lxm-editor-react-1.0.0.tgz
```

**从验收 registry 安装**。验收方提供了包含两个 `1.0.0` 候选包且能解析公共依赖的 registry 时，将其地址赋给 `LXM_CANDIDATE_REGISTRY`，然后执行。

```sh
npm install --registry="$LXM_CANDIDATE_REGISTRY"
```

**从公共 npm 安装**。两个 `1.0.0` 包正式发布后，在一份新的示例目录执行。

```sh
npm install --registry=https://registry.npmjs.org
```

## 开发和构建

安装完成后，启动开发服务并打开终端显示的地址。

```sh
npm run dev
```

在另一个终端执行构建。`build` 先检查 TypeScript，再生成 `dist/`。构建完成后可启动预览服务。

```sh
npm run build
npm run preview
```

开发服务与预览服务通常使用不同端口，浏览器本地存储按来源区分。

## 验证保存和重新载入

1. 在空白的工作区 A 点击「新建曲谱」，填写曲名并选择「创建曲谱」。宿主显示 4 小节。
2. 点击 A 的「追加一小节」并确认显示 5 小节。点击「保存本地快照」，再追加一次使其显示 6 小节。
3. 点击 A 的「尝试无效输入」，确认显示校验错误且仍有 6 小节。此时也可使用工作区内的「编辑 → 撤销」验证历史仍然可用。
4. 点击 A 的「重新载入快照」，确认恢复为保存时的 5 小节。刷新同一浏览器地址后仍应显示 5 小节。编辑器可能弹出浏览器离开确认，确认后会从本地恢复。
5. 在 B 新建不同曲名并保存，确认 A 的曲名和小节数保持原状。A 和 B 分别拥有自己的快照、会话、选区和历史。

宿主演示用 `localStorage` 保存已提交文档。重载会替换当前文档并重置会话历史，使用前先保存需要保留的编辑。宿主本地快照与编辑器内置的 `.lxm` 下载状态各自管理。组件卸载时释放宿主订阅，已保存的快照留在浏览器，供下一次恢复。
