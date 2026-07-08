import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = path.join(rootDir, 'plugins');

function listPluginRoots() {
  return fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(pluginsDir, entry.name, 'plugin.json')))
    .map((entry) => path.join(pluginsDir, entry.name));
}

function walkHtmlFiles(dir) {
  const files = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkHtmlFiles(fullPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.html')) {
      files.push(fullPath);
    }
  }

  return files;
}

function addPluginId(html, pluginId) {
  if (new RegExp(`id:\\s*['"]${pluginId}['"]`).test(html)) {
    return html;
  }

  return html.replace(/TooldeskPlugin\.create\(\{\s*/g, `TooldeskPlugin.create({ id: '${pluginId}', `);
}

let updated = 0;

for (const root of listPluginRoots()) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf-8').replace(/^\uFEFF/, ''));
  const pluginId = String(manifest.id ?? '').trim();

  if (!pluginId) {
    continue;
  }

  for (const htmlPath of walkHtmlFiles(root)) {
    const original = fs.readFileSync(htmlPath, 'utf-8');
    const next = addPluginId(original, pluginId);

    if (next !== original) {
      fs.writeFileSync(htmlPath, next, 'utf-8');
      updated += 1;
      console.info(`[add-id] ${path.relative(rootDir, htmlPath)}`);
    }
  }
}

console.info(`[add-id] updated ${updated} html files`);
