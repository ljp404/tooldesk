# Privacy And Data Boundaries

tooldesk is a local-first desktop application. Many tools work entirely on the user's machine, while some optional features call user-configured third-party services.

## Local Data Categories

| Data | Examples | Default Handling |
| --- | --- | --- |
| Preferences | theme, favorites, aliases, UI state | local app storage |
| Plugin data | common sites, HTTP collections, tool settings | plugin storage |
| Sensitive account data | mail authorization codes, SSH passwords, API tokens | local only; do not sync |
| Local content | clipboard history, screenshots, browser bookmarks, local files, KeePass entries | local only unless the user explicitly exports or copies it |
| Cloud/service credentials | OCR, translation, COS, Supabase, weather, Qiniu | environment variables, CI secrets, server-side function secrets, or private local config |

## Sync Rules

Only low-risk data should be added to `plugin.json.sync.localStorageKeys`.

Do not sync:

- cookies,
- access tokens,
- API tokens,
- mail authorization codes,
- SSH passwords,
- KeePass database paths, passwords or entry contents,
- machine-specific absolute paths,
- clipboard history,
- screenshots or captured images.

If a plugin needs sync, store syncable preferences separately from sensitive runtime credentials.

## Local Configuration

Use `tooldesk.config.example.json` as the public template. A real `tooldesk.config.json` is local/private and ignored by Git.

Encrypted shared config files such as `shared-credentials.enc.json` are also private release artifacts. Even encrypted files can reveal deployment structure and should not be committed to the public repository.

## Third-Party Requests

Plugins must use the host-provided `sendHttpRequest` capability for cross-origin HTTP requests. This keeps permissions visible in `plugin.json` and avoids hidden network behavior inside plugin iframes.

When adding a new service integration, document:

- what data is sent,
- what token or credential is required,
- where the token is stored,
- whether the feature can work through the service gateway instead of exposing third-party service keys in the desktop client.
