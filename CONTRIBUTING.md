# Contributing

Thanks for helping improve tooldesk. This project is a Tauri, Vue 3 and TypeScript desktop toolbox with a local plugin platform.

## Development Setup

Install Node.js, npm, Rust and Cargo first.

```bash
npm install
npm run dev
```

On Windows, prefer `npm.cmd` if PowerShell blocks npm scripts:

```bash
npm.cmd install
npm.cmd run dev
```

## Checks

Run the standard checks before opening a pull request:

```bash
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run test
npm.cmd run plugin:validate
```

For Rust changes, also run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

## Plugin Changes

Plugins live under `plugins/*` and must follow `docs/plugin-platform-standard.md`.

- Use `TooldeskPlugin.create({ id, capabilities })`.
- Keep `plugin.json` permissions and HTML SDK capabilities aligned.
- Run `npm.cmd run plugin:validate` after plugin changes.
- Do not add secrets, tokens, cookies, private URLs or local machine paths to plugin files.

## Security And Secrets

Never commit real credentials or local release configuration.

Ignored private files include:

- `.env*`
- `tooldesk.config.json`
- `cos.publish*.json`
- `secrets.plain*.json`
- `shared-credentials*.json`

Third-party service secrets belong in environment variables, CI secrets or server-side function secrets.

## Pull Requests

Keep pull requests focused. Include:

- what changed,
- why it changed,
- checks you ran,
- screenshots for UI changes when useful.

Avoid unrelated formatting churn or broad refactors unless the pull request is specifically about that cleanup.
