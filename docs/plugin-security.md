# 插件安全边界

本文定义 Tooldesk v1 插件对外接入的安全要求。

## 运行隔离

- 插件运行在 iframe 中，插件页面与宿主通过 SDK 消息桥通信。
- 宿主不得读取 iframe 内部 DOM、全局变量或业务对象。
- 插件不得访问 `window.tooldeskShortcut` 或宿主原生能力。
- 所有宿主能力必须通过 `TooldeskPlugin.create(...).connect()` 后的 `plugin.api` 调用。

## 权限最小化

- `permissions` 是权限组，`capabilities` 是实际 API 方法。
- `capabilities` 不得超出 `permissions` 允许范围。
- 插件只声明当前页面实际调用的能力。
- 本地文件、Hosts、KeePass、音乐、本地库等能力必须使用对应权限组。

## 网络请求

- 插件包内资源可以使用相对路径读取，例如 `fetch('./sites.json')`。
- 跨域 HTTP 请求必须通过 `sendHttpRequest`，并声明 `http` 权限。
- 插件不得在 iframe 内直接请求第三方业务接口。

## 数据与同步

- 插件本地数据使用宿主插件存储 API。
- 可同步数据必须通过 `plugin.json.sync.localStorageKeys` 明确声明。
- Cookie、Token、密钥、机器路径、数据库路径、密码库内容不得进入同步快照。
- 邮箱授权码、SSH 密码、HTTP cookies、带密钥的环境变量、云盘 refresh token 和剪贴板历史不得进入同步快照。
- 同一个插件内应把可同步偏好与敏感凭据拆成不同 storage key，便于只同步低风险数据。

## 市场安装信任链

- 市场包必须提供 `sha256`，安装时宿主会校验下载包。
- 市场索引应声明 `publisher`、`trusted`、`trustLevel`。
- 扩展中心安装前展示发布者、权限、信任级别和包校验摘要。
- 第一版支持 hash 校验和来源标识；签名字段预留为 `signature` / `signatureUrl`，正式签名启用前不得把未签名包标记为已签名。

## 禁止项

- 禁止手写 `api:invoke`。
- 禁止复制 SDK bridge。
- 禁止在插件中硬编码用户密钥。
- 禁止绕过权限调用宿主能力。
- 禁止在插件包中携带临时文件、日志、密钥或无关构建缓存。
