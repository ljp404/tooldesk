# Tooldesk Plugin Platform v1

**本文是 Tooldesk 插件平台的唯一正式标准**，适用于内部插件与对外第三方组件。宿主实现、SDK、校验脚本与 CI 均以本文为准；文档与实现不一致时，以本文及 `docs/plugin.schema.json` 为权威，并应修正实现或文档直至一致。

第一版只支持 v1 合同。不符合 v1 的插件包将被拒绝安装，且不会在运行时加载。

## 四层合同

| 层级 | 职责 | 源文件 |
| --- | --- | --- |
| Host Runtime | 加载插件、注入 SDK、权限 enforcement、版本协商、结构化错误 | `PluginToolHost.vue`、`pluginService.ts` |
| Bridge Protocol | postMessage 消息格式 | `src/shared/plugin/pluginApiReference.ts` |
| Plugin SDK | 开发者唯一入口 | `public/tooldesk-plugin-sdk.js` |
| Plugin Package | `plugin.json` + 入口页面 | `plugins/tooldesk-*/` |

## 宿主必须保证

1. **SDK 自动注入**：加载插件 HTML 时，宿主在 `<head>` 首行注入 SDK；插件不得手写 `<script src="...sdk.js">`。
2. **host:ready**：iframe 加载完成后发送 `host:ready`，包含 `appVersion`、`hostApiVersion`、`sdkVersion`、`permissions`。
3. **权限白名单**：`plugin.json.permissions` 映射到 API 白名单；未声明的 API 一律拒绝，返回 `PLUGIN_API_DENIED`。
4. **安装校验**：本地安装与市场安装均执行 `validatePluginRoot()`；不通过则拒绝安装。
5. **运行时校验**：已安装插件在 `listInstalledPluginTools()` 时再次校验；不合规包跳过加载并在主进程输出警告。
6. **SDK 加载失败提示**：SDK 注入或插件页加载失败时，宿主壳层显示错误，而不是白屏；宿主不得通过读取跨域 iframe 的 `contentWindow.TooldeskPlugin` 判断状态。
7. **结构化错误**：`api:result` 失败时携带 `code` 字段（见下文错误码表）。

### 宿主实现强制约束

插件 iframe 是安全边界。宿主可以保存 iframe 的 `contentWindow` 用于 `postMessage`，但必须按以下规则处理：

- `contentWindow` / `WindowProxy` / `MessagePort` / DOM 节点等浏览器对象不得放入 Vue `ref`、`reactive`、store 或任何会被响应式系统代理/探测的位置；只能存放在普通局部变量或模块私有变量中。
- 宿主不得读取跨域 iframe 的任意业务属性（如 `contentWindow.TooldeskPlugin`、DOM、全局变量）。插件状态只能通过 `host:ready`、`permissions:get`、`api:*` 等消息协议判断。
- 所有 `postMessage` payload 必须是 structured-clone-safe 的普通数据：plain object、string、number、boolean、null、普通数组。禁止发送 Vue proxy、函数、DOM 对象、Error 实例、Promise、Map、Set、WindowProxy 或类实例。
- 从 Vue props、computed、store 取出的数组或对象，发送前必须转成普通数据，例如 `Array.from(props.tool.permissions ?? []).map(String)`。
- 宿主对 `host:ready:get`、`permissions:get`、`launch-context:get` 应立即响应；正常握手应为毫秒级。超过 1 秒应记录 warning，超过 SDK 超时时间视为宿主桥故障。
- `PluginToolHost` 的权限判断必须复用共享权限映射（`src/shared/plugin/pluginApiReference.ts`），不得维护第二份手写映射。
- `api:result` 必须始终返回 plain data；宿主 API 返回 `Error`、`Date`、`Buffer`、类实例等对象时，应先转换为字符串、ISO 时间或明确的数据结构。

## SDK 唯一入口

```js
const plugin = TooldeskPlugin.create({
  id: 'tooldesk-xxx', // 必须与 plugin.json.id 完全一致
  capabilities: ['copyText'], // 必须与 plugin.json.capabilities 一致
  minHostVersion: '0.1.0', // 可选；也可只在 plugin.json 声明
  onLaunchContext(context) {
    applyContent(context.content || '');
  },
  onReady(info) {},
  onError(error) {}
});

const api = plugin.api;

// 1. 先绑定 UI（事件监听、纯 DOM 初始化；不得放进 connect().then）
document.getElementById('copy').addEventListener('click', async () => {
  await api.copyText(input.value);
});

// 2. 再连接宿主；仅 API 自动初始化放在 .then 内
void plugin.connect().then(() => {
  loadInitialData(); // 会调用 api.* 的首屏拉数、订阅宿主事件等
});
```

无自动初始化时：

```js
void plugin.connect().then(() => {});
```

### SDK 规则

- 仅使用 `TooldeskPlugin.create()` + `plugin.connect().then(...)`。
- 禁止 `TooldeskPlugin.run`、`initTooldeskPlugin`、`createTooldeskPluginApi`、内联 bridge、直接访问 `window.tooldeskShortcut`。
- 禁止裸 `void plugin.connect()`（无 `.then`）；凡使用 `api.*` 的入口页必须包含 `plugin.connect().then(`。
- `connect()` 完成之前调用 `api.*` 会返回 `PLUGIN_SDK_NOT_READY`。
- 用户交互触发的 `api.*`（如按钮 click）也必须在 `connect()` 完成之后才会成功；因此自动初始化、首屏数据拉取、订阅宿主事件等必须放在 `.then` 内。
- `plugin.api` 必须是非 thenable 对象；SDK 的 API proxy 必须对 `then` 返回 `undefined`，避免 async/await 或 Promise 解析把 API proxy 当成 Promise。
- 插件代码不要从 async 函数返回 `plugin.api`；如确需封装，返回 `{ api: plugin.api }` 这类普通对象，或在函数内部完成 API 调用。
- `copyText` 只通过宿主能力写入剪贴板；宿主不可用时必须显式失败。
- 跨域 HTTP 必须使用 `sendHttpRequest`（需 `http` 权限）；禁止 iframe 内裸 `fetch('https://...')`。
- 仅允许 `fetch('./asset.json')` 读取插件包内静态资源；其余网络请求走宿主代理。
- `sendHttpRequest` 响应含 `body`、`bodyByteLength`、`bodyEncoding`（`utf-8` / `base64`）；二进制场景用 `bodyEncoding === 'base64'` 解码。
- 宿主注入 SDK 后会自动禁用插件页输入框的浏览器自动填充：普通输入框 `autocomplete="off"`，密码框 `autocomplete="new-password"`，并为无 `name` 的字段补 `tooldesk-{id}`；插件无需逐个手写 `autocomplete`。

### 错误码

SDK 与宿主共用以下 `code`（`TooldeskPluginError.code` / `api:result.code`）：

| code | 含义 |
| --- | --- |
| `PLUGIN_SDK_NOT_READY` | 未调用 `connect()` 或尚未完成 |
| `PLUGIN_API_DENIED` | manifest 未授权或宿主执行失败 |
| `PLUGIN_API_UNAVAILABLE` | 宿主未实现该 API |
| `PLUGIN_HOST_INCOMPATIBLE` | 宿主版本低于 `minHostVersion` |
| `PLUGIN_CONNECT_FAILED` | `connect()` 失败 |
| `PLUGIN_STORAGE_DENIED` | 插件本地存储 API 失败 |

失败时的 `api:result` 示例：

```js
{
  source: 'tooldesk-host',
  type: 'api:result',
  ok: false,
  requestId: '...',
  code: 'PLUGIN_API_DENIED',
  error: 'Plugin API is not allowed: sendHttpRequest'
}
```

## plugin.json v1 必填字段

| 字段 | 说明 |
| --- | --- |
| `manifestVersion` | 固定为 `1` |
| `id` | 形如 `tooldesk-xxx`，与 `TooldeskPlugin.create({ id })` 一致 |
| `name` | 显示名称 |
| `version` | semver，如 `1.0.0` |
| `entry` | 相对路径入口 |
| `category` | `text` / `dev` / `image` / `json` / `finance` / `life` / `document` |
| `publisher` | 发布者标识 |
| `sdkVersion` | 必须与宿主 SDK 一致，当前 `1.0.0` |
| `minHostVersion` | 最低 Tooldesk 版本；依赖新宿主 API 时必须抬高 |
| `capabilities` | **必填**；与 HTML 中 `TooldeskPlugin.create({ capabilities })` 完全一致 |

JSON Schema：`docs/plugin.schema.json`

### 图标职责

- `plugin.json.icon` 是工具入口图标；插件使用本地资产时必须固定为 `assets/icon.svg`。
- 工具入口图标只用于主程序工具列表、快捷搜索、扩展中心、独立窗口内容标题等 Tooldesk UI 区域。
- `plugin.json.windowIcon` 是插件独立窗口图标，只允许固定为 `assets/window-icon.png` 或 `assets/window-icon.ico`。
- `icon` 和 `windowIcon` 必须都是透明背景资产，不得依赖有底色的方形图块来适配 UI。
- Windows 任务栏图标、独立工具窗口系统图标优先使用 `windowIcon`；未声明时才回退到插件包内 `assets/window-icon.ico` / `assets/window-icon.png` 或宿主产品图标。
- 统一生成命令：`npm.cmd run plugin:icons`。该命令会为 `plugins/*` 生成或补齐 `assets/icon.svg`、`assets/window-icon.png`，并写入 `plugin.json.windowIcon`。

### permissions 与 capabilities

- `permissions`：声明需要的权限组（如 `clipboard`、`http`）；遵循最小权限。
- `capabilities`：声明实际调用的 API 方法名（如 `copyText`、`sendHttpRequest`）。
- 每个 `capabilities` 项必须被 `permissions` 映射允许；基础 API（`getAppVersion`、`getPluginStorageItem` 等）无需额外 permission。
- `plugin.json.capabilities` 必须覆盖所有 HTML 入口（含 `settings.html`）中 `TooldeskPlugin.create` 声明的 capabilities。
- 需要执行插件自带二进制时，统一声明 `permissions: ["native-tool"]`、`capabilities: ["runPluginTool"]` 和 `nativeTools` 映射；宿主只允许运行当前插件包内声明过的工具，禁止回退系统 PATH 或执行任意绝对路径。
- 修改 HTML 后运行 `npm.cmd run plugin:capabilities` 同步 manifest，再 `npm.cmd run plugin:validate`。
- 扩展中心展示权限时使用 `src/shared/plugin/pluginApiReference.ts` 中的中文标签；不得在 UI 中维护第二份权限文案。

## 插件开发强制规范

1. **渐进增强**：下拉、按钮、表格列等关键 UI 写在 HTML，不依赖 SDK 成功后 JS 填充。
2. **boot 顺序**：DOM 事件绑定（`addEventListener` / `bindEvents`）→ `void plugin.connect().then(() => { 仅 API 自动初始化 })`。禁止把按钮事件绑定放进 `.then`，否则 connect 完成前按钮无响应。
3. **禁止内联 bridge**：不得复制 `createTooldeskPluginApi`，不得手写 `type: 'api:invoke'` postMessage。
4. **禁止手写 SDK script**：由宿主注入。
5. **权限最小化**：只声明实际需要的 `permissions`；`capabilities` 只列实际调用的 API，不得留空数组。
6. **id 一致**：`plugin.json.id` 与 `TooldeskPlugin.create({ id })` 必须相同。
7. **只接受 v1 写法**：第一版不提供额外入口、内联 bridge 或 boot helper。发现非 v1 写法时应直接改为 v1 或拒绝加载，不增加额外分支。

## 桥接消息

| type | 方向 | 用途 |
| --- | --- | --- |
| `host:ready` | Host → Plugin | 宿主就绪 |
| `host:ready:get` | Plugin → Host | 请求 host:ready |
| `launch-context` | Host → Plugin | 快捷内容 |
| `launch-context:get` | Plugin → Host | 请求 launch-context |
| `api:invoke` / `api:result` | 双向 | RPC；失败时带 `code` |
| `api:subscribe` / `api:unsubscribe` / `api:event` | 双向 | 事件 |
| `permissions:get` / `permissions:result` | 双向 | 权限查询 |

插件开发者应使用 SDK，不应直接构造上述消息。

### 消息数据合同

所有桥接消息必须满足 structured clone 规则，并且应保持 JSON 可序列化。推荐把消息视为以下形态：

```ts
type PluginBridgePayload = {
  [key: string]: string | number | boolean | null | PluginBridgePayload | PluginBridgePayload[];
};
```

宿主和 SDK 都不得依赖对象原型、函数、DOM 引用、响应式代理或跨上下文对象。权限、capabilities、keywords 等数组发送前必须复制为普通数组。

## 校验与工具链

校验实现：`src/shared/plugin/validatePluginPackage.ts`
仓库校验：`scripts/validate-plugins.mjs`

```bash
# 外部开发者推荐入口：创建/同步 capabilities/校验/同步安装目录
npm.cmd run plugin:dev -- tooldesk-your-plugin

# 为 plugins/* 生成或补齐 icon/windowIcon
npm.cmd run plugin:icons

# 校验 plugins/*（已纳入 npm run check）
npm.cmd run plugin:validate

# 完整 CI 检查
npm.cmd run check

# 从 HTML 同步 plugin.json capabilities
npm.cmd run plugin:capabilities

# 新建插件脚手架
npm.cmd run plugin:scaffold -- tooldesk-your-plugin

# 同步到本机已安装目录（开发验证）
npm.cmd run plugin:sync
```

发布前必须：`plugin:validate` 通过，且 `sdkVersion` 与宿主一致。

权限映射、基础 API、SDK/Host API 版本和权限中文标签属于 v1 API 合同；修改 `src/shared/plugin/pluginApiReference.ts` 时必须同步 `src/shared/plugin/pluginApiReference.test.ts` 与 `docs/plugin-api-reference.md`，并运行 `npm.cmd run test`。

模板目录：`docs/plugin-template/`

## 市场信任合同

市场安装必须满足：

- 市场索引包含 `pluginId`、`version`、`downloadUrl`、`sha256`、`publisher`、`trusted`、`trustLevel`。
- 安装时宿主下载 `plugin.zip` 后重新计算 SHA-256；不一致必须拒绝安装。
- 解压必须防止路径穿越；插件包内必须能定位唯一有效 `plugin.json`。
- 解压后的 `plugin.json.id` 必须与市场 `pluginId` 一致。
- 安装前 UI 必须展示发布者、权限、信任级别和包校验摘要。
- 安装失败时 UI 必须提供可展开调试详情，至少覆盖市场索引、下载地址、SHA-256 差异、插件校验错误或安装目录错误。

签名字段 `signature` / `signatureUrl` 为 v1 预留字段；启用正式签名校验前，不得把未签名包宣传为已签名。

## 版本治理

| 版本 | 维护位置 | 何时升级 |
| --- | --- | --- |
| `HOST_API_VERSION` | `pluginApiReference.ts` | 消息协议/API 签名变更 |
| `SDK_VERSION` | `tooldesk-plugin-sdk.js` | SDK 行为变更 |
| `manifestVersion` | `plugin.json` | 清单字段变更 |
| `plugin.version` | 插件作者 | 功能发布 |
| `minHostVersion` | 插件作者 | 依赖更高宿主版本时 |

## 平台回归检查

修改宿主桥、SDK、权限映射或插件加载逻辑时，除常规 `typecheck` / `lint` / `plugin:validate` 外，必须至少覆盖以下场景：

- 插件打开后 `host:ready` 与 `permissions:get` 不应等待 SDK 5 秒超时；首屏自动 API 调用应在 1 秒内开始。
- API proxy 在 `await`、async 函数返回值、`Promise.resolve(plugin.api)` 场景下不会触发 `api.then`。
- 宿主向 iframe 发送的 `permissions`、`launch-context`、`api:result` 均可被 structured clone，不产生 `DataCloneError`。
- 宿主不会读取跨域 iframe 的内部属性，不产生 `SecurityError`。
- 一个拥有权限的真实插件（如 Hosts 编辑器）能完成至少一次 API 调用并收到 `api:result`。

## 参考文档

- API 明细：`docs/plugin-api-reference.md`
- 快速开始：`docs/plugin-quick-start.md`
- 接入清单：`docs/plugin-extraction-guide.md`
- 安全边界：`docs/plugin-security.md`
- 版本策略：`docs/plugin-versioning.md`
- 调试排障：`docs/plugin-debugging.md`
- 市场发布：`docs/plugin-market-publish.md`
