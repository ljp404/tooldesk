import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nextVersion = String(process.argv[2] ?? '').trim();

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(nextVersion)) {
  console.error('[tooldesk] 请输入合法版本号，例如：0.1.2 或 1.0.0-beta.1');
  process.exit(1);
}

function readText(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), 'utf-8').replace(/^\uFEFF/, '');
}

function writeText(relativePath, content) {
  fs.writeFileSync(path.join(rootDir, relativePath), content, 'utf-8');
}

function updateJson(relativePath, updater) {
  const json = JSON.parse(readText(relativePath));
  updater(json);
  writeText(relativePath, `${JSON.stringify(json, null, 2)}\n`);
}

function replaceRequired(content, pattern, replacement, fileName) {
  if (!pattern.test(content)) {
    throw new Error(`${fileName} 未找到版本字段`);
  }

  return content.replace(pattern, replacement);
}

updateJson('package.json', (json) => {
  json.version = nextVersion;
});

updateJson('package-lock.json', (json) => {
  json.version = nextVersion;

  if (json.packages?.['']) {
    json.packages[''].version = nextVersion;
  }
});

updateJson('src-tauri/tauri.conf.json', (json) => {
  json.version = nextVersion;
});

const cargoTomlPath = 'src-tauri/Cargo.toml';
const cargoToml = replaceRequired(
  readText(cargoTomlPath),
  /(^\[package\][\s\S]*?^version\s*=\s*)"[^"]+"/m,
  `$1"${nextVersion}"`,
  cargoTomlPath
);
writeText(cargoTomlPath, cargoToml);

const cargoLockPath = 'src-tauri/Cargo.lock';
const cargoLock = replaceRequired(
  readText(cargoLockPath),
  /(\[\[package\]\]\r?\nname = "tooldesk"\r?\nversion = )"[^"]+"/,
  `$1"${nextVersion}"`,
  cargoLockPath
);
writeText(cargoLockPath, cargoLock);

console.log(`[tooldesk] 主程序版本已更新为 ${nextVersion}`);
