import fs from 'node:fs';
import path from 'node:path';
import { getAllowedPluginApis, PLUGIN_SDK_VERSION } from './pluginApiReference.js';
import { resolvePluginAsset, sanitizePluginId } from './pluginManifestUtils.js';

export const PLUGIN_MANIFEST_FORMAT_VERSION = 1;

const PLUGIN_CATEGORIES = new Set(['text', 'dev', 'image', 'json', 'finance', 'life', 'document']);
const PLUGIN_PERMISSIONS = new Set([
  'browser-bookmarks',
  'clipboard',
  'docker',
  'filesystem',
  'hosts',
  'http',
  'keepass',
  'local-library',
  'mail',
  'music',
  'native-tool',
  'ssh'
]);

const SCHEMA_REQUIRED_FIELDS = [
  'manifestVersion',
  'id',
  'name',
  'version',
  'entry',
  'category',
  'publisher',
  'sdkVersion',
  'minHostVersion',
  'capabilities'
];

const FORBIDDEN_ENTRY_PATTERNS = [
  /createTooldeskPluginApi\s*\(/,
  /function\s+createTooldeskPluginApi/,
  /\bwindow\.tooldeskShortcut\b/,
  /\bTooldeskPlugin\.run\s*\(/,
  /\binitTooldeskPlugin\s*\(/,
  /\bcreateTooldeskPlugin\s*\(/,
  /\bnavigator\.clipboard\b/,
  /\bdocument\.execCommand\s*\(/,
  /type:\s*['"]api:invoke['"]/
];

const CROSS_ORIGIN_FETCH_PATTERN = /\bfetch\s*\(\s*['"`]https?:\/\//;
const ANY_FETCH_PATTERN = /\bfetch\s*\(/;
const RELATIVE_FETCH_PATTERN = /\bfetch\s*\(\s*['"`]\.\//;
const REQUIRED_ENTRY_PATTERNS = [/TooldeskPlugin\.create\s*\(/];
const PLUGIN_ID_PATTERN = /^tooldesk-[a-z0-9._-]+$/;
const SEMVER_PATTERN = /^\d+(?:\.\d+){0,2}$/;

function normalizeSemver(value: unknown) {
  const version = String(value ?? '')
    .trim()
    .replace(/^v/i, '');

  if (!SEMVER_PATTERN.test(version)) {
    return '';
  }

  return version;
}

function readTextIfExists(filePath: string) {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    return fs.readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function resolveExistingPluginAsset(root: string, relativePath: unknown) {
  const resolved = resolvePluginAsset(root, relativePath);

  try {
    if (!resolved || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      return null;
    }

    return resolved;
  } catch {
    return null;
  }
}

function validateOptionalIconAsset(root: string, value: unknown, fieldName: string) {
  const icon = String(value ?? '').trim();

  if (!icon || !/\.(?:ico|jpe?g|png|svg|webp)$/i.test(icon)) {
    return [];
  }

  const expectedPathByField: Record<string, RegExp> = {
    icon: /^assets\/icon\.svg$/i,
    windowIcon: /^assets\/window-icon\.png$/i
  };
  const normalizedIcon = icon.replace(/\\/g, '/');
  const expectedPath = expectedPathByField[fieldName];
  const errors: string[] = [];

  if (expectedPath && !expectedPath.test(normalizedIcon)) {
    errors.push(`plugin.json: ${fieldName} must use ${fieldName === 'icon' ? 'assets/icon.svg' : 'assets/window-icon.png'}`);
  }

  if (!resolveExistingPluginAsset(root, icon)) {
    errors.push(`plugin.json: ${fieldName} asset is missing`);
  }

  return errors;
}

function validateNativeTools(root: string, value: unknown) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return ['plugin.json: nativeTools must be an object'];
  }

  const errors: string[] = [];
  for (const [name, relativePath] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z0-9._-]+$/i.test(name)) {
      errors.push(`plugin.json: nativeTools key "${name}" is invalid`);
      continue;
    }

    const toolPath = String(relativePath ?? '').trim();
    if (!toolPath || path.isAbsolute(toolPath) || toolPath.replace(/\\/g, '/').includes('..')) {
      errors.push(`plugin.json: nativeTools.${name} path is invalid`);
      continue;
    }

    const resolved = resolveExistingPluginAsset(root, toolPath);
    if (!resolved) {
      errors.push(`plugin.json: nativeTools.${name} asset is missing`);
    }
  }

  return errors;
}

function collectHtmlFiles(root: string, relativeEntry: string) {
  const files = new Set<string>([relativeEntry]);
  const manifestRaw = readTextIfExists(path.join(root, 'plugin.json'));

  if (manifestRaw) {
    try {
      const manifest = JSON.parse(manifestRaw.replace(/^\uFEFF/, '')) as Record<string, unknown>;
      const settings = manifest.settings;

      if (settings && typeof settings === 'object') {
        const entry = String((settings as Record<string, unknown>).entry ?? '').trim();

        if (entry) {
          files.add(entry);
        }
      }
    } catch {
      // ignore malformed json here; manifest validation will report it
    }
  }

  return [...files];
}

function extractHtmlCapabilities(html: string) {
  const capabilities = new Set<string>();
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

function validateManifestSchema(raw: Record<string, unknown>) {
  const errors: string[] = [];

  for (const field of SCHEMA_REQUIRED_FIELDS) {
    if (raw[field] === undefined || raw[field] === null || raw[field] === '') {
      errors.push(`plugin.json: missing required field "${field}"`);
    }
  }

  const pluginId = String(raw.id ?? '').trim();

  if (pluginId && !PLUGIN_ID_PATTERN.test(pluginId)) {
    errors.push('plugin.json: id must match pattern tooldesk-xxx');
  }

  if (raw.manifestVersion !== undefined && Number(raw.manifestVersion) !== PLUGIN_MANIFEST_FORMAT_VERSION) {
    errors.push(`plugin.json: manifestVersion must be ${PLUGIN_MANIFEST_FORMAT_VERSION}`);
  }

  if (raw.version !== undefined && !normalizeSemver(raw.version)) {
    errors.push('plugin.json: version must be semver like 1.0.0');
  }

  if (raw.sdkVersion !== undefined && !normalizeSemver(raw.sdkVersion)) {
    errors.push('plugin.json: sdkVersion must be semver like 1.0.0');
  }

  if (raw.minHostVersion !== undefined && !normalizeSemver(raw.minHostVersion)) {
    errors.push('plugin.json: minHostVersion must be semver like 1.0.0');
  }

  if (!Array.isArray(raw.capabilities)) {
    errors.push('plugin.json: capabilities must be an array');
  }

  return errors;
}

function validateBootOrder(html: string, htmlFile: string) {
  const errors: string[] = [];

  if (!/\bapi\./.test(html)) {
    return errors;
  }

  if (!/plugin\.connect\s*\(\s*\)\.then\s*\(/.test(html)) {
    errors.push(`${htmlFile}: must use plugin.connect().then(...) before calling host APIs`);
  }

  return errors;
}

export function validatePluginManifest(raw: Record<string, unknown>, root: string) {
  const errors = validateManifestSchema(raw);
  const pluginId = sanitizePluginId(raw.id);
  const name = String(raw.name ?? '').trim();
  const version = normalizeSemver(raw.version);
  const entry = String(raw.entry ?? '').trim();
  const sdkVersion = normalizeSemver(raw.sdkVersion);
  const minHostVersion = normalizeSemver(raw.minHostVersion);
  const publisher = String(raw.publisher ?? '').trim();
  const category = String(raw.category ?? 'dev').trim();
  const permissions = Array.isArray(raw.permissions)
    ? raw.permissions.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];
  const capabilities = Array.isArray(raw.capabilities)
    ? raw.capabilities.map((item) => String(item ?? '').trim()).filter(Boolean)
    : [];

  if (!pluginId) {
    errors.push('plugin.json: id is required');
  }

  if (!name) {
    errors.push('plugin.json: name is required');
  }

  if (!version) {
    errors.push('plugin.json: version must be semver like 1.0.0');
  }

  if (!sdkVersion) {
    errors.push('plugin.json: sdkVersion is required');
  } else if (sdkVersion !== PLUGIN_SDK_VERSION) {
    errors.push(`plugin.json: sdkVersion must match host SDK ${PLUGIN_SDK_VERSION}`);
  }

  if (!minHostVersion) {
    errors.push('plugin.json: minHostVersion is required');
  }

  if (!publisher) {
    errors.push('plugin.json: publisher is required');
  }

  if (!PLUGIN_CATEGORIES.has(category)) {
    errors.push(`plugin.json: category "${category}" is invalid`);
  }

  for (const permission of permissions) {
    if (!PLUGIN_PERMISSIONS.has(permission)) {
      errors.push(`plugin.json: unknown permission "${permission}"`);
    }
  }

  if (!entry || !resolveExistingPluginAsset(root, entry)) {
    errors.push('plugin.json: entry file is missing');
  }

  errors.push(...validateOptionalIconAsset(root, raw.icon, 'icon'));
  errors.push(...validateOptionalIconAsset(root, raw.windowIcon, 'windowIcon'));
  errors.push(...validateNativeTools(root, raw.nativeTools));

  if (permissions.includes('native-tool') && (!raw.nativeTools || typeof raw.nativeTools !== 'object')) {
    errors.push('plugin.json: nativeTools is required when using native-tool permission');
  }

  if (raw.settings && typeof raw.settings === 'object') {
    errors.push(...validateOptionalIconAsset(root, (raw.settings as Record<string, unknown>).icon, 'settings.icon'));
  }

  const allowedApis = getAllowedPluginApis(permissions);

  for (const capability of capabilities) {
    if (!allowedApis.has(capability)) {
      errors.push(`plugin.json: capability "${capability}" is not allowed by permissions`);
    }
  }

  const htmlCapabilities = new Set<string>();

  for (const htmlFile of collectHtmlFiles(root, entry)) {
    const resolved = resolveExistingPluginAsset(root, htmlFile);

    if (!resolved) {
      errors.push(`plugin entry html not found: ${htmlFile}`);
      continue;
    }

    const html = readTextIfExists(resolved);

    if (!html) {
      errors.push(`plugin entry html unreadable: ${htmlFile}`);
      continue;
    }

    for (const capability of extractHtmlCapabilities(html)) {
      htmlCapabilities.add(capability);
    }

    for (const pattern of FORBIDDEN_ENTRY_PATTERNS) {
      if (pattern.test(html)) {
        errors.push(`${htmlFile}: forbidden legacy SDK pattern ${pattern.source}`);
      }
    }

    for (const pattern of REQUIRED_ENTRY_PATTERNS) {
      if (!pattern.test(html)) {
        errors.push(`${htmlFile}: must use TooldeskPlugin.create()`);
      }
    }

    if (pluginId && !new RegExp(`id:\\s*['"]${pluginId}['"]`).test(html)) {
      errors.push(`${htmlFile}: TooldeskPlugin.create must include id: '${pluginId}'`);
    }

    errors.push(...validateBootOrder(html, htmlFile));

    if (CROSS_ORIGIN_FETCH_PATTERN.test(html)) {
      errors.push(`${htmlFile}: cross-origin fetch is forbidden; declare http permission and use sendHttpRequest`);
    }

    if (ANY_FETCH_PATTERN.test(html) && !RELATIVE_FETCH_PATTERN.test(html)) {
      errors.push(`${htmlFile}: fetch is forbidden except same-plugin relative assets like ./data.json`);
    }

    if (/<script\b[^>]*tooldesk-plugin-sdk\.js[^>]*>/i.test(html)) {
      errors.push(`${htmlFile}: do not include SDK script manually; host injects SDK automatically`);
    }
  }

  for (const capability of htmlCapabilities) {
    if (!capabilities.includes(capability)) {
      errors.push(`plugin.json: missing capability "${capability}" used in HTML`);
    }
  }

  return {
    errors,
    ok: errors.length === 0,
    pluginId
  };
}

export function validatePluginRoot(root: string) {
  const manifestPath = path.join(root, 'plugin.json');
  const manifestRaw = readTextIfExists(manifestPath);

  if (!manifestRaw) {
    return { errors: ['plugin.json is missing'], ok: false, pluginId: '' };
  }

  try {
    const manifest = JSON.parse(manifestRaw.replace(/^\uFEFF/, '')) as Record<string, unknown>;
    return validatePluginManifest(manifest, root);
  } catch {
    return { errors: ['plugin.json is invalid JSON'], ok: false, pluginId: '' };
  }
}
