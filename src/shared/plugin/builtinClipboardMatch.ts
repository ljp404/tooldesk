import type { ClipboardMatchConfig } from './clipboardMatch.js';

export interface BuiltinClipboardMatchDefinition {
  kind: string;
  match: ClipboardMatchConfig | ClipboardMatchConfig[];
}

export const builtinClipboardMatches: BuiltinClipboardMatchDefinition[] = [];
