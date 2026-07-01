# Desktop Architecture

Tooldesk desktop is built with Tauri v2, Vue 3 and TypeScript.

## Current Scope

- Vue/Vite owns the desktop UI.
- `npm run dev` starts the Tauri desktop development app.
- `npm run build` runs the Tauri production build.
- Native desktop capabilities are implemented through focused Rust commands in `src-tauri/`.
- The frontend Tauri bridge installs `window.tooldeskShortcut` as the single renderer-facing desktop API surface.

## Commands

```bash
npm run dev
npm run tauri:dev
npm run tauri:build
```

`npm run tauri:dev` bundles plugins into `public/plugins/` before starting Vite and Tauri. Production builds bundle plugins into `dist/plugins/`.

## Local Requirement

Tauri requires Rust and Cargo. On Windows, install them through `rustup`:

```powershell
winget install Rustlang.Rustup
rustup default stable
rustc --version
cargo --version
```

## GitHub Packaging

`.github/workflows/tauri-build.yml` provides a manual packaging workflow. It installs Node.js and Rust on GitHub-hosted runners, then builds:

- macOS Apple Silicon (`aarch64-apple-darwin`),
- macOS Intel (`x86_64-apple-darwin`),
- Windows x64.

The workflow uploads generated bundles as GitHub Actions artifacts. It can be started manually from Actions, or by pushing a tag that matches `tauri-v*`.

## Native Capability Coverage

Available in the Tauri desktop shell:

- app settings, plugin storage, data/cache directory selection and cache cleanup,
- local plugin listing, installation, uninstallation, marketplace installation and plugin SDK injection,
- plugin HTTP proxying, file APIs, browser bookmarks, local library, Docker and SSH operations,
- IMAP folder listing, mail fetching, read/unread mutation, deletion, attachment download and SMTP sending,
- KeePass database unlock/session handling,
- local music scanning/playback, metadata probing and migrated cloud music paths,
- encrypted super clipboard text/image/HTML history,
- global shortcuts, borderless quick launcher and quick tool windows,
- native tray menu, taskbar calendar hotzone and compact calendar popup,
- user-configured translation and OCR credential/recognition commands,
- screenshot region selection, pinned screenshot windows, scroll screenshot and region recording handoff,
- screen recording buffer saving and MP4/GIF transcoding through the prepared ffmpeg resource,
- update manifest checking, installer download, verification and install launch,
- encrypted cloud sync through the configured service gateway.

## Tauri Module Layout

The Rust side is split by native boundary:

- `src-tauri/src/lib.rs` wires Tauri plugins, managed runtime state and command registration.
- `src-tauri/src/storage.rs` owns app settings, data/cache directory configuration, plugin SDK storage and cache cleanup.
- `src-tauri/src/super_clipboard.rs` owns encrypted super clipboard history and query APIs.
- `src-tauri/src/plugins.rs` owns local plugin discovery, installation and SDK injection.
- `src-tauri/src/http_client.rs` owns the native HTTP proxy command.
- `src-tauri/src/file_ops.rs` owns file reads, writes, deletes, text export sessions and hosts operations.
- `src-tauri/src/browser_bookmarks.rs` owns Chromium-family bookmark discovery and parsing.
- `src-tauri/src/local_library.rs` owns local library listing, recursive search and file launch helpers.
- `src-tauri/src/docker_ops.rs` owns local Docker CLI command execution.
- `src-tauri/src/ssh_ops.rs` owns SSH password authentication, command execution and output events.
- `src-tauri/src/mail_ops.rs` owns IMAP/SMTP mail operations.
- `src-tauri/src/keepass_ops.rs` owns KeePass database unlock and session state.
- `src-tauri/src/global_shortcuts.rs` owns global shortcut registration and suspend/resume state.
- `src-tauri/src/tray.rs` owns the native tray icon and custom tray menu window.
- `src-tauri/src/taskbar_calendar.rs` owns the Windows taskbar-clock hotzone.
- `src-tauri/src/update_ops.rs` owns update checking, download and install launch.
- `src-tauri/src/music.rs` owns local music and migrated cloud music operations.
- `src-tauri/src/quick_tool.rs` owns quick tool window creation and startup content.
- `src-tauri/src/window.rs` owns main window creation.

Keep future native work in similarly focused Rust modules instead of growing `lib.rs`.

## Frontend Tauri Modules

- `src/tauri/tauriBridge.ts` wires `window.tooldeskShortcut`.
- `src/tauri/defaultSettings.ts` owns the default renderer-facing settings payload.
- `src/tauri/tauriStorage.ts` owns app settings, storage directories and plugin SDK storage.
- `src/tauri/tauriHttp.ts` owns the native HTTP command.
- `src/tauri/tauriClipboard.ts` owns text/image clipboard integration.
- `src/tauri/tauriSuperClipboard.ts` owns the super clipboard bridge.
- `src/tauri/tauriQuickTool.ts` owns quick tool windows and one-shot startup content.
- `src/tauri/tauriPlugins.ts` owns plugin listing/install/uninstall and change listeners.
- `src/tauri/tauriSsh.ts` owns SSH command invocation and output event subscription.
- `src/tauri/tauriMail.ts` owns mail plugin command invocation.
- `src/tauri/tauriKeepass.ts` owns KeePass command invocation.
- `src/tauri/tauriGlobalShortcuts.ts` owns shortcut sync/suspend/resume command invocation.
- `src/tauri/tauriMusic.ts` owns music bridge calls.
- `src/tauri/tauriSync.ts` owns local snapshot import/export and cloud sync.
- `src/tauri/tauriMediaSave.ts` owns screenshot/recording save helpers.

## Product Validation Areas

Recommended product validation checks before a public release:

- screenshot and screen-recording parity testing across multi-monitor and DPI setups,
- taskbar clock overlay focus/blur validation on more Windows configurations,
- scroll screenshot tuning for advanced toolbar controls and stitching reliability,
- cross-platform ffmpeg packaging validation on macOS CI runners,
- updater release publishing, signing and macOS install-flow validation.

## Verification

For a full Windows verification run:

```bash
npm run typecheck
npm run lint
npm run test
npm run plugin:validate
cargo clippy --manifest-path src-tauri/Cargo.toml -j 1 -- -D warnings
npm run tauri:build
```

## Windows Security Software Note

Cargo generates and immediately executes temporary build scripts under the target directory. Some Windows security software can block this pattern and make Cargo fail with:

```text
could not execute process ... build-script-build
Access is denied. (os error 5)
```

Close active protection temporarily or add trusted paths for the project, Cargo/Rustup directories and the selected Cargo target directory before running Rust checks or Tauri packaging.
