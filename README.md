# tooldesk

tooldesk is an open-source desktop toolbox built with Tauri, Vue 3 and TypeScript.

It focuses on a fast launcher, daily developer utilities, screenshots, local plugins and extensible desktop workflows.

## Features

- Quick launcher with global shortcuts.
- JSON formatting, minifying and validation.
- QR code generation.
- Text diff.
- Timestamp conversion.
- Screenshot, OCR and screen recording.
- HTTP client, browser bookmarks, hidden character detection and daily developer utilities.
- Extension center with local plugins such as Obsidian, KeePassXC, music player and common sites.

## Requirements

- Windows 10 or later is the primary validated desktop platform for v1.
- macOS builds are available from CI for early validation, but some desktop integrations may still need platform-specific testing.
- Node.js 22 or later is recommended.
- npm.
- Rust and Cargo installed through `rustup`.

## Development

```bash
npm install
npm run dev
```

On Windows, if PowerShell blocks `npm.ps1`, use:

```bash
npm.cmd install
npm.cmd run dev
```

If Rust or Cargo commands are unavailable, install Rust from `rustup` first:

```bash
winget install Rustlang.Rustup
rustup default stable
```

## Checks

Run the full local validation before publishing or changing plugins:

```bash
npm.cmd run check
```

For focused diagnostics, run individual checks:

```bash
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run plugin:validate
```

## Build

```bash
npm.cmd run build
npm.cmd run tauri:build
```

Tauri installers are generated under the configured Cargo target bundle directory.

Common output locations:

- Windows: `src-tauri/target/release/bundle/nsis/` or `src-tauri/target/release/bundle/msi/`
- macOS: `src-tauri/target/*/release/bundle/dmg/`

## Release To COS

COS credentials must be provided by environment variables or CI secrets. Do not write release credentials into project files.

The COS upload SDK is not installed by default to keep the public dependency tree clean. Install it only in the release environment when needed:

```bash
npm.cmd install --no-save cos-nodejs-sdk-v5@^2.15.4
```

```powershell
$env:TOOLDESK_COS_SECRET_ID="AKID..."
$env:TOOLDESK_COS_SECRET_KEY="..."
$env:TOOLDESK_COS_BUCKET="your-bucket-1250000000"
$env:TOOLDESK_COS_REGION="ap-beijing"
$env:TOOLDESK_COS_PREFIX="tooldesk/releases/win/"
$env:TOOLDESK_PUBLIC_BASE_URL="https://your-bucket-1250000000.cos.ap-beijing.myqcloud.com/"
$env:TOOLDESK_SUPABASE_URL="https://your-project.supabase.co"
$env:TOOLDESK_SUPABASE_ANON_KEY="your-supabase-anon-key"
```

Release app and all plugins:

```bash
npm.cmd run release:cos:all
```

For a full release checklist, see `docs/github-publish-checklist.md`.

## Local Configuration

Copy `tooldesk.config.example.json` to `tooldesk.config.json` only for local/private deployment needs. `tooldesk.config.json`, encrypted shared credentials and `.env*` files are ignored by Git.

Files with real credentials are ignored by Git as a last line of defense, but release credentials and third-party service secrets should still be stored in environment variables, CI secrets, or server-side function secrets.

For public releases, prefer the service gateway in `docs/service-gateway.md`. Client-side encrypted shared configuration is only a transitional option because the client still needs decrypt material at runtime.

## Service Gateway

OCR, translation, portable update downloads and cloud sync can be routed through `supabase/functions/tooldesk-services`, so the desktop client does not store third-party service secrets.

Configuration and deployment details are in `docs/service-gateway.md`.

## Extension Marketplace

tooldesk includes a public official extension marketplace manifest hosted on COS. The default marketplace URL points to a public `market.json` only; it does not contain cloud credentials or private release keys.

Maintainers can override or update the marketplace URL through `config/pluginMarketConfig.json` during private builds or release publishing. See `docs/plugin-market-publish.md`.

## Documentation

- `docs/README.md` - documentation index
- `docs/open-source-and-commercial-use.md` - open-source license, commercial use, attribution and trademark notes
- `docs/plugin-platform-standard.md` - plugin platform v1 standard
- `docs/plugin-api-reference.md` - plugin API reference
- `docs/privacy-and-data.md` - local data, sensitive storage and sync boundaries
- `docs/plugin-extraction-guide.md` - split built-in tools into plugins
- `docs/plugin-market-publish.md` - plugin marketplace publishing
- `docs/service-gateway.md` - Supabase service gateway
- `docs/github-publish-checklist.md` - public release checklist

## License

tooldesk is released under the MIT License. See `LICENSE`.

The MIT License allows private use, commercial use, modification and distribution, subject to the license terms. Third-party trademarks, service names and logos remain the property of their respective owners and are not licensed as part of the tooldesk project.

## Third-Party Services And Trademarks

tooldesk can integrate with local applications, browsers, mail providers, cloud services and developer APIs. Those names are used only to describe compatibility or user-configured integrations.

This project is not affiliated with, endorsed by, sponsored by, or officially connected with uTools, Obsidian, KeePassXC, QQ Mail, 139 Mail, 163 Mail, Chrome, Edge, Baidu, Tencent, Alibaba, Microsoft, Google or other third-party services unless explicitly stated by that service.

Do not use this repository's source code, screenshots, documentation or release assets to imply third-party endorsement.
