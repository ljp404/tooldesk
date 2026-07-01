import AdmZip from 'adm-zip';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadCosPublishConfig, resolveCosRegionFromPublicUrl } from './lib/cos-config.mjs';
import { loadCosSdk } from './lib/load-cos-sdk.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginPrefix = 'tooldesk/plugins/';
const marketKey = `${pluginPrefix}market.json`;
const pluginMarketConfigPath = path.join(rootDir, 'config', 'pluginMarketConfig.json');
const externalToolBundles = {
  'tooldesk-pdf-toolbox': {
    env: 'TOOLDESK_PDF_TOOLBOX_TOOLS_DIR',
    relativeTarget: 'tools',
    requiredFiles: [
      'windows/qpdf/bin/qpdf.exe'
    ],
    sourceCandidates: [
      path.join(rootDir, 'local-tools', 'tooldesk-pdf-toolbox', 'tools')
    ]
  }
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, ''));
}

function ensureSharedPluginHelpers() {
  const sourcePath = path.join(rootDir, 'src', 'shared', 'plugin', 'pluginHtml.ts');
  const outputPath = path.join(rootDir, 'dist', 'shared', 'plugin', 'pluginHtml.js');
  const shouldBuild =
    !fs.existsSync(outputPath) ||
    (fs.existsSync(sourcePath) && fs.statSync(sourcePath).mtimeMs > fs.statSync(outputPath).mtimeMs);

  if (!shouldBuild) {
    return;
  }

  const tscPath = path.join(rootDir, 'node_modules', 'typescript', 'bin', 'tsc');
  const result = spawnSync(process.execPath, [tscPath, '-p', 'tsconfig.shared.json'], {
    cwd: rootDir,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`build:shared 执行失败，退出码：${result.status ?? 'unknown'}`);
  }
}

function sanitizePluginId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
}

function normalizePluginPath(value) {
  const pluginPath = String(value ?? '').trim();

  if (!pluginPath) {
    throw new Error('请传入插件目录：npm run upload:plugin -- <plugin-dir>');
  }

  const resolved = path.resolve(rootDir, pluginPath);

  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error(`插件目录不存在：${resolved}`);
  }

  return resolved;
}

function resolvePublicBaseUrl(config) {
  if (config.publicBaseUrl?.trim()) {
    const parsed = new URL(config.publicBaseUrl);
    return `https://${parsed.host}/`;
  }

  return `https://${config.bucket}.cos.${config.region}.myqcloud.com/`;
}

function createPluginZip(pluginRoot, targetZipPath) {
  const zip = new AdmZip();

  function addDirectory(currentDir, relativeDir = '') {
    for (const name of fs.readdirSync(currentDir)) {
      const absolutePath = path.join(currentDir, name);
      const relativePath = path.posix.join(relativeDir.replace(/\\/g, '/'), name);

      if (fs.statSync(absolutePath).isDirectory()) {
        addDirectory(absolutePath, relativePath);
        continue;
      }

      zip.addLocalFile(absolutePath, path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath));
    }
  }

  addDirectory(pluginRoot);
  zip.writeZip(targetZipPath);
}

function validateExternalToolBundle(sourceRoot, bundle) {
  const missing = bundle.requiredFiles.filter((file) => !fs.existsSync(path.join(sourceRoot, ...file.split('/'))));

  if (missing.length > 0) {
    throw new Error(`外部工具包不完整：${sourceRoot}，缺少 ${missing.join(', ')}`);
  }
}

function resolveExternalToolBundleSource(pluginRoot, pluginId) {
  const bundle = externalToolBundles[pluginId];

  if (!bundle) {
    return null;
  }

  const embeddedToolsRoot = path.join(pluginRoot, bundle.relativeTarget);

  if (fs.existsSync(embeddedToolsRoot)) {
    validateExternalToolBundle(embeddedToolsRoot, bundle);
    return embeddedToolsRoot;
  }

  const candidates = [
    ...(process.env[bundle.env]?.trim() ? [process.env[bundle.env].trim()] : []),
    ...bundle.sourceCandidates
  ].map((candidate) => path.resolve(rootDir, candidate));
  const sourceRoot = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory());

  if (!sourceRoot) {
    throw new Error(
      [
        `${pluginId} 发布包缺少外部工具目录。`,
        `请将工具放到 ${path.relative(rootDir, bundle.sourceCandidates[0])}，或设置 ${bundle.env} 指向 tools 目录。`,
        `该目录会在上传 COS 时打进 plugin.zip，但不会提交到源码仓库。`
      ].join('')
    );
  }

  validateExternalToolBundle(sourceRoot, bundle);
  return sourceRoot;
}

function materializeExternalToolBundle(stageRoot, pluginRoot, pluginId) {
  const bundle = externalToolBundles[pluginId];

  if (!bundle) {
    return;
  }

  const sourceRoot = resolveExternalToolBundleSource(pluginRoot, pluginId);
  const targetRoot = path.join(stageRoot, bundle.relativeTarget);
  fs.rmSync(targetRoot, { force: true, recursive: true });
  fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
  fs.cpSync(sourceRoot, targetRoot, { recursive: true });
  console.info(`[plugin] bundled external tools for ${pluginId}: ${sourceRoot}`);
}

function getSha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

async function putObject(cos, target, key, body, contentType) {
  const cacheControl =
    key.endsWith('market.json') || key.endsWith('/plugin.zip') || key.endsWith('/plugin.json')
      ? 'no-cache, max-age=0'
      : 'public, max-age=31536000, immutable';

  await new Promise((resolve, reject) => {
    cos.putObject(
      {
        ACL: 'public-read',
        Body: body,
        Bucket: target.bucket,
        CacheControl: cacheControl,
        ContentType: contentType,
        Key: key,
        Region: target.region
      },
      (error, data) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(data);
      }
    );
  });
}

function getAssetContentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.svg':
      return 'image/svg+xml; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.ico':
      return 'image/x-icon';
    default:
      return 'application/octet-stream';
  }
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(String(value ?? ''));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isSafeRelativeAssetPath(value) {
  const normalized = String(value ?? '').trim().replace(/\\/g, '/');

  return (
    normalized &&
    !normalized.startsWith('/') &&
    !normalized.startsWith('./') &&
    !normalized.includes('..') &&
    /\.(?:svg|png|webp|jpe?g|ico)$/i.test(normalized)
  );
}

async function uploadPluginMarketAsset(cos, target, pluginRoot, publicBaseUrl, objectBaseKey, assetPath) {
  const normalizedPath = String(assetPath ?? '').trim().replace(/\\/g, '/');

  if (!normalizedPath || isHttpUrl(normalizedPath) || !isSafeRelativeAssetPath(normalizedPath)) {
    return normalizedPath;
  }

  const sourcePath = path.join(pluginRoot, ...normalizedPath.split('/'));

  if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
    return normalizedPath;
  }

  const assetKey = `${objectBaseKey}${normalizedPath}`;
  await putObject(cos, target, assetKey, fs.readFileSync(sourcePath), getAssetContentType(sourcePath));
  return `${publicBaseUrl}${assetKey}`;
}

function syncPluginMarketConfig(marketUrl) {
  fs.mkdirSync(path.dirname(pluginMarketConfigPath), { recursive: true });
  fs.writeFileSync(pluginMarketConfigPath, `${JSON.stringify({ marketUrl }, null, 2)}\n`);
}

async function getObjectText(cos, target, key) {
  return new Promise((resolve) => {
    cos.getObject(
      {
        Bucket: target.bucket,
        Key: key,
        Region: target.region
      },
      (error, data) => {
        if (error || !data.Body) {
          resolve('');
          return;
        }

        resolve(Buffer.from(data.Body).toString('utf-8'));
      }
    );
  });
}

function normalizeMarketCatalog(raw) {
  if (!raw.trim()) {
    return {
      plugins: [],
      updatedAt: '',
      version: 1
    };
  }

  const parsed = JSON.parse(raw);

  return {
    plugins: Array.isArray(parsed.plugins) ? parsed.plugins : Array.isArray(parsed.items) ? parsed.items : [],
    updatedAt: String(parsed.updatedAt ?? ''),
    version: Number(parsed.version) || 1
  };
}

async function main() {
  ensureSharedPluginHelpers();

  const COS = await loadCosSdk();
  const pluginRoot = normalizePluginPath(process.argv[2]);
  const manifestPath = path.join(pluginRoot, 'plugin.json');

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`插件目录缺少 plugin.json：${manifestPath}`);
  }

  const manifest = readJson(manifestPath);
  const pluginId = sanitizePluginId(manifest.id);
  const version = String(manifest.version ?? '').trim();

  if (!pluginId || !String(manifest.name ?? '').trim() || !version || !String(manifest.entry ?? '').trim()) {
    throw new Error('plugin.json 缺少 id / name / version / entry');
  }

  const config = loadCosPublishConfig();
  const region = config.region || resolveCosRegionFromPublicUrl(config.publicBaseUrl);
  const publicBaseUrl = resolvePublicBaseUrl(config);
  const marketUrl = `${publicBaseUrl}${marketKey}`;
  const objectBaseKey = `${pluginPrefix}${pluginId}/${version}/`;
  const zipKey = `${objectBaseKey}plugin.zip`;
  const manifestKey = `${objectBaseKey}plugin.json`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tooldesk-plugin-publish-'));
  const zipPath = path.join(tempDir, 'plugin.zip');

  if (!region) {
    throw new Error('COS region 无效');
  }

  const target = {
    bucket: config.bucket,
    region
  };
  const cos = new COS({
    SecretId: config.secretId,
    SecretKey: config.secretKey
  });

  try {
    const stageRoot = path.join(tempDir, 'plugin-stage');
    const pluginSdkSource = fs.readFileSync(path.join(rootDir, 'public', 'tooldesk-plugin-sdk.js'), 'utf-8');
    const { injectPluginSdkIntoHtml } = await import(
      pathToFileURL(path.join(rootDir, 'dist/shared/plugin/pluginHtml.js')).href
    );
    const { inlinePluginVendorsForPlugin } = await import('./inline-plugin-vendor.mjs');
    const { materializePluginDataBundles } = await import('./materialize-plugin-data.mjs');

    fs.rmSync(stageRoot, { force: true, recursive: true });
    fs.cpSync(pluginRoot, stageRoot, { recursive: true });

    const htmlPath = path.join(stageRoot, 'index.html');

    if (fs.existsSync(htmlPath)) {
      fs.writeFileSync(htmlPath, injectPluginSdkIntoHtml(fs.readFileSync(htmlPath, 'utf-8'), pluginSdkSource), 'utf-8');
    }

    inlinePluginVendorsForPlugin(stageRoot);
    materializePluginDataBundles(stageRoot);
    materializeExternalToolBundle(stageRoot, pluginRoot, pluginId);
    createPluginZip(stageRoot, zipPath);
    const sha256 = getSha256(zipPath);
    const downloadUrl = `${publicBaseUrl}${zipKey}`;
    const manifestUrl = `${publicBaseUrl}${manifestKey}`;
    const iconUrl = await uploadPluginMarketAsset(
      cos,
      target,
      pluginRoot,
      publicBaseUrl,
      objectBaseKey,
      manifest.icon ?? ''
    );
    const windowIconUrl = manifest.windowIcon
      ? await uploadPluginMarketAsset(cos, target, pluginRoot, publicBaseUrl, objectBaseKey, manifest.windowIcon)
      : '';

    await putObject(cos, target, zipKey, fs.readFileSync(zipPath), 'application/zip');
    await putObject(cos, target, manifestKey, fs.readFileSync(manifestPath), 'application/json; charset=utf-8');

    const marketRaw = await getObjectText(cos, target, marketKey);
    const market = normalizeMarketCatalog(marketRaw);
    const item = {
      accent: String(manifest.accent ?? 'blue'),
      caption: String(manifest.caption ?? manifest.name),
      category: String(manifest.category ?? 'dev'),
      defaultAlias: String(manifest.defaultAlias ?? pluginId),
      downloadUrl,
      icon: String(iconUrl || manifest.icon || 'toolbox'),
      keywords: Array.isArray(manifest.keywords) ? manifest.keywords : [],
      label: String(manifest.name),
      manifestUrl,
      permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
      pluginId,
      publisher: String(manifest.publisher ?? 'tooldesk'),
      sha256,
      trusted: true,
      trustLevel: 'official',
      updatedAt: new Date().toISOString(),
      version,
      ...(manifest.windowIcon ? { windowIcon: String(windowIconUrl || manifest.windowIcon) } : {})
    };
    const plugins = market.plugins.filter((plugin) => sanitizePluginId(plugin.pluginId ?? plugin.id) !== pluginId);
    const nextMarket = {
      plugins: [...plugins, item].sort((current, next) =>
        String(current.label ?? '').localeCompare(String(next.label ?? ''), 'zh-Hans-CN')
      ),
      updatedAt: new Date().toISOString(),
      version: market.version
    };

    await putObject(cos, target, marketKey, Buffer.from(`${JSON.stringify(nextMarket, null, 2)}\n`, 'utf-8'), 'application/json; charset=utf-8');

    console.info(`[plugin] uploaded ${pluginId}@${version}`);
    console.info(`[plugin] package: ${downloadUrl}`);
    console.info(`[plugin] market: ${marketUrl}`);
    syncPluginMarketConfig(marketUrl);
    console.info(`[plugin] config/pluginMarketConfig.json marketUrl = ${marketUrl}`);
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
}

main().catch((error) => {
  console.error('[plugin] 上传失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});
