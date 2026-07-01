import fs from 'node:fs';
import path from 'node:path';

const PRETTIER_VENDOR_FILES = [
  'vendor/prettier-standalone.js',
  'vendor/prettier-plugin-html.js',
  'vendor/prettier-plugin-babel.js',
  'vendor/prettier-plugin-estree.js',
  'vendor/prettier-plugin-postcss.js'
];

const MARKER = '<!-- TOOLDESK_PRETTIER_VENDOR -->';
const INLINE_VENDOR_PATTERN =
  /<script\b[^>]*data-tooldesk-vendor=["']prettier["'][^>]*>[\s\S]*?<\/script>\s*/gi;
const EXTERNAL_VENDOR_PATTERN =
  /<script\b[^>]*src=["'][^"']*\/vendor\/prettier[^"']+["'][^>]*>\s*<\/script>\s*/gi;
const CHUNK_SIZE = 65536;

function buildPrettierBundle(root) {
  let bundle = '';

  for (const relativePath of PRETTIER_VENDOR_FILES) {
    const filePath = path.join(root, relativePath);

    if (!fs.existsSync(filePath)) {
      throw new Error(`[inline-vendor] missing ${relativePath} in ${root}`);
    }

    bundle += `${fs.readFileSync(filePath, 'utf-8').replace(/^\uFEFF/, '').trim()}\n`;
  }

  return bundle;
}

function buildVendorLoaderScript(bundle, vendorName, globalName) {
  const base64 = Buffer.from(bundle, 'utf-8').toString('base64');
  const chunks = [];

  for (let index = 0; index < base64.length; index += CHUNK_SIZE) {
    chunks.push(base64.slice(index, index + CHUNK_SIZE));
  }

  const chunksLiteral = chunks.map((chunk) => JSON.stringify(chunk)).join(',\n');
  const globalExpose =
    typeof globalName === 'string' && globalName
      ? `\n  if (typeof ${globalName} !== 'undefined') { window.${globalName} = ${globalName}; }`
      : '';

  return `<script data-tooldesk-vendor="${vendorName}">
(function () {
  var parts = [${chunksLiteral}];
  var code = atob(parts.join(''));
  (0, eval)(code);${globalExpose}
})();
</script>`;
}

const QRCODE_MARKER = '<!-- TOOLDESK_QRCODE_VENDOR -->';
const QRCODE_INLINE_VENDOR_PATTERN =
  /<script\b[^>]*data-tooldesk-vendor=["']qrcode["'][^>]*>[\s\S]*?<\/script>\s*/gi;
const QRCODE_EXTERNAL_VENDOR_PATTERN =
  /<script\b[^>]*src=["'][^"']*qrcode\.bundle\.js["'][^>]*>\s*<\/script>\s*/gi;

function getPluginId(root) {
  const manifestPath = path.join(root, 'plugin.json');

  if (!fs.existsSync(manifestPath)) {
    return path.basename(root);
  }

  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8').replace(/^\uFEFF/, ''));
    return String(manifest.id ?? path.basename(root)).trim();
  } catch {
    return path.basename(root);
  }
}

export function inlinePrettierVendorForPlugin(root) {
  if (getPluginId(root) !== 'tooldesk-code-formatter') {
    return false;
  }

  const htmlPath = path.join(root, 'index.html');

  if (!fs.existsSync(htmlPath)) {
    return false;
  }

  let html = fs.readFileSync(htmlPath, 'utf-8');
  html = html.replace(INLINE_VENDOR_PATTERN, '');
  html = html.replace(EXTERNAL_VENDOR_PATTERN, '');

  if (!html.includes(MARKER)) {
    throw new Error(`[inline-vendor] missing ${MARKER} in ${htmlPath}`);
  }

  const loader = buildVendorLoaderScript(buildPrettierBundle(root), 'prettier');
  html = html.replace(MARKER, loader);
  fs.writeFileSync(htmlPath, html, 'utf-8');
  return true;
}

export function inlineQrcodeVendorForPlugin(root) {
  if (getPluginId(root) !== 'tooldesk-qr-generator') {
    return false;
  }

  const htmlPath = path.join(root, 'index.html');
  const bundlePath = path.join(root, 'assets/qrcode.bundle.js');

  if (!fs.existsSync(htmlPath) || !fs.existsSync(bundlePath)) {
    return false;
  }

  let html = fs.readFileSync(htmlPath, 'utf-8');
  html = html.replace(QRCODE_INLINE_VENDOR_PATTERN, '');

  const bundle = fs.readFileSync(bundlePath, 'utf-8').replace(/^\uFEFF/, '').trim();
  const globalBundle = bundle.replace(/^var QRCode = /, 'window.QRCode = ');
  const loader = buildVendorLoaderScript(globalBundle, 'qrcode');

  if (html.includes(QRCODE_MARKER)) {
    html = html.replace(QRCODE_MARKER, loader);
  } else if (QRCODE_EXTERNAL_VENDOR_PATTERN.test(html)) {
    html = html.replace(QRCODE_EXTERNAL_VENDOR_PATTERN, loader);
  } else if (html.includes('data-tooldesk-vendor="qrcode"')) {
    return true;
  } else {
    throw new Error(`[inline-vendor] missing ${QRCODE_MARKER} in ${htmlPath}`);
  }

  fs.writeFileSync(htmlPath, html, 'utf-8');
  return true;
}

export function inlinePluginVendorsForPlugin(root) {
  return inlinePrettierVendorForPlugin(root) || inlineQrcodeVendorForPlugin(root);
}
