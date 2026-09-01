# @file-viewer/renderer-text

Flyfish File Viewer 的基础代码、文本和 Markdown renderer 包。Mermaid、patch 左右比对和 Git bundle 检查已拆到 `@file-viewer/capability-mermaid` 与 `@file-viewer/capability-text-tools`，不进入 standard/full 默认闭包。

## 用法

```ts
import FileViewer from '@file-viewer/vue3'
import { textRenderer } from '@file-viewer/renderer-text'

const options = {
  builtinRenderers: 'none',
  renderers: textRenderer,
  text: {
    lineNumbers: true,
    wrapLongLines: true,
    wrapLongLinesToggle: true,
    prettyPrint: true,
    prettyPrintMaxBytes: 512 * 1024,
    prettyPrintOptions: {
      tabWidth: 2,
      useTabs: false,
      printWidth: 100,
      proseWrap: 'preserve',
      byExtension: {
        json: {
          printWidth: 120,
        },
        md: {
          printWidth: 80,
          proseWrap: 'always',
        },
      },
      byMimeType: {
        'application/ld+json': {
          tabWidth: 4,
          printWidth: 120,
        },
      },
    },
  },
}
```

`wrapLongLines` 与 `prettyPrint` 相互独立，默认均为 `false`。`printWidth` 只是 Prettier 的格式化提示，不会启用视觉换行。运行时换行按钮只修改 renderer 布局并复用已经格式化、高亮的表示，不会再次调用 Prettier。

未设置 `prettyPrintMaxBytes` 时，它使用实际的 `virtualizeAboveBytes`；两者都未设置时默认为 512 KiB。

`prettyPrintOptions` 支持 `tabWidth`、`useTabs`、`printWidth` 和 `proseWrap`，合并优先级如下：

```text
Prettier 默认值 < 全局值 < 扩展名规则 < MIME 规则
```

扩展名键可写成 `json`、`.json` 或 `*.json`。MIME 匹配不区分大小写，并忽略 `charset` 等参数。以 `+json`、`+xml` 结尾的结构化 MIME 会使用对应 parser。无效配置会被忽略：`tabWidth` 接受 1 到 16 的整数，`printWidth` 接受 1 到 1000 的整数，`proseWrap` 接受 `preserve`、`always` 或 `never`。

`proseWrap` 主要影响 Markdown 等 prose 格式。默认保持 Prettier 较保守的 `preserve` 行为。只有在格式化表示应当按照 `printWidth` 写入真实换行时才使用 `always`；`wrapLongLines` 仍会独立处理 viewport 中剩余的超宽内容，而且不修改文本。

也可以与其他 renderer 组合：

```ts
import { textRenderer } from '@file-viewer/renderer-text'
import { pdfRenderer } from '@file-viewer/renderer-pdf'

const options = {
  builtinRenderers: 'none',
  renderers: [pdfRenderer, textRenderer],
}
```

## 能力边界

- 代码和文本使用 `highlight.js` core + 按语言动态加载，避免一次性注册全部语言。
- `options.text.wrapLongLines: true` 只做视觉换行，不向源码插入换行符；普通视图和超大文本虚拟视图都按逻辑源码行保留唯一行号。
- `options.text.wrapLongLinesToggle: true` 增加 renderer 内部控制。普通预览原地切换布局；虚拟源码预览在有界定高与可变高度 renderer 之间切换。两条路径都不改变原始字节。
- `options.text.prettyPrint: true` 使用随包自托管的 Prettier standalone runtime 格式化显示副本。JSON、JSONC、JSON5、JavaScript、TypeScript、HTML、Vue、CSS、Markdown、YAML、GraphQL、Handlebars，以及保守处理的 XML 家族源码共用同一条可选路径。
- `options.text.prettyPrintOptions` 可全局或按扩展名/MIME 配置缩进、格式化目标宽度和 Markdown prose 换行；它与 `wrapLongLines` 完全独立。
- renderer 会先检查 `prettyPrintMaxBytes` 和 parser 支持，再加载 Prettier。格式不支持、内容损坏、空白敏感或超过阈值时，无错误地回退到原始显示。
- 工具栏中的 `Formatted` / `Source` 控件可在格式化表示与解码后的原始源码之间切换；下载等源码操作始终使用未修改的原始 `ArrayBuffer`。
- HTML / XML / Vue 等文件始终按转义后的源码展示，不会作为可执行 DOM 插入；格式化完全自托管，也不会加载外部资源。
- 代码、文本和超大 Markdown 源码视图默认显示文件类型、索引状态和行数元信息栏；传入 `options.text.toolbar: false` 可隐藏该 renderer 内部栏，不影响 Viewer 的下载、搜索、缩放等全局工具栏。
- 普通代码和文本可通过 `options.text.lineNumbers: true` 显示行号；行号不会进入复制内容、搜索结果或无障碍朗读。超大文本保留原有的虚拟行号栏，可显式传 `false` 隐藏。
- 安装 text-tools capability 后，`patch` 使用 `diff2html` 渲染左右比对视图，`bundle` / `bdl` 才启用 Git bundle 结构检查。
- 安装 Mermaid capability 后，Markdown 内嵌 Mermaid 图才会渲染；未安装时保留源码并显示精确 CLI 启用命令。
- Markdown 使用 `marked` 输出只读阅读面，并保留明暗主题、表格滚动和统一缩放 provider。
- Markdown 不再因为通用大文本阈值自动退化成源码；如业务必须限制超大 Markdown，可单独设置 `options.text.markdownVirtualizeAboveBytes`。
- 不绑定任何在线服务或公共 CDN，适合内网日志、配置、代码片段、README 和知识库附件预览。

## 迁移说明

standard/full 默认包含基础代码、文本和 Markdown，不安装 `diff2html`、`pako` 或 Mermaid。打开可选格式时会提示运行 `npx file-viewer-cli add text-tools --write` 或 `add mermaid-markdown --write`；`preset-all` 仅用于显式全量/调试。
