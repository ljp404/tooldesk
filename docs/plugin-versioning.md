# 插件 API 版本策略

Tooldesk v1 对外接入以稳定合同为核心。版本字段各自职责如下。

## 版本字段

| 字段 | 维护者 | 含义 |
| --- | --- | --- |
| `manifestVersion` | Tooldesk | 插件清单格式版本，v1 固定为 `1` |
| `sdkVersion` | Tooldesk | 插件 SDK 行为版本 |
| `HOST_API_VERSION` | Tooldesk | 宿主消息桥和 API 合同版本 |
| `minHostVersion` | 插件作者 | 插件要求的最低 Tooldesk 应用版本 |
| `plugin.version` | 插件作者 | 插件自身发布版本 |

## v1 稳定性约定

- v1 内新增 API 必须保持已发布 API 的参数和返回结构稳定。
- 新 API 默认只新增，不改名、不删除、不改变返回类型。
- 插件依赖新 API 时，必须提高 `minHostVersion`。
- 宿主不为非 v1 boot 写法提供额外入口。

## 破坏性变更

以下情况需要提升对应平台版本，并更新文档和测试：

- 修改 `plugin.json` 必填字段或字段语义。
- 修改 SDK boot 行为。
- 修改 `api:invoke` / `api:result` 消息结构。
- 修改已有 API 的参数、返回值或错误码含义。
- 修改权限组到 API 的映射。

## 发布要求

插件发布前必须：

- `plugin.version` 已按功能变化递增。
- `sdkVersion` 与开发时使用的 SDK 一致。
- `minHostVersion` 覆盖所需宿主能力。
- `npm.cmd run plugin:validate` 通过。

平台发布前必须：

- 更新 [`plugin-api-reference.md`](plugin-api-reference.md)。
- 更新 [`plugin-platform-standard.md`](plugin-platform-standard.md)。
- 补充或更新相关测试。
- 确认扩展中心能展示安装权限和信任信息。
