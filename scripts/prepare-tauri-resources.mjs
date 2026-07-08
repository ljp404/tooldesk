import { createRequire } from 'node:module';
import { access, chmod, copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configDir = path.join(rootDir, 'config');
const generatedConfigDir = path.join(configDir, 'generated');
const cosUpdateConfigPath = path.join(generatedConfigDir, 'cosUpdate.json');
const cosSharedConfigPath = path.join(configDir, 'cosSharedConfig.json');
const pluginMarketConfigPath = path.join(generatedConfigDir, 'pluginMarketConfig.json');
const legacyCosUpdateConfigPath = path.join(configDir, 'cosUpdate.json');
const legacyPluginMarketConfigPath = path.join(configDir, 'pluginMarketConfig.json');
const releaseConfigPath = path.join(configDir, 'tooldesk.config.json');
const resourceDir = path.join(rootDir, 'src-tauri', 'resources');

function readEnv(name) {
  return String(process.env[name] ?? '').trim();
}

function normalizeUrl(value) {
  const trimmed = String(value ?? '').trim();

  if (!trimmed) {
    return '';
  }

  try {
    const url = new URL(trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : '';
  } catch {
    return '';
  }
}

function normalizeBaseUrl(value) {
  const normalized = normalizeUrl(value);

  if (!normalized) {
    return '';
  }

  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function joinUrl(baseUrl, pathPart) {
  if (!baseUrl) {
    return '';
  }

  return new URL(pathPart.replace(/^\/+/, ''), baseUrl).toString();
}

function resolveSupabaseFunctionUrl() {
  const serviceFunctionUrl = normalizeUrl(readEnv('TOOLDESK_SERVICE_FUNCTION_URL'));

  if (serviceFunctionUrl) {
    return serviceFunctionUrl;
  }

  const rawSupabaseUrl = readEnv('TOOLDESK_SUPABASE_URL');
  const normalizedSupabaseUrl = normalizeUrl(rawSupabaseUrl);

  if (!normalizedSupabaseUrl) {
    return '';
  }

  if (normalizedSupabaseUrl.includes('/functions/v1/')) {
    return normalizedSupabaseUrl;
  }

  const supabaseUrl = normalizeBaseUrl(normalizedSupabaseUrl);
  return joinUrl(supabaseUrl, 'functions/v1/tooldesk-services');
}

function buildServiceConfig() {
  return {
    apiKey: readEnv('TOOLDESK_SERVICE_API_KEY') || readEnv('TOOLDESK_SUPABASE_ANON_KEY'),
    clientToken: readEnv('TOOLDESK_SERVICE_CLIENT_TOKEN'),
    functionUrl: resolveSupabaseFunctionUrl()
  };
}

const SYSTEM_TOOL_IDS = ['screenshot', 'translator', 'super-clipboard', 'screen-recorder', 'static-server'];

async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyBundledPluginIcons() {
  const pluginsRoot = path.join(rootDir, 'plugins');
  const pluginIconsRoot = path.join(resourceDir, 'plugin-icons');

  if (!(await pathExists(pluginsRoot))) {
    return 0;
  }

  let copied = 0;
  await rm(pluginIconsRoot, { force: true, recursive: true });

  for (const entry of await readdir(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const pluginRoot = path.join(pluginsRoot, entry.name);
    const manifestPath = path.join(pluginRoot, 'plugin.json');

    if (!(await pathExists(manifestPath))) {
      continue;
    }

    const manifest = JSON.parse((await readFile(manifestPath, 'utf8')).replace(/^\uFEFF/, ''));
    const pluginId = String(manifest.id ?? entry.name).trim();

    if (!pluginId) {
      continue;
    }

    const targetDir = path.join(pluginIconsRoot, pluginId);
    await mkdir(targetDir, { recursive: true });

    for (const assetName of ['icon.svg', 'window-icon.png']) {
      const sourcePath = path.join(pluginRoot, 'assets', assetName);

      if (await pathExists(sourcePath)) {
        await copyFile(sourcePath, path.join(targetDir, assetName));
        copied += 1;
      }
    }
  }

  return copied;
}

async function copySystemToolIcons() {
  const systemToolIconsRoot = path.join(resourceDir, 'system-tool-icons');
  let copied = 0;

  for (const toolId of SYSTEM_TOOL_IDS) {
    const sourcePath = path.join(rootDir, 'src', 'tools', toolId, 'assets', 'window-icon.png');

    if (!(await pathExists(sourcePath))) {
      continue;
    }

    await mkdir(systemToolIconsRoot, { recursive: true });
    await copyFile(sourcePath, path.join(systemToolIconsRoot, `${toolId}.png`));
    copied += 1;
  }

  return copied;
}

async function resolveFfmpegPath() {
  try {
    const ffmpeg = require('@ffmpeg-installer/ffmpeg');
    if (ffmpeg?.path) {
      return ffmpeg.path;
    }
  } catch (error) {
    throw new Error(`无法解析 @ffmpeg-installer/ffmpeg：${error.message}`, { cause: error });
  }

  throw new Error('@ffmpeg-installer/ffmpeg 未返回可用的 ffmpeg 路径。');
}

async function main() {
  const source = await resolveFfmpegPath();
  await mkdir(resourceDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(generatedConfigDir, { recursive: true });

  const targets = ['ffmpeg', 'ffmpeg.exe'].map((name) => path.join(resourceDir, name));

  for (const target of targets) {
    await copyFile(source, target);
    await chmod(target, 0o755).catch(() => undefined);
  }

  console.log(`[tauri-resources] prepared ffmpeg from ${source}`);

  const pluginIconCount = await copyBundledPluginIcons();
  const systemToolIconCount = await copySystemToolIcons();
  console.log(
    `[tauri-resources] prepared bundled plugin icons (${pluginIconCount} file(s)) and system tool icons (${systemToolIconCount})`
  );

  const serviceConfig = buildServiceConfig();
  const releaseConfig = {
    serviceGateway: serviceConfig,
    syncCloud: {
      ...serviceConfig,
      bucket: 'tooldesk-sync'
    }
  };

  await writeFile(releaseConfigPath, `${JSON.stringify(releaseConfig, null, 2)}\n`, 'utf8');

  const publicBaseUrl = normalizeBaseUrl(readEnv('TOOLDESK_PUBLIC_BASE_URL'));
  const updatePublicBaseUrl = joinUrl(publicBaseUrl, 'tooldesk/releases/win/');
  const pluginMarketUrl = joinUrl(publicBaseUrl, 'tooldesk/plugins/market.json');

  await writeFile(
    cosUpdateConfigPath,
    `${JSON.stringify({ publicBaseUrl: updatePublicBaseUrl }, null, 2)}\n`,
    'utf8'
  );
  await writeFile(
    legacyCosUpdateConfigPath,
    `${JSON.stringify({ publicBaseUrl: updatePublicBaseUrl }, null, 2)}\n`,
    'utf8'
  );
  await writeFile(cosSharedConfigPath, `${JSON.stringify({ encryptedUrl: '' }, null, 2)}\n`, 'utf8');
  await writeFile(
    pluginMarketConfigPath,
    `${JSON.stringify({ marketUrl: pluginMarketUrl }, null, 2)}\n`,
    'utf8'
  );
  await writeFile(
    legacyPluginMarketConfigPath,
    `${JSON.stringify({ marketUrl: pluginMarketUrl }, null, 2)}\n`,
    'utf8'
  );

  const hasServiceGateway = Boolean(releaseConfig.serviceGateway.functionUrl);
  const hasSyncCloud = Boolean(releaseConfig.syncCloud.functionUrl);
  console.log(
    `[tauri-resources] prepared release config (serviceGateway=${hasServiceGateway ? 'yes' : 'no'}, syncCloud=${hasSyncCloud ? 'yes' : 'no'})`
  );
  console.log(
    `[tauri-resources] prepared public endpoints (update=${updatePublicBaseUrl ? 'yes' : 'no'}, pluginMarket=${pluginMarketUrl ? 'yes' : 'no'})`
  );
}

main().catch((error) => {
  console.error(`[tauri-resources] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
