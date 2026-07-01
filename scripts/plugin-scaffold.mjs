import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const templateRoot = path.join(rootDir, 'docs', 'plugin-template');
const pluginsDir = path.join(rootDir, 'plugins');

const pluginIdArg = process.argv[2];

if (!pluginIdArg) {
  console.error('Usage: node scripts/plugin-scaffold.mjs tooldesk-your-plugin-name');
  process.exitCode = 1;
  process.exit(1);
}

const pluginId = pluginIdArg.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-');
const targetRoot = path.join(pluginsDir, pluginId);

if (fs.existsSync(targetRoot)) {
  console.error(`Plugin directory already exists: ${targetRoot}`);
  process.exitCode = 1;
  process.exit(1);
}

const templateManifest = JSON.parse(fs.readFileSync(path.join(templateRoot, 'plugin.json'), 'utf-8'));
const templateHtml = fs.readFileSync(path.join(templateRoot, 'index.html'), 'utf-8');
const displayName = pluginId.replace(/^tooldesk-/, '').replace(/-/g, ' ');

templateManifest.id = pluginId;
templateManifest.name = displayName.charAt(0).toUpperCase() + displayName.slice(1);
templateManifest.defaultAlias = pluginId.replace(/^tooldesk-/, '').slice(0, 12);
templateManifest.capabilities = ['copyText'];

const html = templateHtml
  .replace(/tooldesk-plugin-starter/g, pluginId)
  .replace(/插件 Starter/g, templateManifest.name);

fs.mkdirSync(targetRoot, { recursive: true });
fs.writeFileSync(path.join(targetRoot, 'plugin.json'), `${JSON.stringify(templateManifest, null, 2)}\n`, 'utf-8');
fs.writeFileSync(path.join(targetRoot, 'index.html'), html, 'utf-8');

console.info(`[plugin:scaffold] created ${targetRoot}`);
console.info(`[plugin:scaffold] next: npm.cmd run plugin:icons -- --plugin ${pluginId}`);
console.info('[plugin:scaffold] then: npm.cmd run plugin:validate');
