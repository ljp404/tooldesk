# 插件开发快速开始

本文面向第一次接入 Tooldesk 插件的开发者。完整标准以 [`plugin-platform-standard.md`](plugin-platform-standard.md) 为准。

## 1. 创建插件

推荐使用开发者一键入口：

```powershell
npm.cmd run plugin:dev -- tooldesk-demo-tool
```

该命令会在插件不存在时创建脚手架，并依次执行图标生成、capabilities 同步、插件校验、安装目录同步。

如只需要创建目录，也可以单独执行：

```powershell
npm.cmd run plugin:scaffold -- tooldesk-demo-tool
```

插件目录会生成在：

```text
plugins\tooldesk-demo-tool
```

## 2. 开发页面

默认入口是 `index.html`。插件只通过宿主自动注入的 SDK 调用能力：

```html
<script>
  const plugin = TooldeskPlugin.create({
    id: 'tooldesk-demo-tool',
    capabilities: ['copyText']
  });
  const api = plugin.api;

  document.getElementById('copy').addEventListener('click', async () => {
    await api.copyText(document.getElementById('input').value);
  });

  void plugin.connect().then(() => {});
</script>
```

不要手写 SDK `<script>`，不要访问 `window.tooldeskShortcut`。

## 3. 声明权限

在 `plugin.json` 中声明插件实际需要的权限和能力：

```json
{
  "manifestVersion": 1,
  "id": "tooldesk-demo-tool",
  "name": "Demo Tool",
  "version": "1.0.0",
  "entry": "index.html",
  "category": "dev",
  "icon": "assets/icon.svg",
  "windowIcon": "assets/window-icon.png",
  "publisher": "your-name",
  "permissions": ["clipboard"],
  "capabilities": ["copyText"],
  "sdkVersion": "1.0.0",
  "minHostVersion": "0.1.0"
}
```

权限与 API 映射见 [`plugin-api-reference.md`](plugin-api-reference.md)。

## 4. 校验

```powershell
npm.cmd run plugin:dev -- tooldesk-demo-tool
```

或分步执行：

```powershell
npm.cmd run plugin:icons
npm.cmd run plugin:capabilities
npm.cmd run plugin:validate
```

`plugin:icons` 会补齐透明背景的工具入口图标和独立窗口图标。校验失败时先修复 `plugin.json`、SDK boot 顺序、图标路径或权限声明，再进入应用验证。

## 5. 本地安装验证

```powershell
npm.cmd run dev
```

打开扩展中心验证插件。`plugin:dev` 已经同步到运行目录；如果手动改源码但没有同步，应用仍会加载安装目录中的上一次副本。

也可以批量同步：

```powershell
npm.cmd run plugin:sync
```

## 6. 发布前

发布前必须通过：

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run plugin:validate
```

插件市场发布流程见 [`plugin-market-publish.md`](plugin-market-publish.md)。
