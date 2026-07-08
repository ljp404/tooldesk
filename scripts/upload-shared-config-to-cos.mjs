import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCosPublishConfig, resolveCosRegionFromPublicUrl } from './lib/cos-config.mjs';
import { loadCosSdk } from './lib/load-cos-sdk.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const localFile = path.join(rootDir, 'shared-credentials.enc.json');
const objectKey = 'tooldesk/config/shared-credentials.enc.json';
const cosSharedConfigPath = path.join(rootDir, 'config/cosSharedConfig.json');
const tooldeskConfigPath = path.join(rootDir, 'tooldesk.config.json');

function normalizeUrlForCompare(url) {
  return String(url ?? '').trim().replace(/\/+$/, '');
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
}

function syncClientUrls(publicUrl) {
  let updated = false;

  const cosShared = readJsonIfExists(cosSharedConfigPath);

  if (cosShared) {
    if (normalizeUrlForCompare(cosShared.encryptedUrl) !== normalizeUrlForCompare(publicUrl)) {
      cosShared.encryptedUrl = publicUrl;
      writeJson(cosSharedConfigPath, cosShared);
      updated = true;
    }
  }

  const appConfig = readJsonIfExists(tooldeskConfigPath);

  if (appConfig?.sharedConfig && typeof appConfig.sharedConfig === 'object') {
    if (normalizeUrlForCompare(appConfig.sharedConfig.url) !== normalizeUrlForCompare(publicUrl)) {
      appConfig.sharedConfig.url = publicUrl;
      writeJson(tooldeskConfigPath, appConfig);
      updated = true;
    }
  }

  return updated;
}

async function main() {
  const COS = await loadCosSdk();
  if (!fs.existsSync(localFile)) {
    console.error('未找到 shared-credentials.enc.json，请先执行: node scripts/encrypt-shared-config.mjs');
    process.exit(1);
  }

  const config = loadCosPublishConfig();
  const region =
    process.env.TOOLDESK_COS_REGION?.trim() ||
    resolveCosRegionFromPublicUrl(config.publicBaseUrl) ||
    config.region;
  const body = fs.readFileSync(localFile);

  const cos = new COS({
    SecretId: config.secretId,
    SecretKey: config.secretKey
  });

  await new Promise((resolve, reject) => {
    cos.putObject(
      {
        ACL: 'public-read',
        Body: body,
        Bucket: config.bucket,
        CacheControl: 'no-cache, max-age=0',
        ContentType: 'application/json; charset=utf-8',
        Key: objectKey,
        Region: region
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

  const publicUrl = `https://${config.bucket}.cos.${region}.myqcloud.com/${objectKey}`;
  const clientUrl = readJsonIfExists(cosSharedConfigPath)?.encryptedUrl?.trim() ?? '';
  const synced = syncClientUrls(publicUrl);

  console.info(`[cos] 已上传 -> ${publicUrl}`);

  if (synced) {
    console.info('[cos] 已同步 config/cosSharedConfig.json（及 tooldesk.config.json 中的 sharedConfig.url）');
  } else if (normalizeUrlForCompare(clientUrl) === normalizeUrlForCompare(publicUrl)) {
    console.info('[cos] 客户端 encryptedUrl 已一致，启动 tooldesk 后将从此地址拉取加密配置');
  } else if (!clientUrl) {
    console.info('[cos] 未找到 config/cosSharedConfig.json，请配置 encryptedUrl 为上述地址');
  }
}

main().catch((error) => {
  console.error('[cos] 上传失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});
