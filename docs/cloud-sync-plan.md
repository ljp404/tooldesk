# Tooldesk 云同步设计

本文说明当前云同步设计和安全边界。服务端网关配置见 [`service-gateway.md`](service-gateway.md)。

## 当前方案

云同步通过 `supabase/functions/tooldesk-services` 统一入口完成：

- 桌面客户端导出本地可同步快照。
- 客户端用 `TOOLDESK_SUPABASE_URL` 和 `TOOLDESK_SUPABASE_ANON_KEY` 调用服务端网关。
- 云函数校验签名、时间戳、nonce、body hash 和客户端版本。
- 云函数将加密快照写入私有 Supabase Storage bucket：`tooldesk-sync`。

客户端不直接持有对象存储写入密钥，也不直接写 COS / Supabase Storage。

## 当前已实现的本地同步底座

主进程提供以下 IPC：

- `sync:get-manifest`：返回本地数据清单。
- `sync:export-local-snapshot`：导出可同步快照。
- `sync:import-local-snapshot`：导入同步快照。

同步快照格式：

```json
{
  "schemaVersion": 1,
  "exportedAt": "2026-06-03T00:00:00.000Z",
  "items": {
    "app-settings": {
      "schemaVersion": 1,
      "updatedAt": "2026-06-03T00:00:00.000Z",
      "value": {}
    }
  }
}
```

默认只导出安全的同步数据。每个 item 独立维护 `updatedAt`，云同步时先拉云端快照，再与本地快照合并，最后上传合并后的完整加密快照。

单人多设备合并规则：

- 普通模块按 item 的 `updatedAt` 取较新值。
- 插件通过 `plugin.json` 的 `sync.localStorageKeys` 声明本地数据同步入口。
- HTTP 请求插件会做领域合并：保存请求按 requestId 合并，环境变量按 envId 合并，请求历史按 id 去重合并。
- 未声明同步的 Cookie、Token、机器路径、敏感凭证不会进入快照。

## 数据分类

| 数据 | 路径 | 分类 | 策略 |
| --- | --- | --- | --- |
| 应用设置安全子集 | `settings.json` | 可同步 | 只同步安全字段 |
| 已安装扩展清单 | `plugins/*/plugin.json` | 可同步 | 只同步扩展 id、名称、版本 |
| 音乐下载记录 | `music-downloads.json` | 本机数据 | 默认不同步，含本机路径 |
| 音乐最近播放 | `music-recent.json` | 可同步 | 按 item 更新时间合并 |
| 音乐歌单 | `music-playlists.json` | 可同步 | 按 item 更新时间合并 |
| 插件本地数据 | `plugin:<pluginId>` | 可同步 | 按插件声明同步，必要时做领域合并 |
| 超级剪贴板记录 | `super-clipboard/` | 本机隐私 | 默认不同步 |
| 阿里云盘令牌 | `aliyun-token.json` | 敏感 | 禁止明文同步 |
| 邮箱授权码 | 邮箱管理账号配置 | 敏感 | 禁止同步 |
| SSH 密码 | 远程执行配置 | 敏感 | 禁止同步 |
| HTTP Cookies / Token 环境变量 | HTTP 请求插件 | 敏感 | 禁止同步 |
| OCR / 翻译 / KeePass 配置 | `settings.json` | 敏感 | 禁止明文同步 |

## 云端位置

当前服务端存储：

```text
Supabase Storage private bucket: tooldesk-sync
```

对象 key 由云函数按用户或设备身份生成，客户端不应自行拼接云端路径。

## 安全规则

- 不使用 COS / Supabase 永久密钥做客户端登录。
- 不把对象存储永久密钥写入客户端。
- 不把用户密码、OCR Key、翻译 Key、云盘 Token 写入同步快照。
- 不把敏感 Token 明文放进同步快照。
- 本机路径类数据默认不同步。
- 后续如需同步敏感项，必须先做端到端加密，并在本文件记录威胁模型和恢复方案。
