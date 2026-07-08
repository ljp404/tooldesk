# 插件接入实施规范

本文记录 Tooldesk v1 插件从开发、接入到发布的实施检查规则。第一版只维护插件标准入口，所有接入都以 v1 合同为准。

## 插件标准是什么

Tooldesk 插件的标准合同是 **`plugin.json` 清单 + Web 运行入口**，不是「必须单文件 HTML」。

- **清单**：`plugin.json` 声明 id、名称、分类、权限、入口、剪贴板匹配等。
- **入口**：默认是 `index.html`，也可以指向构建产物，例如 `dist/index.html`。
- **运行方式**：宿主通过 iframe 加载入口页面，插件通过官方 SDK 调用宿主能力。

对外可以把它理解为：**清单驱动的 Web 插件**。入门写法是单页 HTML，进阶写法是 Vue/React/Vite 构建后再安装。

最小模板见：

```text
docs\plugin-template\
```

## 官方 SDK

平台标准见 `docs/plugin-platform-standard.md`。SDK 由宿主自动注入，插件内不要手写 `<script src="...tooldesk-plugin-sdk.js">`。

```html
<script>
  const plugin = TooldeskPlugin.create({
    id: 'tooldesk-xxx',
    capabilities: ['copyText'],
    onLaunchContext(context) {
      applyContent(context.content || '');
    }
  });
  const api = plugin.api;

  void plugin.connect().then(() => {
    // 自动初始化放这里
  });
</script>
```

SDK 源文件：

```text
public\tooldesk-plugin-sdk.js
public\tooldesk-plugin-sdk.d.ts
```

完整 API 与权限表见 `docs\plugin-api-reference.md`。

说明：

- `tooldesk-plugin://__host__/...` 由宿主分发 SDK；插件 HTML 由宿主自动注入 SDK。
- `capabilities` 只能声明 `plugin.json` 的 `permissions` 已允许的 API。
- 所有插件必须使用 `TooldeskPlugin.create()` + `plugin.connect().then(...)`，禁止内联复制 bridge。
- 下拉选项等 UI 数据应写在 HTML 中，不要依赖 SDK 加载后再填充。
- 需要 TypeScript 提示时，把 `tooldesk-plugin-sdk.d.ts` 放到插件工程里引用。
- `plugin.json.sdkVersion` 记录插件使用的 SDK 版本；`minHostVersion` 记录最低宿主版本。

## 两种开发方式

### 方式 A：单页 HTML（默认）

```text
plugins\tooldesk-xxx\
  plugin.json
  index.html
  settings.html   可选
  *.json / *.png  可选资源
```

适合：财务计算器、格式转换、轻量查询工具。

### 方式 B：前端工程 + 构建产物

```text
plugins\tooldesk-xxx\
  plugin.json
  dist\index.html
  dist\assets\...
```

`plugin.json` 示例：

```json
{
  "entry": "dist/index.html"
}
```

适合：复杂 UI、组件化页面、需要 npm 依赖的插件。构建后的静态资源仍放在插件目录内，通过相对路径引用。

## plugin.json 常用字段

| 字段 | 作用 |
| --- | --- |
| `id` | 稳定插件 ID，例如 `tooldesk-rmb-uppercase` |
| `name` | 显示名称 |
| `entry` | 运行入口，相对插件目录 |
| `category` | 侧边栏分类：`text` / `dev` / `image` / `json` / `finance` / `life` / `document` |
| `permissions` | 宿主 API 白名单 |
| `sdkVersion` | 插件开发时使用的 SDK 版本，例如 `1.0.0` |
| `minHostVersion` | 要求的最低 Tooldesk 应用版本，例如 `0.1.0` |
| `keywords` / `defaultAlias` | 搜索与快捷启动 |
| `icon` | 工具入口图标，固定为 `assets/icon.svg`，透明背景 |
| `windowIcon` | 独立窗口/任务栏图标，固定为 `assets/window-icon.png` 或 `assets/window-icon.ico`，透明背景 |
| `clipboardMatch` | 剪贴板智能推荐规则 |
| `settings` | 可选设置页入口 |
| `sync.localStorageKeys` | 可选同步键 |

`clipboardMatch` 示例：

```json
{
  "clipboardMatch": {
    "type": "decimal-amount",
    "priority": 80
  }
}
```

也支持数组。可用预设见 `src/shared/plugin/clipboardMatch.ts` 中的 `ClipboardMatchPreset`。

## 接入目标

- 插件只负责自己的功能页面、设置页面和必要资源。
- 宿主负责工具注册、快捷启动、窗口标题栏、设置菜单、扩展中心、权限控制和安装卸载。
- 同一功能只能有一个宿主入口；插件入口和内置入口不得并存。
- 插件未安装时，不应在工作台、快捷启动、设置页里显示对应入口。

## 插件目录

每个插件放在独立目录：

```text
plugins\tooldesk-xxx
```

基础文件：

```text
plugin.json
index.html
settings.html  可选，仅插件需要设置页时提供
assets\icon.svg
assets\window-icon.png
```

图标可通过 `npm.cmd run plugin:icons` 生成或补齐；外部开发者通常只需要执行 `npm.cmd run plugin:dev -- tooldesk-xxx`。

`plugin.json` 至少应确认：

- `id` 稳定不变，例如 `tooldesk-obsidian`。
- `entry` 指向插件运行入口。
- `settings.entry` 只在插件有设置页时声明。
- `permissions` 只声明插件实际需要的宿主能力。
- `keywords`、`defaultAlias` 能覆盖默认搜索关键词。
- 插件有需要跨设备同步的本地 `localStorage` 数据时，统一通过 `sync.localStorageKeys` 声明；不要在设置页或同步服务里为单个插件写硬编码分支。
- `accent` 必须使用宿主已支持的颜色类，例如 `blue`、`green`、`pink`、`purple`、`violet`、`orange`。
- `category` 必须使用宿主已支持分类；无效值会降级为 `dev`。
- `version` 在行为、样式、设置项变化后递增。

示例：

```json
{
  "sync": {
    "localStorageKeys": [
      "tooldesk-http-collections",
      "tooldesk-http-environments",
      "tooldesk-http-history"
    ]
  }
}
```

同步数据会进入加密快照的 `plugin:<pluginId>` 项。敏感凭证、Cookie、访问令牌、机器路径默认不得声明同步。

## 宿主入口检查

新增或调整插件后必须全局确认宿主入口唯一：

```powershell
rg -n "plugin:tooldesk-xxx|tooldesk-xxx|工具显示名|默认别名" src plugins
```

需要重点确认：

- 工作台工具注册只来自插件清单或已明确保留的内置工具注册。
- 快捷启动只映射到插件入口，例如 `plugin:tooldesk-keepassxc`。
- 设置页入口只来自插件 `settings` 声明。
- 主进程特殊窗口逻辑必须使用插件 id，不得额外维护同功能入口。
- 发现同功能重复入口时直接删除多余入口，不增加额外映射。

## 快捷启动

- 快捷启动只显示插件工具入口，不显示插件内部资源。
- 例如本地库关键词 `ob` 属于 Obsidian 插件能力，不应再显示单独的本地库卡片。
- 自定义关键词命中时，应映射到插件入口，例如 `plugin:tooldesk-keepassxc`。
- 搜索匹配应包含 `label`、`caption`、`defaultAlias`、`keywords`、分类信息。

## 设置入口

- 插件设置入口由 `plugin.json` 的 `settings` 声明。
- 宿主根据已安装插件动态显示设置菜单。
- 插件未安装时，设置页不显示该插件菜单。
- 不在 `AppSettingsModal.vue` 中硬编码具体插件名称。

插件设置页样式必须贴近系统设置右侧表单：

- label 使用 13px、较粗字重。
- 输入框和 select 高度使用 40px。
- 边框、hover、focus、placeholder 与系统 `.settings-field` 保持一致。
- 浏览、保存、取消等按钮使用系统按钮高度和次级/主按钮风格。
- 不要把插件设置页做成独立网页卡片风格。

## 插件运行页

- 插件页面应填满 iframe，不要居中小卡片，除非功能本身就是登录/解锁面板。
- 宿主 `PluginToolHost` 必须保证 iframe `height: 100%`、`min-height: 0`。
- iframe 是插件安全边界。宿主不得读取跨域 iframe 的内部 window、DOM 或全局变量；插件状态只能通过官方 SDK 消息协议同步。
- 宿主保存 iframe `contentWindow` 时，只能放在普通变量中，不要放进 Vue `ref`、`reactive`、store 或任何会被响应式系统代理的位置。
- 宿主发给插件的所有消息必须是 plain data；从 props/store/computed 拿到的数组和对象要先复制，禁止把 Vue proxy 直接 `postMessage` 给 iframe。
- 插件页面需要自己处理 `body`、根容器高度和滚动区域。
- 交互状态不要靠整页或整表频繁重绘。
- hover 高亮只切换 class，跨页或数据变化时才重新渲染列表。
- 键盘上下移动、Enter 打开或复制、Esc 清空等行为要在输入框聚焦时也生效。
- `type="search"` 会带浏览器原生清除按钮；如果有自定义清除按钮，应改用 `type="text"` 或隐藏原生按钮。

## 图标和颜色

- 插件 HTML 不能直接使用 Vue 的 `AppIcon`。
- 插件页面需要图标时，使用内联 SVG 或插件自带资源。
- 不使用 `□`、`♪` 等字符长期充当业务图标，除非它本身就是设计的一部分。
- `accent` 必须是宿主标题栏、快捷启动、扩展中心都支持的颜色类。

## 宿主权限

插件调用宿主能力必须使用官方 SDK，禁止手写 `type: 'api:invoke'` postMessage：

```js
const plugin = TooldeskPlugin.create({
  id: 'tooldesk-xxx',
  capabilities: ['getAppSettings']
});
const api = plugin.api;

void plugin.connect().then(async () => {
  await api.getAppSettings();
});
```

跨域 HTTP 请求必须使用 `sendHttpRequest`（需 `http` 权限），不要 iframe 内裸 `fetch('https://...')`。

SDK 接入必须保持单一路径：

- 只使用 `TooldeskPlugin.create({ id, capabilities })`。
- 只使用 `void plugin.connect().then(...)` 连接宿主。
- 不使用 `TooldeskPlugin.run`、`initTooldeskPlugin`、`createTooldeskPluginApi` 或任何非标准 helper。
- 不直接访问 `window.tooldeskShortcut`。
- `plugin.api` 不应被包装成 thenable；如果封装工具函数，不要从 async 函数直接返回 `plugin.api`。

新增插件能力时必须同时检查：

- `plugin.json` 是否声明权限。
- `src/shared/plugin/pluginApiReference.ts` 是否开放对应 API。
- `preload.cts` 是否已经暴露宿主 API。
- 主进程是否已实现对应 IPC。
- 宿主返回值是否是可 structured clone 的 plain data。
- `host:ready`、`permissions:get`、首个 `api:invoke` 是否无固定 5 秒超时。

典型权限：

- `local-library`：本地库读取、搜索、打开文件。
- `keepass`：KeePassXC 解锁、会话读取、锁定。
- `music`：音乐扫描、播放 URL 解析。
- `filesystem`：打开文件选择框、打开路径。
- `clipboard`：复制文本等剪贴板能力。

## 启动上下文

插件需要知道从哪里打开时，使用 SDK 的 `onLaunchContext`，不要读取宿主全局状态。

```js
const plugin = TooldeskPlugin.create({
  id: 'tooldesk-xxx',
  capabilities: ['copyText'],
  onLaunchContext(context) {
    applyContent(context.content || '');
  }
});

void plugin.connect().then(() => {
  // onLaunchContext 仍由 SDK 在 connect 完成后分发
});
```

典型场景：

- 从本地库关键词打开 Obsidian 插件，需要带入 `libraryKeyword`。
- 从快捷启动打开插件时，需要保留 `shortcutContent`。

宿主发送：

```js
{
  source: 'tooldesk-host',
  type: 'launch-context',
  toolKey: 'plugin:tooldesk-xxx',
  pluginId: 'tooldesk-xxx',
  content: '',
  triggeredAt: 0
}
```

插件可通过 `requestLaunchContext()` 或 SDK 初始化时自动请求最新上下文。

## 本地安装验证

开发源码目录和运行安装目录不同：

```text
源码：plugins\tooldesk-xxx
运行：%APPDATA%\tooldesk\plugins\tooldesk-xxx
```

修改已安装插件后，必须同步到安装目录或通过扩展中心重新安装。不要只改源码就判断运行效果。

同步已安装插件示例：

```powershell
[Console]::InputEncoding=[System.Text.UTF8Encoding]::new(); [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $OutputEncoding=[System.Text.UTF8Encoding]::new(); npm.cmd run plugin:sync
```

注意：本地开发时，新增或修改 `plugins\tooldesk-xxx` 后，应执行 `npm.cmd run plugin:sync` 同步到 `%APPDATA%\tooldesk\plugins\tooldesk-xxx`。如果运行目录不存在，脚本会主动创建并复制，避免每次都需要在扩展中心手动安装本地插件。

## 发布前检查

新增或修改插件后至少执行：

```powershell
npm.cmd run typecheck
npm.cmd run lint
```

涉及 UI、宿主通信、插件注册、权限、快捷启动、设置页时继续执行：

```powershell
npm.cmd run build
```

发布前还要确认：

- 插件在扩展中心显示正确。
- 安装后工作台和快捷启动只出现一个入口。
- 设置页只在插件已安装时显示菜单。
- 插件页面和设置页样式与系统一致。
- 鼠标点击、键盘上下、Enter、Esc 等常用交互正常。
- 上传命令指向插件目录。

## 上传

上传命令和 COS 目录规则见：

```text
docs\plugin-market-publish.md
```
