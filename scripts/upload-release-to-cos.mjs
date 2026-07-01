import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCosPublishConfig, getReleaseDir, listReleaseArtifacts } from './lib/cos-config.mjs';
import { loadCosSdk } from './lib/load-cos-sdk.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, ''));
}

function readReleaseVersion() {
  const tauriConfigPath = path.join(rootDir, 'src-tauri', 'tauri.conf.json');
  const packageJsonPath = path.join(rootDir, 'package.json');

  if (fs.existsSync(tauriConfigPath)) {
    const version = readJson(tauriConfigPath).version;
    if (version) return String(version);
  }

  return String(readJson(packageJsonPath).version);
}

function fileSha512Base64(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64');
}

function findInstallerArtifact(releaseDir, version) {
  const names = fs.readdirSync(releaseDir, { recursive: true }).map((name) => String(name).replace(/\\/g, '/'));
  const installers = names
    .filter((name) => /(^|\/).*(-setup\.exe|\.msi)$/i.test(name))
    .filter((name) => fs.statSync(path.join(releaseDir, name)).isFile())
    .sort((current, next) => {
      const currentIsNsis = /^nsis\/.*-setup\.exe$/i.test(current) ? 0 : 1;
      const nextIsNsis = /^nsis\/.*-setup\.exe$/i.test(next) ? 0 : 1;
      if (currentIsNsis !== nextIsNsis) return currentIsNsis - nextIsNsis;
      return next.localeCompare(current, 'en');
    });

  return installers.find((name) => name.includes(version)) || installers[0] || '';
}

function writeLatestManifest(releaseDir) {
  const version = readReleaseVersion();
  const artifactName = findInstallerArtifact(releaseDir, version);

  if (!artifactName) {
    throw new Error('release 目录缺少 Tauri 安装包，无法生成 latest.yml');
  }

  const artifactPath = path.join(releaseDir, artifactName);
  const sha512 = fileSha512Base64(artifactPath);
  const size = fs.statSync(artifactPath).size;
  const manifest = [
    `version: ${version}`,
    'files:',
    `  - url: ${artifactName}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${artifactName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    ''
  ].join('\n');

  fs.writeFileSync(path.join(releaseDir, 'latest.yml'), manifest, 'utf-8');
  console.info(`[cos] generated latest.yml -> ${artifactName}`);
}

function getCacheControl(fileName) {
  if (/^latest.*\.yml$/i.test(fileName)) {
    return 'no-cache, max-age=0';
  }

  return 'public, max-age=31536000, immutable';
}

function getContentType(fileName) {
  if (fileName.endsWith('.yml')) {
    return 'text/yaml; charset=utf-8';
  }

  if (fileName.endsWith('.blockmap')) {
    return 'application/octet-stream';
  }

  return 'application/octet-stream';
}

async function uploadFile(cos, config, artifact) {
  const key = `${config.prefix}${artifact.name}`;
  const body = fs.readFileSync(artifact.localPath);

  await new Promise((resolve, reject) => {
    cos.putObject(
      {
        ACL: 'public-read',
        Body: body,
        Bucket: config.bucket,
        CacheControl: getCacheControl(artifact.name),
        ContentDisposition: 'attachment',
        ContentType: getContentType(artifact.name),
        Key: key,
        Region: config.region
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

  const url = `${config.publicBaseUrl}${artifact.name}`;
  console.info(`[cos] uploaded ${artifact.name} -> ${url}`);
}

async function main() {
  const COS = await loadCosSdk();
  const config = loadCosPublishConfig();
  const releaseDir = getReleaseDir();
  writeLatestManifest(releaseDir);
  const artifacts = listReleaseArtifacts(releaseDir);

  const cos = new COS({
    SecretId: config.secretId,
    SecretKey: config.secretKey
  });

  console.info(`[cos] bucket=${config.bucket} region=${config.region} prefix=${config.prefix}`);

  for (const artifact of artifacts) {
    await uploadFile(cos, config, artifact);
  }

  console.info(`[cos] 完成，客户端更新地址: ${config.publicBaseUrl}latest.yml`);
}

main().catch((error) => {
  console.error('[cos] 上传失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});
