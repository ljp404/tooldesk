import { builtinClipboardMatches } from './plugin/builtinClipboardMatch.js';
import {
  buildClipboardMatchRules,
  createClipboardMatchPresetMap,
  createJsonMatcher,
  isBankCardNumber,
  isBase64Content,
  isCalculatorExpression,
  isCronExpression,
  isHttpUrl,
  isIdCardNumber,
  isIpAddress,
  isJwt,
  isTimestamp,
  isUrlEncodedContent,
  resolveMatchedToolKeys,
  type ClipboardMatchConfig
} from './plugin/clipboardMatch.js';
import { extractJsonFromText } from '../utils/jsonExtract.js';
import type { ToolKey } from '../types/toolbox.js';

export type { ClipboardMatchConfig };

const rendererPresetMap = createClipboardMatchPresetMap(createJsonMatcher(extractJsonFromText));

export {
  isBankCardNumber,
  isBase64Content,
  isCalculatorExpression,
  isCronExpression,
  isHttpUrl,
  isIdCardNumber,
  isIpAddress,
  isJwt,
  isTimestamp,
  isUrlEncodedContent
};

export const isJson = rendererPresetMap.json;

export interface ClipboardMatchToolSource {
  clipboardMatch?: ClipboardMatchConfig[];
  key: ToolKey;
}

function buildClipboardRules(tools: ClipboardMatchToolSource[] = []) {
  const rules = [];

  for (const definition of builtinClipboardMatches) {
    rules.push(...buildClipboardMatchRules(definition.kind, definition.match, rendererPresetMap));
  }

  for (const tool of tools) {
    if (!tool.clipboardMatch?.length) {
      continue;
    }

    rules.push(...buildClipboardMatchRules(tool.key, tool.clipboardMatch, rendererPresetMap));
  }

  return rules;
}

export function resolveContentToolKeys(content: string, pluginTools: ClipboardMatchToolSource[] = []): ToolKey[] {
  return resolveMatchedToolKeys(content, buildClipboardRules(pluginTools));
}
