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

function extractCapabilities(html) {
  const capabilities = new Set();
  const blockPattern = /TooldeskPlugin\.create\s*\(\s*\{[\s\S]*?\}\s*\)/g;

  for (const block of html.match(blockPattern) || []) {
    const arrayMatch = block.match(/capabilities:\s*\[([\s\S]*?)\]/);

    if (!arrayMatch) {
      continue;
    }

    for (const item of arrayMatch[1].match(/['"]([^'"]+)['"]/g) || []) {
      capabilities.add(item.replace(/['"]/g, ''));
    }
  }

  return [...capabilities].sort();
}

let updated = 0;

for (const root of listPluginRoots()) {
  const manifestPath = path.join(root, 'plugin.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8').replace(/^\uFEFF/, ''));
  const merged = new Set(Array.isArray(manifest.capabilities) ? manifest.capabilities : []);

  for (const htmlPath of walkHtmlFiles(root)) {
    for (const capability of extractCapabilities(fs.readFileSync(htmlPath, 'utf-8'))) {
      merged.add(capability);
    }
  }

  const capabilities = [...merged].sort();

  if (JSON.stringify(manifest.capabilities ?? []) === JSON.stringify(capabilities)) {
    continue;
  }

  manifest.capabilities = capabilities;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
  updated += 1;
  console.info(`[capabilities] ${path.basename(root)} -> ${capabilities.join(', ') || '(none)'}`);
}

console.info(`[capabilities] updated ${updated} manifests`);
