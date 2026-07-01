# 扩展市场发布说明

开发或发布插件前，先阅读：

```text
docs\plugin-quick-start.md
docs\plugin-extraction-guide.md
docs\plugin-api-reference.md
docs\plugin-security.md
docs\plugin-versioning.md
```

## 插件目录

所有插件统一放在：

```text
plugins\tooldesk-xxx\
  plugin.json
  index.html
  settings.html   可选
```

`plugin.json` 是扩展市场清单，`index.html` 是插件运行入口（也可以是 `dist/index.html` 等构建产物）。主程序安装插件后，通过 iframe 加载插件入口。

插件页面使用官方 SDK，由宿主自动注入：

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
  void plugin.connect().then(() => {});
</script>
```

禁止在插件内复制 bridge。SDK 与 API 说明见 `docs/plugin-api-reference.md`，**平台标准（唯一合同）**见 `docs/plugin-platform-standard.md`。

## 开发顺序

1. 在 `plugins\tooldesk-xxx` 目录开发插件功能。
2. 插件需要调用主程序能力时，通过官方 SDK 调用，不直接访问 `window.tooldeskShortcut`。
3. 在 `plugin.json` 中声明 `permissions`、`capabilities`、`sdkVersion`、`minHostVersion`。
4. 在主程序里运行 `npm.cmd run dev`，通过扩展中心安装本地插件验证。
5. 验证通过后，回到项目根目录执行上传命令。

## 插件桥约定

插件优先使用 SDK。若需了解底层消息格式，见 `docs/plugin-platform-standard.md`；**不要**在插件中手写 `api:invoke`。

宿主成功返回：

```js
{
  ok: true,
  requestId: 'request-id',
  result: {},
  source: 'tooldesk-host',
  type: 'api:result'
}
```

宿主失败返回（含结构化 `code`）：

```js
{
  ok: false,
  requestId: 'request-id',
  code: 'PLUGIN_API_DENIED',
  error: 'Plugin API is not allowed: sendHttpRequest',
  source: 'tooldesk-host',
  type: 'api:result'
}
```

权限与 API 完整映射见 `docs\plugin-api-reference.md`。权限映射源文件为 `src\shared\plugin\pluginApiReference.ts`。

## 本地验证

在项目根目录执行：

```powershell
npm.cmd run plugin:dev -- tooldesk-your-plugin
npm.cmd run plugin:validate
npm.cmd run dev
```

`plugin:dev` 会创建或更新指定插件，并完成 capabilities 同步、校验和安装目录同步。`plugin:validate` 按 `docs/plugin-platform-standard.md` 校验清单、HTML 入口与 capabilities；发布前必须通过。

打开扩展中心，安装本地插件目录进行验证：

```text
D:\work\project\tooldesk\plugins\tooldesk-obsidian
D:\work\project\tooldesk\plugins\tooldesk-keepassxc
D:\work\project\tooldesk\plugins\tooldesk-music-player
```

## 上传命令

在项目根目录 `D:\work\project\tooldesk` 执行：

```powershell
npm.cmd run release:cos:all
```

该命令会先打包并上传应用新版本，再自动遍历 `plugins\*\plugin.json` 上传所有插件并更新远程市场索引。

只上传单个插件时执行：

```powershell
npm.cmd run upload:plugin -- plugins\tooldesk-obsidian
npm.cmd run upload:plugin -- plugins\tooldesk-keepassxc
npm.cmd run upload:plugin -- plugins\tooldesk-music-player
```

绝对路径版本：

```powershell
npm.cmd run upload:plugin -- D:\work\project\tooldesk\plugins\tooldesk-obsidian
npm.cmd run upload:plugin -- D:\work\project\tooldesk\plugins\tooldesk-keepassxc
npm.cmd run upload:plugin -- D:\work\project\tooldesk\plugins\tooldesk-music-player
```

## COS 配置

上传脚本只读取环境变量，不读取项目内密钥文件：

COS 上传 SDK 不随默认依赖安装；发布环境需要先临时安装：

```bash
npm.cmd install --no-save cos-nodejs-sdk-v5@^2.15.4
```

```powershell
$env:TOOLDESK_COS_SECRET_ID="AKID..."
$env:TOOLDESK_COS_SECRET_KEY="..."
$env:TOOLDESK_COS_BUCKET="your-bucket-1250000000"
$env:TOOLDESK_COS_REGION="ap-beijing"
$env:TOOLDESK_COS_PUBLIC_BASE_URL="https://your-bucket-1250000000.cos.ap-beijing.myqcloud.com/"
```

不要把 COS SecretId / SecretKey 写入项目文件。需要本机发布时，在当前 PowerShell 会话、系统环境变量或 CI Secrets 中配置上述变量。

## 默认公开市场

Tooldesk 桌面端内置一个官方公开扩展市场地址，用于读取 COS 上的 `tooldesk/plugins/market.json`。该地址只是公开 JSON 清单地址，不包含 COS SecretId、SecretKey、Supabase service role key 或其他私有密钥。

私有构建或自托管市场可以通过 `config/pluginMarketConfig.json` 覆盖 `marketUrl`。执行 `npm.cmd run upload:plugin` 或 `npm.cmd run release:cos:all` 时，发布脚本会根据 COS 公网地址同步更新该配置。

## 上传后的远程结构

脚本会自动完成以下事情：

- 打包插件目录为 `plugin.zip`
- 上传插件包到 `tooldesk/plugins/{pluginId}/{version}/plugin.zip`
- 上传插件清单到 `tooldesk/plugins/{pluginId}/{version}/plugin.json`
- 计算插件包 `sha256`
- 更新市场索引 `tooldesk/plugins/market.json`

应用内扩展市场读取远程 `market.json`。上传成功后，用户打开扩展中心即可看到新的插件版本并安装。

市场条目必须包含：

```json
{
  "pluginId": "tooldesk-demo-tool",
  "version": "1.0.0",
  "downloadUrl": "https://example.com/tooldesk/plugins/tooldesk-demo-tool/1.0.0/plugin.zip",
  "icon": "assets/icon.svg",
  "windowIcon": "assets/window-icon.png",
  "sha256": "64位十六进制 SHA-256",
  "publisher": "tooldesk",
  "trusted": true,
  "trustLevel": "official"
}
```

`trustLevel` 可选值：

| 值 | 含义 |
| --- | --- |
| `official` | Tooldesk 官方发布 |
| `verified` | 已验证发布者 |
| `community` | 社区发布者 |

扩展中心安装前会展示发布者、权限中文标签、信任级别和包校验摘要。安装时宿主会重新下载插件包并校验 `sha256`，校验失败会拒绝安装，并在“查看调试详情”中展示下载地址、实际 SHA-256 或校验错误。

## 发布前检查

- `plugin.json` 的 `id` 稳定不变。
- `version` 已递增。
- `entry` 指向的入口文件存在。
- 插件目录里没有临时文件、密钥或无关产物。
- 本地开发验证通过后再上传。
- 市场条目包含 `sha256`、`publisher`、`trusted`、`trustLevel`。
- 权限声明符合最小权限原则。
- `icon` 与 `windowIcon` 均指向插件包内存在的透明背景资产。
