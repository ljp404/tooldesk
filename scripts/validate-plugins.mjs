import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = path.join(rootDir, 'plugins');
const localToolsDir = path.join(rootDir, 'local-tools');
const validatorPath = path.join(rootDir, 'dist/shared/plugin/validatePluginPackage.js');
const allowMissingExternalTools = process.env.CI === 'true';

const { validatePluginRoot } = await import(pathToFileURL(validatorPath).href);

function listPluginRoots() {
  if (!fs.existsSync(pluginsDir)) {
    return [];
  }

  return fs
    .readdirSync(pluginsDir)
    .map((name) => path.join(pluginsDir, name))
    .filter((candidate) => fs.statSync(candidate).isDirectory() && fs.existsSync(path.join(candidate, 'plugin.json')));
}

const roots = listPluginRoots();
let failed = 0;

function readPluginManifest(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf-8').replace(/^\uFEFF/, ''));
  } catch {
    return null;
  }
}

function hasLocalNativeToolAsset(pluginId, relativePath) {
  if (!pluginId || typeof relativePath !== 'string') {
    return false;
  }

  const normalized = relativePath.trim();
  if (!normalized || path.isAbsolute(normalized) || normalized.replace(/\\/g, '/').includes('..')) {
    return false;
  }

  const candidate = path.resolve(localToolsDir, pluginId, normalized);
  const localRoot = path.resolve(localToolsDir, pluginId);

  if (!candidate.startsWith(`${localRoot}${path.sep}`)) {
    return false;
  }

  try {
    return fs.existsSync(candidate) && fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function filterLocalNativeToolErrors(root, errors) {
  const manifest = readPluginManifest(root);

  if (!manifest || !manifest.nativeTools || typeof manifest.nativeTools !== 'object' || Array.isArray(manifest.nativeTools)) {
    return errors;
  }

  const pluginId = String(manifest.id ?? '').trim();

  return errors.filter((error) => {
    const match = error.match(/^plugin\.json: nativeTools\.([a-z0-9._-]+) asset is missing$/i);

    if (!match) {
      return true;
    }

    return !allowMissingExternalTools && !hasLocalNativeToolAsset(pluginId, manifest.nativeTools[match[1]]);
  });
}

for (const root of roots) {
  const result = validatePluginRoot(root);
  const label = path.basename(root);
  const errors = filterLocalNativeToolErrors(root, result.errors);

  if (errors.length === 0) {
    console.info(`[ok] ${label}`);
    continue;
  }

  failed += 1;
  console.error(`[fail] ${label}`);

  for (const error of errors) {
    console.error(`  - ${error}`);
  }
}

if (failed > 0) {
  process.exitCode = 1;
}

console.info(`[validate-plugins] checked ${roots.length} plugins, failed ${failed}`);
