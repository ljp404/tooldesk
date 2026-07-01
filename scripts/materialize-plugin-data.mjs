import fs from 'node:fs';
import path from 'node:path';

const PLUGIN_JSON_BUNDLES = [
  {
    globalName: '__TOOLDESK_BANK_BIN_DATA__',
    jsonFile: 'bank_info_bin.json'
  },
  {
    globalName: '__TOOLDESK_COMMON_SITES_DATA__',
    jsonFile: 'sites.json'
  }
];

const PLUGIN_SVG_ICON_BUNDLES = [
  {
    globalName: '__TOOLDESK_BROWSER_ICON_URLS__',
    icons: ['chrome', 'edge']
  }
];

export const INLINE_PLUGIN_DATA_MARKER = '<!-- TOOLDESK_INLINE_PLUGIN_DATA -->';

function stripGeneratedPluginAssets(html) {
  return html
    .replace(/<script\s+src="\.\/[^"]+\.bundle\.js"><\/script>\s*/gi, '')
    .replace(/<script>window\.__TOOLDESK_[A-Z0-9_]+__=[\s\S]*?<\/script>\s*/gi, '');
}

function buildInlinePluginDataScripts(pluginRoot) {
  const scripts = [];

  for (const item of PLUGIN_JSON_BUNDLES) {
    const jsonPath = path.join(pluginRoot, item.jsonFile);

    if (!fs.existsSync(jsonPath)) {
      continue;
    }

    const raw = fs.readFileSync(jsonPath, 'utf-8').replace(/^\uFEFF/, '');

    JSON.parse(raw);
    scripts.push(`<script>window.${item.globalName}=${raw};</script>`);
  }

  for (const item of PLUGIN_SVG_ICON_BUNDLES) {
    const icons = {};

    for (const name of item.icons) {
      const svgPath = path.join(pluginRoot, `${name}.svg`);

      if (!fs.existsSync(svgPath)) {
        continue;
      }

      const svg = fs.readFileSync(svgPath, 'utf-8').replace(/^\uFEFF/, '').trim();
      icons[name] = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    }

    if (Object.keys(icons).length === 0) {
      continue;
    }

    scripts.push(`<script>window.${item.globalName}=${JSON.stringify(icons)};</script>`);
  }

  return scripts.join('\n');
}

export function injectInlinePluginData(html, pluginRoot) {
  const injection = buildInlinePluginDataScripts(pluginRoot);

  if (!injection) {
    return stripGeneratedPluginAssets(html);
  }

  let nextHtml = stripGeneratedPluginAssets(html);

  if (nextHtml.includes(INLINE_PLUGIN_DATA_MARKER)) {
    return nextHtml.replace(INLINE_PLUGIN_DATA_MARKER, `${INLINE_PLUGIN_DATA_MARKER}\n${injection}`);
  }

  const lastScriptIndex = nextHtml.lastIndexOf('<script');

  if (lastScriptIndex === -1) {
    return `${nextHtml}\n${injection}\n`;
  }

  return `${nextHtml.slice(0, lastScriptIndex)}${injection}\n${nextHtml.slice(lastScriptIndex)}`;
}

export function materializePluginDataBundles(pluginRoot) {
  const htmlPath = path.join(pluginRoot, 'index.html');

  if (!fs.existsSync(htmlPath)) {
    return 0;
  }

  const html = fs.readFileSync(htmlPath, 'utf-8');
  const nextHtml = injectInlinePluginData(html, pluginRoot);

  if (nextHtml === html) {
    return 0;
  }

  fs.writeFileSync(htmlPath, nextHtml, 'utf-8');

  for (const item of PLUGIN_JSON_BUNDLES) {
    fs.rmSync(path.join(pluginRoot, item.bundleFile ?? `${item.jsonFile}.bundle.js`), { force: true });
  }

  fs.rmSync(path.join(pluginRoot, 'browser-icons.bundle.js'), { force: true });
  fs.rmSync(path.join(pluginRoot, 'sites.bundle.js'), { force: true });
  fs.rmSync(path.join(pluginRoot, 'bank_info_bin.bundle.js'), { force: true });

  return 1;
}
