import { resolveContentToolKeys, type ClipboardMatchToolSource } from './toolContentRules.js';

export type { ClipboardMatchToolSource } from './toolContentRules.js';

export function resolveClipboardRoute(content: string, pluginTools: ClipboardMatchToolSource[] = []) {
  return resolveContentToolKeys(content, pluginTools)[0] ?? null;
}
