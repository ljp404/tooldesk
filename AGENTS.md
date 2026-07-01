# tooldesk 项目规则

## 角色定位
- 以资深 Tauri、Vue 3、TypeScript 工程师和架构师视角处理需求。
- 优先考虑企业级结构、清晰扩展点、稳定可维护的 UI 模式。
- 后续新增工具时，应尽量只关注自己的工具内容，不修改无关公共逻辑。

## 技术栈
- Tauri + Vue 3 + TypeScript。
- 优先沿用项目已有模式，不轻易新增抽象。
- 工具模块应通过工具注册体系接入，能懒加载的组件尽量懒加载。
- 新增工具通常只需要维护自己的注册信息、组件、局部 composable 和必要样式。

## 架构约定
- 主程序、快捷搜索窗口、快捷工具独立窗口的行为要清晰分离。
- 公共壳层、导航、面包屑等应放在工具组件外部，不要塞进每个工具里。
- 不要强制所有工具继承 JSON 格式化的头部、底部和操作按钮。JSON 格式化只是复杂编辑类工具的体验参考，不是所有工具的强制模板。
- 剪贴板识别、快捷键入口、自动打开工具等逻辑应集中管理，方便未来工具按规则接入。
- 对重复出现的初始内容、剪贴板、复制、快捷键、编辑器行为，优先沉淀为可复用工具函数或 composable。

## 插件平台（v1 强制）

**正式标准文档：`docs/plugin-platform-standard.md`**（对外合同，宿主/校验/CI 均以此为准）。

新增或修改 `plugins/*` 插件时，必须遵循该文档，要点：

- 清单：`plugin.json` 必填 `manifestVersion: 1`、`sdkVersion`、`minHostVersion`、`publisher`、`capabilities`（与 HTML 中 `TooldeskPlugin.create` 声明一致）。
- SDK：仅使用 `TooldeskPlugin.create({ id, capabilities })` + `void plugin.connect().then(...)`；禁止 `initTooldeskPlugin`、内联 bridge、手写 SDK `<script>`。
- `id` 必须与 `plugin.json.id` 一致；`capabilities` 不得超出 `permissions` 映射。
- UI 先绑定事件；宿主 API 调用与自动初始化必须在 `plugin.connect().then(...)` 内执行。
- 跨域 HTTP 必须用 `sendHttpRequest`（需 `http` 权限）；禁止 iframe 内裸 `fetch('https://...')` 业务请求；禁止手写 `type: 'api:invoke'` postMessage。
- 新建插件：`npm.cmd run plugin:scaffold -- tooldesk-your-plugin`；同步 manifest capabilities：`npm.cmd run plugin:capabilities`。
- 插件改动后执行 `npm.cmd run plugin:validate`（已纳入 `npm.cmd run check`），并同步到 `%APPDATA%\tooldesk\plugins\`（`npm.cmd run plugin:sync`）。

## 快捷搜索窗口
- 快捷搜索窗口是轻量启动器，不是普通工具窗口。
- 快捷搜索窗口应无边框，隐藏系统图标、标题栏、最小化、最大化、关闭按钮。
- 快捷搜索窗口内容应填满整个窗口区域，不要有外层间隙。
- 快捷搜索窗口不显示剪贴板预览。
- 快捷搜索窗口不显示“全部工具”区域。
- 鼠标离开快捷搜索窗口时不要关闭。
- 点击快捷搜索窗口外部导致窗口失焦时关闭。
- 打开后自动聚焦搜索输入框。
- 默认选中第一个可见工具。
- 键盘行为：
  - 左右键在当前视觉顺序中移动。
  - 上下键切换到上一行或下一行，并尽量保持相同列。
  - 回车打开当前选中工具。
  - Esc 关闭快捷搜索窗口。

## 工具独立窗口
- JSON、二维码、时间戳等快捷工具独立窗口默认保留正常系统窗口行为。
- 不要把快捷搜索窗口的无边框、失焦关闭行为应用到普通快捷工具窗口。
- 如果快捷搜索窗口和工具独立窗口需要不同 Tauri 窗口参数，应重建快捷窗口，不要试图动态修改创建后不可变的窗口参数。

## UI 标准
- UI 风格保持安静、实用、企业级。
- 避免冗余菜单、重复标签、无意义装饰。
- 布局要紧凑稳定，间距清晰，避免内容跳动。
- 图标要统一尺寸、统一风格、视觉对齐。
- 文本在常见桌面窗口尺寸下不能重叠或溢出。
- 不要在应用内加入解释功能用法的大段说明，除非它本身就是必要的 UI 文案。

## 当前工具期望
- JSON 格式化：
  - 默认缩进为 4 个空格。
  - 用户输入内容应原样保留，除非用户明确点击格式化或压缩。
  - 不要自动剥离粘贴内容里的非 JSON 前缀。
  - 仅当首次打开且剪贴板完整内容是合法 JSON 时，才自动填充并格式化。
  - 如果剪贴板不是合法 JSON，不自动填充，也不要初始显示错误。
- 文本对比：
  - 差异直接在原文本和新文本区域展示。
  - 缺失内容用不干扰阅读的占位方式表示，避免复制一份文字造成混淆。
- 二维码生成：
  - 输入区域和二维码预览区域视觉高度应保持协调。
  - 点击二维码预览可以复制二维码，并显示成功提示。
- 时间戳转换：
  - 自动识别秒和毫秒，并清晰展示识别出的单位。
- 截图区域录屏（**已验证，后续优化勿随意改动**）：
  - 点截图工具栏「录屏」后保留 overlay 蓝框（`enterRecordingRegionMode`），打开紧凑录屏任务栏；此阶段不销毁 overlay。
  - 点录屏任务栏「开始」后仍保留 overlay 蓝框用于描边；采集开始时不得 `resetOverlayWindowState` 销毁 overlay。
  - 采集期间仅保留紧凑录屏任务栏 + overlay 蓝框；禁止恢复独立 `recording-control` 浮窗（Windows 残影根因）。
  - `isRegionRecordingChromeWindow` 窗口不得被 hide/destroy；录屏准备态鼠标穿透不用 `forward: true`。
  - 停止录屏时再销毁 overlay；`recording-region-border.html` 仅作 overlay 不可用时的备用边框窗口。
  - 详见 `docs/region-screen-recording.md`。

## 开发流程
- 除非明确要求，不要打包安装包。
- 启动本地开发环境统一使用项目脚本：
  ```bash
  npm run dev
  ```
- 不要绕过项目脚本单独启动 `vite` 或 `tauri`，除非用户明确要求。
- 如果需要由 Codex 启动开发服务，应先确认当前是否已有服务；验证结束后检查并关闭由 Codex 启动的项目 dev 进程。
- 不要因为启动命令超时就反复更换启动方式；先确认用户常用启动命令、当前端口和项目进程状态。
- 修改 `plugins/*` 下的插件源码后，必须把对应插件重新安装/同步到实际运行的插件目录，否则应用仍会加载安装目录中的上一次副本。
- 插件重新安装/同步：优先 `npm.cmd run plugin:sync` 批量同步；单插件改动也可只复制对应目录。
- 开发环境下插件源码同步后，关闭并重新打开对应插件组件/窗口即可刷新已安装 HTML；不要默认重启 `npm run dev`。如果仍显示旧内容，优先检查宿主插件 iframe 是否带开发态 cache-buster。
- `npm run dev` 不会自动同步 `plugins/*` 源码；插件改动后必须执行 `npm.cmd run plugin:sync`。
- 代码变更后至少运行：
  - `npm.cmd run lint`
  - `npm.cmd run typecheck`
  - 涉及 `plugins/*` 时另跑 `npm.cmd run plugin:validate`
- 较大改动还应运行：
  - `npm.cmd run build`
- 重要 UI 改动应尽量用浏览器实际验证。
- 搜索文件和文本优先使用 `rg`。
- 手动编辑文件优先使用 `apply_patch`。
- 不要回滚用户改动，除非用户明确要求。

## 编码规则
- 项目所有文本文件统一使用 UTF-8。
- 涉及中文文件、中文文案、Markdown、Vue 模板、JSON 名称等读写时，PowerShell 命令必须先设置 UTF-8 编码：
  ```powershell
  [Console]::InputEncoding = [System.Text.UTF8Encoding]::new()
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
  $OutputEncoding = [System.Text.UTF8Encoding]::new()
  ```
- 单条 PowerShell 命令读取中文文件时，应直接前置 UTF-8 设置，并在 Windows PowerShell 5.1 中显式使用 `-Encoding UTF8`，例如：
  ```powershell
  [Console]::InputEncoding=[System.Text.UTF8Encoding]::new(); [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $OutputEncoding=[System.Text.UTF8Encoding]::new(); Get-Content docs/plugin-market-publish.md -Encoding UTF8
  ```
- 不要从 PowerShell 乱码输出中复制中文内容回写文件。
- 不使用 `Set-Content` / `Out-File` 的默认编码写中文文件；如必须使用，应显式指定 UTF-8。
- 如果发现文件已有真实乱码，应先单独修复编码和文案，不要和业务改动混在一起。

## 代码变更检查清单（必须执行）
每次代码变更完成后，必须按顺序完成以下检查：

1. ✅ **运行 typecheck**
   ```bash
   npm.cmd run typecheck
   ```
   - 确保没有类型错误
   - 如果有错误，必须修复后再继续

2. ✅ **运行 lint**
   ```bash
   npm.cmd run lint
   ```
   - 检查代码风格和潜在问题
   - 只修复本次修改引入的错误
   - 如果有错误，必须修复后再继续

3. ✅ **验证功能**
   - 对于插件改动：先运行 `npm.cmd run plugin:sync` 将修改过的插件同步到实际插件目录，再关闭并重新打开对应插件组件/窗口，验证应用内显示的是最新插件内容
   - 对于 UI 改动：运行 `npm.cmd run dev` 并在浏览器中测试
   - 对于逻辑改动：确保相关功能正常工作

4. ✅ **总结改动**
   - 向用户报告完成的工作
   - 说明修改了哪些文件
   - 说明验证结果

**重要**：如果跳过任何一步，视为任务未完成。

## Git 规则
- 只有用户明确要求时才提交代码。
- 提交前先查看 `git status --short`。
- 提交时应包含本次意图内的所有项目改动，包括新文件。
- commit message 简洁、准确描述改动。
