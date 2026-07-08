import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = path.join(rootDir, 'plugins');

const INIT_CALLS = new Set([
  'init',
  'render',
  'renderAll',
  'generate',
  'loadHosts',
  'loadBookmarks',
  'restoreSession',
  'queryCurrentIp',
  'queryIp',
  'loadNetworkInfo',
  'loadLibraries',
  'loadChinaMap',
  'renderCalendar',
  'load'
]);

function listHtmlFiles() {
  const files = [];
  for (const name of fs.readdirSync(pluginsDir)) {
    const root = path.join(pluginsDir, name);
    if (!fs.statSync(root).isDirectory()) continue;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(fullPath);
        else if (entry.name.endsWith('.html')) files.push(fullPath);
      }
    };
    walk(root);
  }
  return files;
}

function extractMainScript(html) {
  const match = html.match(/<script>\s*([\s\S]*?)<\/script>\s*<\/body>/i);
  return match ? match[1] : '';
}

function analyzeScript(rel, script) {
  const issues = [];

  if (!script.includes('TooldeskPlugin.create')) {
    return issues;
  }

  if (/\bapi\./.test(script) && !/plugin\.connect\s*\(\s*\)\.then\s*\(/.test(script)) {
    issues.push('uses api.* but missing plugin.connect().then(...)');
  }

  if (/void plugin\.connect\(\)\s*;/.test(script)) {
    issues.push('bare void plugin.connect() without .then(...)');
  }

  const connectIndex = script.indexOf('plugin.connect(');
  if (connectIndex < 0) {
    issues.push('missing plugin.connect()');
    return issues;
  }

  const beforeConnect = script.slice(0, connectIndex);
  const lines = beforeConnect.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('function ') || trimmed.startsWith('async function ')) {
      continue;
    }

    const topLevelCall = trimmed.match(/^(?:void\s+)?([a-zA-Z_$][\w$]*)\s*\(/);
    if (!topLevelCall) {
      continue;
    }

    const name = topLevelCall[1];
    if (INIT_CALLS.has(name) || name === 'render') {
      issues.push(`top-level ${name}() runs before plugin.connect()`);
    }
  }

  const thenEmpty = /plugin\.connect\s*\(\s*\)\.then\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/.test(script);
  const usesApi = /\bapi\./.test(script);
  const hasInitInThen = /plugin\.connect\s*\(\s*\)\.then\s*\([\s\S]*?(?:init|render|loadBookmarks|loadHosts|restoreSession|queryCurrentIp|loadLibraries|renderCalendar|generate)\s*\(/.test(
    script
  );

  if (thenEmpty && usesApi) {
    const onlyClickApi = !hasInitInThen;
    if (onlyClickApi) {
      // acceptable: api only on user click after connect() invoked in same script turn
    }
  }

  if (thenEmpty && /^\s*render\s*\(\s*\)\s*;/m.test(script.split('plugin.connect(')[0] || '')) {
    // render before connect is fine if local-only
  }

  return issues;
}

let issueCount = 0;

for (const htmlPath of listHtmlFiles()) {
  const script = extractMainScript(fs.readFileSync(htmlPath, 'utf-8'));
  const rel = path.relative(rootDir, htmlPath);
  const issues = analyzeScript(rel, script);

  if (issues.length === 0) {
    console.info(`[ok] ${rel}`);
    continue;
  }

  issueCount += issues.length;
  console.error(`[issue] ${rel}`);
  for (const issue of issues) {
    console.error(`  - ${issue}`);
  }
}

console.info(`[audit-boot] ${issueCount} issue(s)`);
process.exitCode = issueCount > 0 ? 1 : 0;
