import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

/** 从 COS 公网 URL 解析区域，如 ap-beijing */
export function resolveCosRegionFromPublicUrl(publicBaseUrl) {
  const match = String(publicBaseUrl ?? '').match(/\.cos\.([a-z0-9-]+)\.myqcloud\.com/i);
  return match?.[1]?.trim() ?? '';
}

function assertValidTencentCredentials(secretId, secretKey, filePath) {
  const id = String(secretId ?? '').trim();
  const key = String(secretKey ?? '').trim();
  const label = filePath ? `（${path.basename(filePath)}）` : '';

  if (!id || !key) {
    throw new Error(
      `缺少腾讯云 API 密钥${label}。secretId 以 AKID 开头，secretKey 为控制台「SecretKey」完整字符串（不是 APPID、也不是把 SecretId 填进 secretKey）`
    );
  }

  if (/^AKID/i.test(key) && !/^AKID/i.test(id)) {
    throw new Error(
      `密钥字段填反了${label}：请把以 AKID 开头的值放到 secretId，把另一条 SecretKey 放到 secretKey（1251042885 这类纯数字是 APPID，不能当 secretId）`
    );
  }

  if (!/^AKID/i.test(id)) {
    throw new Error(
      `secretId 格式无效${label}：必须以 AKID 开头。请到腾讯云「访问管理 → API 密钥」复制 SecretId，勿填 APPID`
    );
  }

  if (key.length < 20) {
    throw new Error(`secretKey 过短${label}，请填写控制台完整的 SecretKey`);
  }
}

function normalizePrefix(prefix) {
  const trimmed = String(prefix ?? 'tooldesk/releases/win/').trim();

  if (!trimmed) {
    return 'tooldesk/releases/win/';
  }

  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

function normalizePublicUrl(url) {
  const trimmed = String(url).trim();

  if (!trimmed) {
    throw new Error('publicBaseUrl 不能为空');
  }

  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`;
}

export function resolveCosPublicBaseUrl(config) {
  if (config.publicBaseUrl?.trim()) {
    return normalizePublicUrl(config.publicBaseUrl);
  }

  if (!config.bucket?.trim() || !config.region?.trim()) {
    throw new Error('请配置 publicBaseUrl，或填写 bucket + region');
  }

  const prefix = normalizePrefix(config.prefix);
  return normalizePublicUrl(`https://${config.bucket}.cos.${config.region}.myqcloud.com/${prefix}`);
}

function loadCosPublishConfigFromEnv() {
  const secretId = process.env.TOOLDESK_COS_SECRET_ID?.trim();
  const secretKey = process.env.TOOLDESK_COS_SECRET_KEY?.trim();
  const bucket = process.env.TOOLDESK_COS_BUCKET?.trim();
  const region = process.env.TOOLDESK_COS_REGION?.trim();

  if (!secretId || !secretKey || !bucket || !region) {
    return null;
  }

  assertValidTencentCredentials(secretId, secretKey);

  const config = {
    bucket,
    prefix: process.env.TOOLDESK_COS_PREFIX,
    publicBaseUrl: process.env.TOOLDESK_COS_PUBLIC_BASE_URL,
    region,
    secretId,
    secretKey
  };

  return {
    bucket,
    prefix: normalizePrefix(config.prefix),
    publicBaseUrl: resolveCosPublicBaseUrl(config),
    region,
    secretId,
    secretKey
  };
}

export function loadCosPublishConfig() {
  const fromEnv = loadCosPublishConfigFromEnv();

  if (fromEnv) {
    return fromEnv;
  }

  throw new Error('未找到 COS 发布配置，请设置 TOOLDESK_COS_SECRET_ID / TOOLDESK_COS_SECRET_KEY / TOOLDESK_COS_BUCKET / TOOLDESK_COS_REGION 环境变量');
}

export function loadCosUpdatePublicUrl() {
  const updateConfigPath = path.join(rootDir, 'config/cosUpdate.json');

  if (!fs.existsSync(updateConfigPath)) {
    throw new Error('未找到 config/cosUpdate.json，请填写 publicBaseUrl');
  }

  const config = readJson(updateConfigPath);
  return normalizePublicUrl(config.publicBaseUrl);
}

export function getReleaseDir() {
  return path.join(rootDir, 'src-tauri', 'target', 'release', 'bundle');
}

export function listReleaseArtifacts(releaseDir) {
  if (!fs.existsSync(releaseDir)) {
    throw new Error(`release 目录不存在: ${releaseDir}，请先执行 npm run tauri:build`);
  }

  const names = fs.readdirSync(releaseDir, { recursive: true }).map((name) => String(name).replace(/\\/g, '/'));
  const latestName = names.find((name) => /^latest.*\.yml$/i.test(name));
  const latestVersion = latestName
    ? fs
        .readFileSync(path.join(releaseDir, latestName), 'utf-8')
        .split(/\r?\n/)
        .find((line) => line.trim().startsWith('version:'))
        ?.split(':')
        .slice(1)
        .join(':')
        .trim()
        .replace(/^['"]|['"]$/g, '')
    : '';
  const patterns = [
    /^latest.*\.yml$/i,
    /^nsis\/.*-setup\.exe$/i,
    /^nsis\/.*-setup\.exe\.sig$/i,
    /^msi\/.*\.msi$/i,
    /^msi\/.*\.msi\.sig$/i,
    /^tooldesk-Setup-.*\.exe$/i,
    /^tooldesk-Setup-.*\.exe\.blockmap$/i,
    /^tooldesk-Portable-.*\.exe$/i
  ];

  const files = names.filter((name) => patterns.some((pattern) => pattern.test(name)));
  const currentFiles = latestVersion
    ? files.filter((name) => /^latest.*\.yml$/i.test(name) || name.includes(latestVersion))
    : files;

  if (!currentFiles.some((name) => /^latest.*\.yml$/i.test(name))) {
    throw new Error('release 目录缺少 latest.yml，请使用 Tauri updater/NSIS 目标打包');
  }

  if (!currentFiles.some((name) => /(^|\/).*-setup\.exe$/i.test(name) || /(^|\/).*\.msi$/i.test(name))) {
    throw new Error('release 目录缺少 Tauri 安装包');
  }

  return currentFiles.map((name) => ({
    localPath: path.join(releaseDir, name),
    name
  }));
}
