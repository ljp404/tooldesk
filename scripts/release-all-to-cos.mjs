import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, label) {
  console.info(`[release] ${label}`);

  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    shell: process.platform === 'win32' && command === npmCommand,
    stdio: 'inherit'
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`${label} 失败，退出码 ${result.status ?? 'unknown'}`);
  }
}

function listPluginDirs() {
  const pluginsRoot = path.join(rootDir, 'plugins');

  if (!fs.existsSync(pluginsRoot)) {
    return [];
  }

  return fs
    .readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(pluginsRoot, entry.name))
    .filter((pluginDir) => fs.existsSync(path.join(pluginDir, 'plugin.json')))
    .sort((current, next) => path.basename(current).localeCompare(path.basename(next), 'en'));
}

async function main() {
  const pluginDirs = listPluginDirs();

  if (pluginDirs.length === 0) {
    throw new Error('未找到可上传插件：plugins/*/plugin.json');
  }

  console.info(`[release] 将发布应用新版本，并上传 ${pluginDirs.length} 个插件到 COS`);
  run(npmCommand, ['run', 'release:cos'], '打包并上传应用更新');

  for (const pluginDir of pluginDirs) {
    const relativePluginDir = path.relative(rootDir, pluginDir);
    run(process.execPath, ['scripts/upload-plugin-to-cos.mjs', relativePluginDir], `上传插件 ${relativePluginDir}`);
  }

  console.info('[release] 应用新版本和插件已全部上传到 COS');
}

main().catch((error) => {
  console.error('[release] 发布失败:', error instanceof Error ? error.message : error);
  process.exit(1);
});
