import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(rootDir, 'plugins');
const appDataDir = path.join(os.homedir(), 'AppData', 'Roaming');
const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
const pluginSdkPath = path.join(rootDir, 'public', 'tooldesk-plugin-sdk.js');
const { validatePluginRoot } = await import(
  pathToFileURL(path.join(rootDir, 'dist/shared/plugin/validatePluginPackage.js')).href
);
const { injectPluginSdkIntoHtml } = await import(
  pathToFileURL(path.join(rootDir, 'dist/shared/plugin/pluginHtml.js')).href
);
const { inlinePluginVendorsForPlugin } = await import('./inline-plugin-vendor.mjs');
const { materializePluginDataBundles } = await import('./materialize-plugin-data.mjs');
const pluginSdkSource = fs.readFileSync(pluginSdkPath, 'utf-8');

function readTauriConfig() {
  try {
    return JSON.parse(fs.readFileSync(tauriConfigPath, 'utf-8'));
  } catch {
    return {};
  }
}

const tauriConfig = readTauriConfig();
const appIdentifier = typeof tauriConfig.identifier === 'string' ? tauriConfig.identifier.trim() : '';

if (!appIdentifier) {
  throw new Error('Missing Tauri identifier in src-tauri/tauri.conf.json');
}

const defaultTargetDataDir = path.join(appDataDir, appIdentifier);
const bootstrapConfigPath = path.join(defaultTargetDataDir, `${appIdentifier}-bootstrap.json`);

function listPluginRoots() {
  return fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(sourceDir, entry.name, 'plugin.json')))
    .map((entry) => path.join(sourceDir, entry.name));
}

function normalizeDirectoryPath(value) {
  if (typeof value !== 'string') {
    return '';
  }

  const trimmed = value.trim();

  if (!trimmed || !path.isAbsolute(trimmed)) {
    return '';
  }

  return path.resolve(trimmed);
}

function readConfiguredDataDir() {
  try {
    const raw = JSON.parse(fs.readFileSync(bootstrapConfigPath, 'utf-8'));
    const dataDir = normalizeDirectoryPath(raw.dataDir);

    if (dataDir) {
      return dataDir;
    }
  } catch {
    // No custom data directory is configured.
  }

  return '';
}

function listTargetPluginDirs() {
  return Array.from(
    new Set(
      [defaultTargetDataDir, readConfiguredDataDir()]
        .filter(Boolean)
        .map((dataDir) => path.join(path.resolve(dataDir), 'plugins'))
    )
  );
}

function listDevPluginTargets() {
  return [...listTargetPluginDirs(), path.join(rootDir, 'public', 'plugins')];
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
    fs.writeFileSync(entryPath, injectPluginSdkIntoHtml(html, pluginSdkSource), 'utf-8');
  }
}

function shouldCopyPluginPath(sourceRoot, targetDir, sourcePath) {
  const isStaticPluginTarget = path.resolve(targetDir) === path.join(rootDir, 'public', 'plugins');
  if (!isStaticPluginTarget) {
    return true;
  }

  const relativePath = path.relative(sourceRoot, sourcePath).replace(/\\/g, '/');
  return relativePath !== 'tools' && !relativePath.startsWith('tools/');
}

let installed = 0;
let failed = 0;
const targetDirs = listDevPluginTargets();

for (const sourceRoot of listPluginRoots()) {
  const pluginName = path.basename(sourceRoot);
  const validation = validatePluginRoot(sourceRoot);

  if (!validation.ok) {
    failed += 1;
    console.error(`[skip] ${pluginName}: ${validation.errors[0] ?? 'validation failed'}`);
    continue;
  }

  for (const targetDir of targetDirs) {
    fs.mkdirSync(targetDir, { recursive: true });
    const targetRoot = path.join(targetDir, pluginName);
    fs.rmSync(targetRoot, { force: true, recursive: true });
    fs.cpSync(sourceRoot, targetRoot, {
      filter: (sourcePath) => shouldCopyPluginPath(sourceRoot, targetDir, sourcePath),
      recursive: true
    });
    injectPluginSdk(targetRoot);
    inlinePluginVendorsForPlugin(targetRoot);
    materializePluginDataBundles(targetRoot);
  }

  installed += 1;
  console.info(`[install] ${pluginName}`);
}

console.info(`[sync-plugins] installed ${installed}, skipped ${failed}, targets ${targetDirs.join(', ')}`);

if (failed > 0) {
  process.exitCode = 1;
}
