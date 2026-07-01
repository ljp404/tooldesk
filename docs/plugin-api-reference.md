# Tooldesk 插件 API 参考

本文与宿主实现保持同步，权限映射源文件：

```text
src/shared/plugin/pluginApiReference.ts
```

## 版本字段

| 字段 | 位置 | 说明 |
| --- | --- | --- |
| `PLUGIN_SDK_VERSION` | `public/tooldesk-plugin-sdk.js` | 官方 SDK 版本，当前 `1.0.0` |
| `PLUGIN_HOST_API_VERSION` | `src/shared/plugin/pluginApiReference.ts` | 宿主消息桥 API 版本，当前 `1.0.0` |
| `plugin.json.sdkVersion` | 插件清单 | 插件开发时使用的 SDK 版本 |
| `plugin.json.minHostVersion` | 插件清单 | 插件要求的最低 Tooldesk 应用版本 |

宿主在 `host:ready` 与 `launch-context` 中附带 `appVersion`、`hostApiVersion`、`sdkVersion`。插件可通过 SDK 查询：

```js
const plugin = TooldeskPlugin.create({ id: 'tooldesk-xxx', capabilities: ['getAppVersion'] });
const result = await plugin.connect();
// connect() 返回 Promise；自动初始化请用 .then，见平台标准
const info = result.hostInfo;
```

## 标准接入方式

不要在插件内复制 bridge，也不要手写 SDK `<script>`。宿主会在插件 HTML 的 `<head>` 自动注入 SDK。

完整平台合同见 **`docs/plugin-platform-standard.md`**（唯一正式标准）。

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

  document.getElementById('copy').addEventListener('click', async () => {
    await api.copyText(input.value);
  });

  void plugin.connect().then(() => {
    // 自动初始化、首屏拉数、宿主事件订阅放这里
  });
</script>
```

说明：

- 先绑定 UI，再 `plugin.connect().then(...)`；禁止裸 `void plugin.connect()`。
- `plugin.json.capabilities` 必填，且与 `TooldeskPlugin.create({ capabilities })` 一致。
- `capabilities` 只能声明 `plugin.json.permissions` 已允许的 API。
- 下拉选项、表格列等 UI 数据应优先写在 HTML 中，不要依赖 SDK 加载成功后再填充。
- `api:result` 失败时宿主返回 `code` 字段，见平台标准错误码表。
- `plugin.api` 是 SDK proxy，但不是 Promise；SDK 必须保证 `api.then === undefined`。插件封装 async 工具函数时，不要把 `plugin.api` 作为 async 函数的直接返回值。
- 正常 `connect()` 握手应在毫秒级完成。若首屏 API 调用固定延迟约 5 秒或 10 秒，通常说明 `host:ready` / `permissions:get` 没有被宿主成功响应，应检查宿主消息桥，而不是业务 API。

## 基础 API（无需声明权限）

| API | 说明 |
| --- | --- |
| `getAppVersion()` | 获取宿主应用版本 |
| `closeCurrentWindow()` | 关闭当前工具窗口 |
| `getPluginStorageItem(key)` | 读取插件本地存储 |
| `setPluginStorageItem(key, value)` | 写入插件本地存储 |
| `removePluginStorageItem(key)` | 删除插件本地存储 |

存储 key 规则见 `plugin-extraction-guide.md`。

## 权限与 API 映射

扩展中心展示权限时使用中文标签；插件清单仍然填写稳定的权限 key。

| 权限 key | 扩展中心展示名 | 说明 |
| --- | --- | --- |
| `clipboard` | 写入剪贴板 | 复制文本或图片到系统剪贴板 |
| `http` | 发送网络请求 | 打开外部链接、查询外网 IP、通过宿主代理发起 HTTP 请求 |
| `docker` | 执行 Docker 命令 | 检测 Docker、拉取镜像、打标签、运行 compose |
| `filesystem` | 选择文件与打开路径 | 打开选择框、打开路径、读取文本文件、创建文本导出 |
| `hosts` | 读取和修改 Hosts | 读取、写入和更新系统 hosts |
| `browser-bookmarks` | 读取浏览器书签 | 读取系统浏览器书签 |
| `local-library` | 访问本地资料库 | 读取设置、搜索并打开本地资料库文件 |
| `keepass` | 访问 KeePassXC | 解锁、读取会话和锁定 KeePass 数据库 |
| `music` | 访问音乐播放器 | 扫描、播放、下载和管理音乐播放器数据 |
| `native-tool` | 执行插件内置工具 | 运行插件包内 `nativeTools` 声明的本地工具 |
| `ssh` | SSH 远程连接 | 测试 SSH 连接并在远程 Linux 执行命令 |

### `clipboard`

| API | 说明 |
| --- | --- |
| `copyText(text)` | 复制文本到剪贴板 |
| `copyImage(data)` | 复制图片到剪贴板 |

### `http`

| API | 说明 |
| --- | --- |
| `openExternalUrl(url)` | 用系统默认浏览器打开链接 |
| `queryDirectExternalIp()` | 查询本机外网 IP |
| `sendHttpRequest(options)` | 通过宿主发起 HTTP 请求 |

### `filesystem`

| API | 说明 |
| --- | --- |
| `showOpenDialog(options)` | 打开文件/目录选择框 |
| `readTextFile(path)` | 读取本地文本文件（UTF-8） |
| `openPath(path)` | 用系统默认方式打开路径 |
| `createTextExport(options)` | 创建文本导出任务 |
| `appendTextExport(id, chunk)` | 追加导出内容 |
| `finishTextExport(id)` | 完成导出任务 |

### `docker`

| API | 说明 |
| --- | --- |
| `checkDockerAvailable()` | 检测 Docker 是否可用 |
| `dockerImageExists(image)` | 检查本地是否已有镜像 |
| `dockerPullImage(image)` | 拉取镜像 |
| `dockerTagImage(source, target)` | 为镜像打标签 |
| `runDockerCompose(cwd, args?)` | 在指定目录执行 `docker compose` |

### `native-tool`

| API | 说明 |
| --- | --- |
| `runPluginTool(payload)` | 执行当前插件 `nativeTools` 中声明的工具 |

### `ssh`

| API | 说明 |
| --- | --- |
| `testSshConnection(config)` | 测试 SSH 密码登录 |
| `sshExec(config, command, options?)` | 在远程 Linux 执行单条命令 |
| `sshExecStream(config, command, options?)` | 执行命令并流式输出日志行 |
| `onSshExecOutput(callback)` | 订阅 `sshExecStream` 输出，返回取消函数 |

### `hosts`

| API | 说明 |
| --- | --- |
| `openHostsFolder()` | 打开 hosts 所在目录 |
| `readHostsFile()` | 读取 hosts 文件 |
| `writeHostsFile(content)` | 写入 hosts 文件 |
| `updateHostsEntry(entry)` | 更新单条 hosts 记录 |

### `browser-bookmarks`

| API | 说明 |
| --- | --- |
| `listBrowserBookmarks()` | 读取系统浏览器书签 |

### `local-library`

| API | 说明 |
| --- | --- |
| `getAppSettings()` | 读取应用设置 |
| `setAppSettings(patch)` | 更新应用设置 |
| `showOpenDialog(options)` | 打开文件/目录选择框 |
| `getLocalLibraries()` | 获取本地库列表 |
| `searchLocalLibrary(libraryKeyword, searchKeyword)` | 搜索本地库 |
| `openLocalLibraryFile(filePath, libraryKeyword, line?, keyword?)` | 打开本地库文件 |
| `onLocalLibraryChanged(callback)` | 订阅本地库变更，返回取消函数 |

### `keepass`

| API | 说明 |
| --- | --- |
| `getAppSettings()` | 读取应用设置 |
| `setAppSettings(patch)` | 更新应用设置 |
| `showOpenDialog(options)` | 打开文件/目录选择框 |
| `unlockKeePassDatabase(options)` | 解锁 KeePass 数据库 |
| `getKeePassSession()` | 获取 KeePass 会话 |
| `lockKeePassDatabase()` | 锁定 KeePass 数据库 |

### `music`

| API | 说明 |
| --- | --- |
| `showOpenDialog(options)` | 打开文件/目录选择框 |
| `scanMusicFiles(options)` | 扫描本地音乐 |
| `resolveLocalPlayUrl(path)` | 解析本地播放地址 |
| `resolveOnlinePlayUrl(options)` | 解析在线播放地址 |
| `resolveCloudPlayUrl(options)` | 解析云盘播放地址 |
| `resolveMusicCloudStoragePlayUrl(options)` | 解析音乐云盘播放地址 |
| `resolveTrackLyrics(options)` | 获取歌词 |
| `searchOnlineMusic(options)` | 搜索在线音乐 |
| `downloadOnlineMusic(options)` | 下载在线音乐 |
| `downloadCloudMusic(options)` | 下载云音乐 |
| `downloadMusicCloudStorageFile(options)` | 下载音乐云盘文件 |
| `uploadMusicCloudStorageFile(options)` | 上传音乐云盘文件 |
| `validateMusicCloudStorage(options)` | 校验音乐云盘 |
| `probeTracksMetadata(tracks)` | 探测音轨元数据 |
| `getMusicPlayerSettings()` | 读取播放器设置 |
| `saveMusicPlayerSettings(settings)` | 保存播放器设置 |
| `getMusicCacheStats()` | 读取缓存统计 |
| `clearMusicCache()` | 清空音乐缓存 |
| `invalidateCloudCache()` | 失效云缓存 |
| `getAliyunToken()` | 获取阿里云 token |
| `saveAliyunToken(token)` | 保存阿里云 token |
| `clearAliyunToken()` | 清除阿里云 token |
| `aliyunGenerateQRCode()` | 生成阿里云扫码登录二维码 |
| `aliyunCheckQRCode(options)` | 检查阿里云扫码状态 |
| `aliyunRefreshToken()` | 刷新阿里云 token |
| `aliyunListFiles(options)` | 列出阿里云文件 |
| `aliyunScanAllMusic(options)` | 扫描阿里云音乐 |
| `aliyunGetDownloadUrl(options)` | 获取阿里云下载地址 |
| `onCloudScanProgress(callback)` | 订阅云扫描进度，返回取消函数 |

## 消息桥协议

插件调用示例（开发者应通过 SDK 调用，不应手写）：

```js
window.parent.postMessage(
  {
    args: [],
    method: 'copyText',
    requestId: 'request-id',
    source: 'tooldesk-plugin',
    type: 'api:invoke'
  },
  '*'
);
```

宿主返回：

```js
{
  ok: true,
  requestId: 'request-id',
  result: true,
  source: 'tooldesk-host',
  type: 'api:result'
}
```

启动上下文：

```js
{
  appVersion: '0.1.0',
  content: '',
  hostApiVersion: '1.0.0',
  pluginId: 'tooldesk-xxx',
  sdkVersion: '1.0.0',
  toolKey: 'plugin:tooldesk-xxx',
  triggeredAt: 0,
  source: 'tooldesk-host',
  type: 'launch-context'
}
```

权限查询：

```js
window.parent.postMessage(
  { requestId: 'permissions-id', source: 'tooldesk-plugin', type: 'permissions:get' },
  '*'
);
```

### 消息数据要求

桥接消息必须是 structured-clone-safe 的普通数据。允许 string、number、boolean、null、plain object、普通数组；禁止发送函数、DOM、WindowProxy、Vue proxy、Error 实例、Promise、Map、Set 或类实例。

宿主从 Vue props、computed、store 取到的数组或对象，发送前必须复制为普通数据。例如：

```ts
const permissions = Array.from(props.tool.permissions ?? []).map(String);
```

宿主不得读取跨域 iframe 内的 `window` 属性来判断插件状态；状态只能通过 `host:ready`、`permissions:get`、`api:*` 消息交换获得。

## 新增 API 检查清单

1. `plugin.json` 是否声明了对应 `permissions`
2. `src/shared/plugin/pluginApiReference.ts` 是否加入映射
3. `PluginToolHost.vue` 是否通过共享映射校验
4. `preload.cts` / 主进程是否已实现 IPC
5. API 返回值是否为 plain data，可 structured clone
6. 首屏握手和一次真实 API 调用是否无固定 5 秒超时
7. 本文档是否同步更新
