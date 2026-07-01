# Tooldesk Service Gateway

`supabase/functions/tooldesk-services` 是 Tooldesk 的服务端网关，用于把敏感能力放到服务端执行，避免桌面客户端保存第三方服务密钥。

当前覆盖能力：

- OCR / 翻译代理。
- 绿色版更新下载的短期签名 URL。
- 云同步快照写入私有 Supabase Storage bucket：`tooldesk-sync`。

## 客户端环境变量

桌面客户端只需要服务地址和调用凭证：

```powershell
$env:TOOLDESK_SUPABASE_URL="https://your-project.supabase.co"
$env:TOOLDESK_SUPABASE_ANON_KEY="your-supabase-anon-key"
```

客户端会自动拼出 `https://your-project.supabase.co/functions/v1/tooldesk-services`。若客户端只使用 Supabase anon key 调用云函数，不要在云函数服务端启用旧的客户端 HMAC 签名校验，否则服务端会要求签名并拒绝客户端请求。

## Supabase Function Secrets

第三方密钥、更新 COS 永久密钥和限流配置只放在 Supabase Function Secrets：

```bash
supabase secrets set TOOLDESK_BAIDU_OCR_API_KEY=...
supabase secrets set TOOLDESK_BAIDU_OCR_SECRET_KEY=...
supabase secrets set TOOLDESK_TRANSLATE_PROVIDER=baidu
supabase secrets set TOOLDESK_BAIDU_TRANSLATE_APP_ID=...
supabase secrets set TOOLDESK_BAIDU_TRANSLATE_SECRET_KEY=...
supabase secrets set TOOLDESK_MIN_CLIENT_VERSION=0.1.0
supabase secrets set TOOLDESK_OCR_RATE_LIMIT_PER_MINUTE=20
supabase secrets set TOOLDESK_OCR_RATE_LIMIT_PER_DAY=200
supabase secrets set TOOLDESK_TRANSLATE_RATE_LIMIT_PER_MINUTE=60
supabase secrets set TOOLDESK_TRANSLATE_RATE_LIMIT_PER_DAY=1000
supabase secrets set TOOLDESK_UPDATE_COS_SECRET_ID=AKID...
supabase secrets set TOOLDESK_UPDATE_COS_SECRET_KEY=...
supabase secrets set TOOLDESK_UPDATE_COS_BUCKET=your-bucket-1250000000
supabase secrets set TOOLDESK_UPDATE_COS_REGION=ap-beijing
supabase secrets set TOOLDESK_UPDATE_COS_PREFIX=tooldesk/releases/win/
supabase secrets set TOOLDESK_UPDATE_SIGNED_URL_EXPIRES_SECONDS=600
supabase secrets set TOOLDESK_UPDATE_RATE_LIMIT_PER_MINUTE=30
supabase secrets set TOOLDESK_UPDATE_RATE_LIMIT_PER_DAY=500
```

生产环境必须配置跨实例限流与 nonce 防重放：

```bash
supabase secrets set UPSTASH_REDIS_REST_URL=...
supabase secrets set UPSTASH_REDIS_REST_TOKEN=...
```

未配置 Upstash 时，云函数会拒绝需要限流或 nonce 防重放的请求，避免多实例部署下出现限流和重放保护失效。

## 部署

```bash
supabase functions deploy tooldesk-services
```

## 安全边界

- OCR、翻译、更新 COS 永久密钥不得写入客户端仓库或客户端配置。
- 云同步快照由云函数写入私有 Supabase Storage，不由客户端直接写对象存储。
- `TOOLDESK_MIN_CLIENT_VERSION` 可用于拒绝低于版本门槛的客户端。
- 绿色版更新下载返回短期 COS 签名 URL；客户端仍需校验 `latest.yml` 中的 `sha512`。
