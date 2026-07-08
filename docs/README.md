# Tooldesk 文档索引

本文档目录按读者角色组织，避免把用户指南、插件标准、发布清单和云服务说明混在一起。

## 项目入口

| 文档 | 用途 |
| --- | --- |
| [`../README.md`](../README.md) | 项目简介、开发命令、构建命令和主要文档入口 |
| [`../LICENSE`](../LICENSE) | MIT 开源许可证 |
| [`../NOTICE.md`](../NOTICE.md) | 第三方商标、服务名称和资产声明 |
| [`../SECURITY.md`](../SECURITY.md) | 安全问题反馈与密钥管理原则 |
| [`../AGENTS.md`](../AGENTS.md) | 仓库维护规则和开发约束，主要面向维护者与自动化编码代理 |

## 插件平台

| 文档 | 用途 |
| --- | --- |
| [`plugin-platform-standard.md`](plugin-platform-standard.md) | 插件平台 v1 唯一正式标准；宿主、SDK、校验和 CI 均以此为准 |
| [`plugin-quick-start.md`](plugin-quick-start.md) | 5 分钟创建、校验、本地安装第一个插件 |
| [`plugin-api-reference.md`](plugin-api-reference.md) | 插件 API、权限映射和桥接消息参考 |
| [`plugin-extraction-guide.md`](plugin-extraction-guide.md) | 插件接入实施指南 |
| [`plugin-market-publish.md`](plugin-market-publish.md) | 插件市场发布、上传和本地验证说明 |
| [`plugin-security.md`](plugin-security.md) | 插件运行隔离、权限、网络、同步和市场信任边界 |
| [`plugin-versioning.md`](plugin-versioning.md) | 插件 API、SDK、manifest 和宿主版本治理 |
| [`plugin-debugging.md`](plugin-debugging.md) | 插件开发调试、日志和常见问题排障 |
| [`plugin.schema.json`](plugin.schema.json) | `plugin.json` 机器校验 Schema |
| [`plugin-template/`](plugin-template/) | 新插件模板 |

插件文档的优先级：`plugin-platform-standard.md` 最高；其他文档不得与它冲突。

## 功能指南

| 文档 | 用途 |
| --- | --- |
| [`obsidian-search-guide.md`](obsidian-search-guide.md) | Obsidian / 本地库搜索使用指南 |
| [`keepass-search-guide.md`](keepass-search-guide.md) | KeePassXC 搜索使用指南 |
| [`music-player-guide.md`](music-player-guide.md) | 音乐播放器使用指南 |
| [`region-screen-recording.md`](region-screen-recording.md) | 截图区域录屏已验证流程和维护约束 |
| [`desktop-architecture.md`](desktop-architecture.md) | Tauri 桌面端架构、模块边界、构建和验证说明 |

## 发布、安全和云服务

| 文档 | 用途 |
| --- | --- |
| [`github-publish-checklist.md`](github-publish-checklist.md) | 开源发布前检查、密钥边界和发布命令 |
| [`open-source-and-commercial-use.md`](open-source-and-commercial-use.md) | MIT 许可证、商业使用、第三方商标和素材使用边界 |
| [`privacy-and-data.md`](privacy-and-data.md) | 本地数据、敏感凭据、插件同步和第三方请求边界 |
| [`service-gateway.md`](service-gateway.md) | Supabase `tooldesk-services` 网关配置，覆盖 OCR、翻译、更新和云同步 |
| [`cloud-sync-plan.md`](cloud-sync-plan.md) | 当前云同步设计和安全边界 |

## 维护原则

- README 只保留项目入口和最常用命令，详细配置放到 `docs/`。
- 插件平台规则只在 `plugin-platform-standard.md` 定义，其他文档引用而不是重新定义。
- 涉及密钥、Token、云函数和发布的内容必须说明是否适合生产环境。
- 对外文档不得暗示与第三方产品存在官方关系，除非已有正式授权。
