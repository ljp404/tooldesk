#!/usr/bin/env node
/**
 * 生成上传到腾讯云 COS 的加密共享配置。
 *
 * 用法：
 *   set TOOLDESK_SHARED_CONFIG_KEY=64位十六进制或任意口令
 *   node scripts/encrypt-shared-config.mjs --in <private-json> --out shared-credentials.enc.json
 */
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function parseArgs(argv) {
  const args = { in: '', out: '' };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === '--in') {
      args.in = argv[index + 1] ?? '';
      index += 1;
      continue;
    }

    if (token === '--out') {
      args.out = argv[index + 1] ?? '';
      index += 1;
    }
  }

  return args;
}

function deriveKey(material) {
  const trimmed = material.trim();

  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  try {
    const asBase64 = Buffer.from(trimmed, 'base64');

    if (asBase64.length === 32) {
      return asBase64;
    }
  } catch {
    // ignore
  }

  return createHash('sha256').update(trimmed, 'utf8').digest();
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { in: inputPath, out: outputPath } = parseArgs(process.argv.slice(2));
const resolvedInput = inputPath ? path.resolve(rootDir, inputPath) : '';
const resolvedOutput = outputPath || path.join(rootDir, 'shared-credentials.enc.json');
const keyMaterial = process.env.TOOLDESK_SHARED_CONFIG_KEY?.trim();

if (!resolvedInput) {
  console.error('请显式传入 --in <private-json>，不要把明文密钥文件固定放在项目根目录');
  process.exit(1);
}

if (!fs.existsSync(resolvedInput)) {
  console.error(`未找到 ${resolvedInput}`);
  process.exit(1);
}

if (!keyMaterial) {
  console.error('请设置环境变量 TOOLDESK_SHARED_CONFIG_KEY');
  process.exit(1);
}

const key = deriveKey(keyMaterial);
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
const plaintext = fs.readFileSync(resolvedInput, 'utf8');
const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();

const payload = {
  v: 1,
  alg: 'aes-256-gcm',
  iv: iv.toString('base64'),
  tag: tag.toString('base64'),
  data: encrypted.toString('base64')
};

fs.writeFileSync(resolvedOutput, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.info(`已写入 ${resolvedOutput}，请执行: npm run upload:shared-config`);
