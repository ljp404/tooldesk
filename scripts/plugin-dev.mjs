import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = path.join(rootDir, 'plugins');
const rawPluginId = process.argv[2];
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function normalizePluginId(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-');
}

function run(label, command, args) {
  console.info(`[plugin:dev] ${label}`);
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env: process.env,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!rawPluginId) {
  console.error('Usage: npm.cmd run plugin:dev -- tooldesk-your-plugin');
  process.exit(1);
}

const pluginId = normalizePluginId(rawPluginId);

if (!pluginId) {
  console.error('Plugin id is required.');
  process.exit(1);
}

const pluginRoot = path.join(pluginsDir, pluginId);

if (!fs.existsSync(pluginRoot)) {
  run(`scaffold ${pluginId}`, 'node', ['scripts/plugin-scaffold.mjs', pluginId]);
} else if (!fs.existsSync(path.join(pluginRoot, 'plugin.json'))) {
  console.error(`Plugin directory exists but plugin.json is missing: ${pluginRoot}`);
  process.exit(1);
}

run('generate icons', npmCommand, ['run', 'plugin:icons', '--', '--plugin', pluginId]);
run('sync capabilities', npmCommand, ['run', 'plugin:capabilities']);
run('validate plugins', npmCommand, ['run', 'plugin:validate']);
run('sync installed plugins', npmCommand, ['run', 'plugin:sync']);

console.info(`[plugin:dev] ready: ${pluginRoot}`);
console.info('[plugin:dev] next: npm.cmd run dev');
