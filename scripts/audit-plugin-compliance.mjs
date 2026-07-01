import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = path.join(rootDir, 'plugins');

function listPluginRoots() {
  return fs
    .readdirSync(pluginsDir)
    .map((name) => path.join(pluginsDir, name))
    .filter((candidate) => fs.statSync(candidate).isDirectory() && fs.existsSync(path.join(candidate, 'plugin.json')));
}

function walkHtml(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.name.endsWith('.html')) files.push(fullPath);
    }
  };
  walk(root);
  return files;
}

function extractCreateBlock(html) {
  const match = html.match(/TooldeskPlugin\.create\s*\(\s*\{[\s\S]*?\}\s*\)/);
  return match ? match[0] : '';
}

function extractCapabilities(block) {
  const arrayMatch = block.match(/capabilities:\s*\[([\s\S]*?)\]/);
  if (!arrayMatch) return [];
  return (arrayMatch[1].match(/['"]([^'"]+)['"]/g) || []).map((item) => item.replace(/['"]/g, ''));
}

function extractApiMethods(html) {
  const methods = new Set();
  for (const match of html.matchAll(/\bapi\.([a-zA-Z][a-zA-Z0-9_]*)\b/g)) {
    methods.add(match[1]);
  }
  return [...methods].sort();
}

const warnings = [];

for (const root of listPluginRoots()) {
  const label = path.basename(root);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf-8').replace(/^\uFEFF/, ''));
  const manifestCaps = new Set(Array.isArray(manifest.capabilities) ? manifest.capabilities : []);
  const htmlCaps = new Set();
  const htmlApis = new Set();

  for (const htmlPath of walkHtml(root)) {
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const rel = path.relative(root, htmlPath);
    for (const cap of extractCapabilities(extractCreateBlock(html))) htmlCaps.add(cap);
    for (const api of extractApiMethods(html)) htmlApis.add(api);

    if (/\bapi\./.test(html) && !/plugin\.connect\s*\(\s*\)\.then\s*\(/.test(html)) {
      warnings.push(`${label}/${rel}: uses api.* but missing plugin.connect().then(...)`);
    }

    if (/void plugin\.connect\(\)\s*;/.test(html)) {
      warnings.push(`${label}/${rel}: bare void plugin.connect() without .then(...)`);
    }
  }

  for (const cap of htmlCaps) {
    if (!manifestCaps.has(cap)) {
      warnings.push(`${label}: HTML declares capability "${cap}" missing from plugin.json`);
    }
  }

  for (const cap of manifestCaps) {
    if (!htmlCaps.has(cap)) {
      warnings.push(`${label}: plugin.json capability "${cap}" not declared in TooldeskPlugin.create`);
    }
  }

  for (const api of htmlApis) {
    if (!htmlCaps.has(api) && !['then', 'catch', 'finally'].includes(api)) {
      // Proxy always exposes api.* - check if used method is in create capabilities
      const baseApis = ['closeCurrentWindow', 'getAppVersion', 'getPluginStorageItem', 'removePluginStorageItem', 'setPluginStorageItem'];
      if (!baseApis.includes(api) && !manifestCaps.has(api)) {
        warnings.push(`${label}: api.${api} used but not in manifest capabilities`);
      }
    }
  }

  if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
    warnings.push(`${label}: plugin.json capabilities is empty`);
  }

  if (manifest.minHostVersion === '0.1.0') {
    warnings.push(`${label}: minHostVersion still generic 0.1.0 (informational)`);
  }
}

console.info(`[audit] scanned ${listPluginRoots().length} plugins`);
if (warnings.length === 0) {
  console.info('[audit] no supplemental warnings');
} else {
  for (const warning of warnings) console.warn(`[warn] ${warning}`);
  console.info(`[audit] ${warnings.length} supplemental warning(s)`);
}
