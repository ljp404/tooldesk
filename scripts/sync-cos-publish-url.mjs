import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatedConfigDir = path.join(rootDir, 'config', 'generated');
const cosUpdatePath = path.join(generatedConfigDir, 'cosUpdate.json');
const pluginMarketConfigPath = path.join(generatedConfigDir, 'pluginMarketConfig.json');
const pluginMarketKey = 'tooldesk/plugins/market.json';

function normalizeBaseUrl(value) {
  const trimmed = String(value ?? '').trim();

  if (!trimmed) {
    return '';
  }

  const url = new URL(trimmed);
  return url.toString().endsWith('/') ? url.toString() : `${url.toString()}/`;
}

function main() {
  const publicBaseUrl = normalizeBaseUrl(process.env.TOOLDESK_PUBLIC_BASE_URL);

  if (!publicBaseUrl) {
    console.info('[cos] 未配置 TOOLDESK_PUBLIC_BASE_URL，跳过客户端公开地址生成');
    return;
  }

  const cosUpdate = {
    publicBaseUrl: new URL('tooldesk/releases/win/', publicBaseUrl).toString()
  };
  const pluginMarketConfig = {
    marketUrl: new URL(pluginMarketKey, publicBaseUrl).toString()
  };

  fs.mkdirSync(generatedConfigDir, { recursive: true });
  fs.writeFileSync(cosUpdatePath, `${JSON.stringify(cosUpdate, null, 2)}\n`);
  fs.writeFileSync(pluginMarketConfigPath, `${JSON.stringify(pluginMarketConfig, null, 2)}\n`);

  console.info(`[cos] generated cosUpdate publicBaseUrl = ${cosUpdate.publicBaseUrl}`);
  console.info(`[cos] generated pluginMarketConfig marketUrl = ${pluginMarketConfig.marketUrl}`);
}

main();
