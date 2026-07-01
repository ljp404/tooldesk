# 插件调试与排障

本文用于外部开发者排查插件接入问题。

## 开发启动

```powershell
npm.cmd run dev
```

主程序默认只在终端打印 warning 和 error。需要详细日志时：

```powershell
$env:TOOLDESK_VERBOSE_LOGS="1"
npm.cmd run dev
```

日历弹窗专项调试：

```powershell
$env:TOOLDESK_CALENDAR_DEBUG="1"
npm.cmd run dev
```

## 常用检查

```powershell
npm.cmd run plugin:dev -- tooldesk-demo-tool
npm.cmd run plugin:capabilities
npm.cmd run plugin:validate
npm.cmd run plugin:sync
```

- `plugin:dev`：创建或更新指定插件，串行执行 capabilities、validate、sync，是外部开发者推荐入口。
- `plugin:capabilities`：从 HTML 中的 `TooldeskPlugin.create` 同步 capabilities。
- `plugin:validate`：校验清单、权限、SDK boot 和禁止项。
- `plugin:sync`：同步源码插件到实际安装目录。

## 日志位置

运行日志在：

```text
%APPDATA%\tooldesk\logs
```

日志文件会自动轮转。默认不记录 debug；设置 `TOOLDESK_VERBOSE_LOGS=1` 后会写入详细排障信息。

## 典型问题

### 插件页面白屏

1. 确认 `plugin.json.entry` 指向存在的 HTML。
2. 执行 `npm.cmd run plugin:validate`。
3. 确认插件已同步到 `%APPDATA%\tooldesk\plugins\<pluginId>`。

### API 调用被拒绝

1. 检查 `plugin.json.permissions`。
2. 检查 `plugin.json.capabilities`。
3. 确认 HTML 中 `TooldeskPlugin.create({ capabilities })` 与清单一致。

### 首屏加载固定等待数秒

通常说明 `host:ready`、`permissions:get` 或 `plugin.connect().then(...)` 链路异常。检查：

- 插件是否只使用宿主自动注入 SDK。
- 是否调用了 `void plugin.connect().then(...)`。
- 自动 API 初始化是否放在 `.then(...)` 内。

### 市场安装失败

1. 检查市场条目的 `downloadUrl`、`sha256`、`pluginId`。
2. 确认下载包解压后只有一个有效 `plugin.json`。
3. 确认包内 `plugin.json.id` 与市场 `pluginId` 一致。
4. 查看扩展中心提示下方的“查看调试详情”，其中会列出 SHA-256 实际值、下载地址、校验错误或安装目录等定位信息。

扩展中心主提示只显示结论；详细错误统一放在可展开详情中，避免普通用户被调试信息打断。
