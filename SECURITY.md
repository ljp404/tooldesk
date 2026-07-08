# Security Policy

## Reporting a Vulnerability

Please do not open a public issue for sensitive security reports.

Report vulnerabilities by contacting the maintainer privately, and include:

- affected version or commit
- impact and attack scenario
- reproduction steps
- relevant logs or screenshots with secrets removed

## Secrets

Do not commit real API keys, cloud credentials, access tokens, encrypted secret payloads, or local release configuration.

Production credentials should be stored in environment variables, CI secrets, or server-side function secrets.

Local-only files such as `tooldesk.config.json`, `.env*`, `secrets.plain.json` and `shared-credentials*.json` must not be committed.

## Sensitive Local Data

Some tools can handle sensitive local data, including mail authorization codes, SSH credentials, API tokens, KeePass database contents, browser bookmarks and clipboard history.

- Do not include screenshots, logs or exported sync snapshots that contain sensitive user data in public issues.
- Do not add sensitive plugin storage keys to `plugin.json.sync.localStorageKeys`.
- Prefer operating-system credential storage or encrypted local storage for long-lived tokens and passwords.
- Cloud sync must exclude cookies, access tokens, mail authorization codes, SSH passwords and password database contents.

## Third-Party Services

Third-party service names and trademarks are used only to describe user-configured integrations. Security reports involving a third-party service should remove tokens, account identifiers and private URLs unless they are required for reproduction.
