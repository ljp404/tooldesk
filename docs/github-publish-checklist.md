# GitHub 发布检查清单

## 必须确认

- 不提交真实密钥、Token、私有发布配置。
- 不提交 `release/`、`release-staging/`、`dist/`、`src-tauri/target/`、`output/`、`.playwright-cli/` 等生成产物。
- COS 发布密钥只放在环境变量，不写入项目文件。
- OCR、翻译、同步等第三方服务密钥优先放云函数或服务端环境变量，不放客户端仓库。
- 如使用 `shared-credentials.enc.json`，不要提交明文 `secrets.plain.json`，也不要提交客户端可用的真实 decrypt key。
- 不提交真实 `tooldesk.config.json`、`.env*`、云端发布地址、私有 bucket 地址或个人服务端地址。
- 不把 cookies、API Token、邮箱授权码、SSH 密码、KeePass 数据库内容、剪贴板历史加入插件同步白名单。
- 不使用“官方”“兼容某闭源插件生态”“某产品平替”等容易造成关联或混淆的公开文案。

## 本地私有文件

这些文件不得提交；发布密钥统一放环境变量，第三方服务密钥优先放云函数或服务端环境变量：

- `secrets.plain.json`
- `shared-credentials.enc.json`
- `shared-credentials.*.json`
- `tooldesk.config.json`
- `tooldesk.config.local.json`
- `.env`
- `.env.*`

公开仓库只提交 `tooldesk.config.example.json`。

## 许可证、商业使用和第三方声明

- 根目录保留 `LICENSE`，并确保 `package.json` 的 `license` 字段一致。
- 根目录保留 `NOTICE.md`，说明第三方商标、服务名和素材归属。
- README 中说明本项目是独立项目，不隶属、不背书、不代表任何第三方服务。
- 如保留第三方官方图标、logo、截图或数据集，必须确认授权兼容，并在 `NOTICE.md` 或专门文档中说明来源。
- 商业分发前重新核对依赖许可证、第三方商标、服务 API 条款和用户数据处理说明。

## 插件和数据同步检查

- `plugin.json.sync.localStorageKeys` 只声明低风险偏好数据。
- HTTP 请求工具不得同步 cookies、敏感环境变量和带密钥的 headers。
- 邮箱管理不得同步邮箱授权码或客户端密码。
- SSH 工具不得同步密码、私钥路径或远程主机敏感信息。
- KeePass、剪贴板、截图、浏览器书签和本地文件内容默认只留在本机。

## 发布前命令

```bash
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd audit --omit=dev
npm.cmd run plugin:validate
```

## COS 发布环境变量

COS 上传脚本默认不把 `cos-nodejs-sdk-v5` 放进项目依赖树。发布环境需要先临时安装：

```bash
npm.cmd install --no-save cos-nodejs-sdk-v5@^2.15.4
```

```powershell
$env:TOOLDESK_COS_SECRET_ID="AKID..."
$env:TOOLDESK_COS_SECRET_KEY="..."
$env:TOOLDESK_COS_BUCKET="your-bucket-1250000000"
$env:TOOLDESK_COS_REGION="ap-beijing"
$env:TOOLDESK_COS_PREFIX="tooldesk/releases/win/"
```

## 客户端发布环境变量

本地 `npm run dev`、本地 `npm run build` 和 GitHub Actions 打包统一使用以下变量。公开仓库不要写入真实值；GitHub 打包时配置为 Actions Secrets。

```powershell
$env:TOOLDESK_PUBLIC_BASE_URL="https://your-bucket-1250000000.cos.ap-beijing.myqcloud.com/"
$env:TOOLDESK_SUPABASE_URL="https://your-project.supabase.co"
$env:TOOLDESK_SUPABASE_ANON_KEY="your-supabase-anon-key"
```

`TOOLDESK_PUBLIC_BASE_URL` 是公开静态资源根地址，客户端会自动派生：

- 软件更新：`tooldesk/releases/win/latest.yml`
- 插件市场：`tooldesk/plugins/market.json`

`TOOLDESK_SUPABASE_URL` 和 `TOOLDESK_SUPABASE_ANON_KEY` 用于调用 `tooldesk-services` 云函数，客户端会自动拼出 `/functions/v1/tooldesk-services`。

第三方密钥、更新 COS 永久密钥和生产限流配置必须放 Supabase Function Secrets。示例变量见 [`service-gateway.md`](service-gateway.md)，不要写入客户端仓库。

`TOOLDESK_MIN_CLIENT_VERSION` 是可选的客户端版本门槛；配置后云函数会读取客户端请求头里的应用版本，低于该版本门槛的客户端会被拒绝，便于发现泄露或协议升级时快速止损。

绿色版更新下载也可走该云函数：客户端请求 `update.portable-url`，云函数按设备/IP 限流后签发短期 COS URL。COS 永久密钥只放在云函数 Secrets。

云端同步也走同一个 `tooldesk-services`：客户端仍只配置 `TOOLDESK_SUPABASE_URL` 和 `TOOLDESK_SUPABASE_ANON_KEY`，加密快照由云函数写入 Supabase Storage 的私有 bucket `tooldesk-sync`。

云函数会限制请求体大小并按 IP/设备限流。若选择只使用 Supabase anon key 作为客户端调用凭证，不要在云函数服务端启用旧的客户端 HMAC 签名校验，否则客户端请求会被拒绝。

## GitHub 仓库建议

- 补充并保留 `LICENSE`，明确开源许可证。
- 补充并保留 `NOTICE.md`，明确第三方商标和素材边界。
- README 中说明功能、截图、开发命令、构建命令、发布配置和隐私边界。
- 如开放 issue，建议补充 `SECURITY.md`，说明安全问题反馈方式。
- 发布安装包建议走 GitHub Releases，不把 `.exe` 文件提交到 Git 历史。
- 开启 GitHub secret scanning、Dependabot alerts 和 dependency graph。
