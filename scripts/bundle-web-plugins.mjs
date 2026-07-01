import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDir, '..');
const pluginsRoot = path.join(projectRoot, 'plugins');
const distRoot = path.join(projectRoot, 'dist');
const publicRoot = path.join(projectRoot, 'public');
const targetArg = process.argv.find((arg) => arg.startsWith('--target='));
const targetName = targetArg?.slice('--target='.length) === 'public' ? 'public' : 'dist';
const targetRoot = targetName === 'public' ? publicRoot : distRoot;
const targetPluginsRoot = path.join(targetRoot, 'plugins');
const pluginSdkPath = path.join(projectRoot, 'public', 'tooldesk-plugin-sdk.js');
const pluginSdkSource = fs.existsSync(pluginSdkPath)
  ? fs.readFileSync(pluginSdkPath, 'utf-8').replace(/^\uFEFF/, '').trim()
  : '';
const { inlinePluginVendorsForPlugin } = await import('./inline-plugin-vendor.mjs');
const { materializePluginDataBundles } = await import('./materialize-plugin-data.mjs');

const pluginCategories = new Set(['text', 'dev', 'image', 'json', 'finance', 'life', 'document']);
const pluginPermissions = new Set([
  'browser-bookmarks',
  'clipboard',
  'docker',
  'filesystem',
  'hosts',
  'http',
  'mail',
  'keepass',
  'local-library',
  'music',
  'native-tool',
  'ssh'
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, ''));
}

function sanitizePluginId(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeCategory(value) {
  const category = String(value ?? '').trim();
  return pluginCategories.has(category) ? category : 'dev';
}

function normalizePermissions(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter((item) => pluginPermissions.has(item))
    : [];
}

function normalizeCapabilities(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
}

function normalizeSync(value) {
  const localStorageKeys = Array.isArray(value?.localStorageKeys)
    ? value.localStorageKeys
        .map((item) => String(item ?? '').trim())
        .filter((item) => /^[a-z0-9._:-]{3,120}$/i.test(item))
    : [];

  return localStorageKeys.length ? { localStorageKeys } : undefined;
}

function normalizeClipboardMatchEntry(value) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const type = String(value.type ?? '').trim();
  if (!type) {
    return null;
  }

  const normalized = { type };
  if (typeof value.priority === 'number' && Number.isFinite(value.priority)) {
    normalized.priority = Math.trunc(value.priority);
  }

  return normalized;
}

function normalizeClipboardMatch(value) {
  const entries = Array.isArray(value) ? value : value && typeof value === 'object' ? [value] : [];
  const normalized = entries.map(normalizeClipboardMatchEntry).filter(Boolean);

  return normalized.length ? normalized : undefined;
}

function resolvePluginAsset(root, relativePath) {
  const resolved = path.resolve(root, relativePath);
  const relative = path.relative(root, resolved);

  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }

  return fs.existsSync(resolved) ? resolved : null;
}

function toWebPluginUrl(pluginId, relativePath) {
  return `./plugins/${pluginId}/${relativePath.replace(/\\/g, '/')}`;
}

function normalizePluginManifest(manifest, root) {
  const pluginId = sanitizePluginId(manifest.id);
  const name = String(manifest.name ?? '').trim();
  const version = String(manifest.version ?? '').trim();
  const entry = String(manifest.entry ?? '').trim();

  if (!pluginId || !name || !version || !entry || !resolvePluginAsset(root, entry)) {
    return null;
  }

  const settingsEntry = String(manifest.settings?.entry ?? '').trim();
  const settings = settingsEntry && resolvePluginAsset(root, settingsEntry)
    ? {
        accent: String(manifest.settings?.accent ?? manifest.accent ?? 'blue').trim() || 'blue',
        entryUrl: toWebPluginUrl(pluginId, settingsEntry),
        icon: String(manifest.settings?.icon ?? manifest.icon ?? 'toolbox').trim() || 'toolbox',
        label: String(manifest.settings?.label ?? `${name} 设置`).trim() || `${name} 设置`
      }
    : undefined;

  return {
    accent: String(manifest.accent ?? 'blue').trim() || 'blue',
    capabilities: normalizeCapabilities(manifest.capabilities),
    caption: String(manifest.caption ?? `插件 ${name}`).trim() || `插件 ${name}`,
    category: normalizeCategory(manifest.category),
    clipboardMatch: normalizeClipboardMatch(manifest.clipboardMatch),
    defaultAlias: String(manifest.defaultAlias ?? pluginId).trim() || pluginId,
    entryUrl: toWebPluginUrl(pluginId, entry),
    icon: String(manifest.icon ?? 'toolbox').trim() || 'toolbox',
    key: `plugin:${pluginId}`,
    keywords: Array.isArray(manifest.keywords) ? manifest.keywords.map((item) => String(item)) : [],
    label: name,
    manifestVersion: version,
    permissions: normalizePermissions(manifest.permissions),
    pluginId,
    settings,
    source: 'plugin',
    sync: normalizeSync(manifest.sync),
    ...(manifest.windowIcon ? { windowIcon: String(manifest.windowIcon).trim() } : {})
  };
}

function copyPlugin(pluginId, sourceRoot) {
  const targetPluginRoot = path.join(targetPluginsRoot, pluginId);
  fs.rmSync(targetPluginRoot, { force: true, recursive: true });
  fs.mkdirSync(path.dirname(targetPluginRoot), { recursive: true });
  fs.cpSync(sourceRoot, targetPluginRoot, {
    filter: (sourcePath) => {
      const relativePath = path.relative(sourceRoot, sourcePath).replace(/\\/g, '/');
      return relativePath !== 'tools' && !relativePath.startsWith('tools/');
    },
    recursive: true
  });
  injectPluginSdk(targetPluginRoot);
  inlinePluginVendorsForPlugin(targetPluginRoot);
  materializePluginDataBundles(targetPluginRoot);
}

function escapeInlineScriptSource(source) {
  return source.replace(/<\/script/gi, '<\\/script');
}

const pluginGlobalStyleTag = `<style data-tooldesk-global-style="1">
textarea:focus,
textarea:focus-visible,
input:not([type='checkbox'], [type='radio'], [type='range'], [type='file'], [type='color']):focus,
input:not([type='checkbox'], [type='radio'], [type='range'], [type='file'], [type='color']):focus-visible {
  border-color: var(--panel-border, #dbe4ef) !important;
  box-shadow: none !important;
  outline: none !important;
}
</style>`;

function injectPluginSdkIntoHtml(html) {
  const stripped = html
    .replace(/<style\b[^>]*data-tooldesk-global-style=["']1["'][^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[^>]*data-tooldesk-sdk=["']1["'][^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<script\b[^>]*tooldesk-plugin-sdk\.js[^>]*>\s*<\/script>/gi, '')
    .replace(/<script\b[^>]*tooldesk-plugin-sdk\.js[^>]*\/>/gi, '');
  const scriptTag = pluginSdkSource ? `<script data-tooldesk-sdk="1">${escapeInlineScriptSource(pluginSdkSource)}</script>` : '';
  const headInjection = `${pluginGlobalStyleTag}${scriptTag}`;

  if (/<head\b[^>]*>/i.test(stripped)) {
    return stripped.replace(/<head(\b[^>]*)>/i, `<head$1>${headInjection}`);
  }

  return `${headInjection}${stripped}`;
}

function injectPluginSdk(root) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      injectPluginSdk(entryPath);
      continue;
    }

    if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.html') {
      continue;
    }

    const html = fs.readFileSync(entryPath, 'utf-8');
    fs.writeFileSync(entryPath, injectPluginSdkIntoHtml(html), 'utf-8');
  }
}

function main() {
  if (!fs.existsSync(targetRoot)) {
    fs.mkdirSync(targetRoot, { recursive: true });
  }

  if (targetName === 'dist' && !fs.existsSync(distRoot)) {
    throw new Error('dist 目录不存在，请先运行 vite build');
  }

  fs.rmSync(targetPluginsRoot, { force: true, recursive: true });
  fs.mkdirSync(targetPluginsRoot, { recursive: true });

  const plugins = [];

  if (fs.existsSync(pluginsRoot)) {
    for (const name of fs.readdirSync(pluginsRoot)) {
      const root = path.join(pluginsRoot, name);
      const manifestPath = path.join(root, 'plugin.json');

      if (!fs.statSync(root).isDirectory() || !fs.existsSync(manifestPath)) {
        continue;
      }

      const manifest = readJson(manifestPath);
      const registration = normalizePluginManifest(manifest, root);

      if (!registration) {
        console.warn(`[web-plugins] skipped invalid plugin: ${name}`);
        continue;
      }

      copyPlugin(registration.pluginId, root);
      plugins.push(registration);
    }
  }

  plugins.sort((current, next) => current.label.localeCompare(next.label, 'zh-CN'));

  fs.writeFileSync(
    path.join(targetPluginsRoot, 'manifest.json'),
    `${JSON.stringify({ plugins, updatedAt: new Date().toISOString(), version: 1 }, null, 2)}\n`,
    'utf-8'
  );

  console.log(`[web-plugins] bundled ${plugins.length} plugin(s) to ${targetName}`);
}

main();
