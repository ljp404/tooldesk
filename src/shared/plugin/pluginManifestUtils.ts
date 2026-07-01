import path from 'node:path';

export function sanitizePluginId(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '');
}

export function resolvePluginAsset(root: string, relativePath: unknown) {
  const normalizedRoot = path.resolve(root);
  const normalizedRelativePath = String(relativePath ?? '').trim();

  if (!normalizedRelativePath || path.isAbsolute(normalizedRelativePath)) {
    return null;
  }

  const resolved = path.resolve(normalizedRoot, normalizedRelativePath);

  if (!resolved.startsWith(normalizedRoot + path.sep)) {
    return null;
  }

  return resolved;
}
