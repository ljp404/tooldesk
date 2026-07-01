export interface LocatedJson {
  isPure: boolean;
  json: string;
  prefix: string;
  suffix: string;
}

function escapeNewlinesInsideJsonStrings(text: string) {
  let result = '';
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && inString) {
      result += char;
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      result += char;
      continue;
    }

    if (inString && char === '\n') {
      result += '\\n';
      continue;
    }

    if (inString && char === '\r') {
      result += '\\r';
      continue;
    }

    result += char;
  }

  return result;
}

function normalizeJsonText(text: string) {
  try {
    JSON.parse(text);
    return text;
  } catch {
    // Continue with hidden-newline normalization below.
  }

  const normalized = escapeNewlinesInsideJsonStrings(text);

  if (normalized === text) {
    return null;
  }

  try {
    JSON.parse(normalized);
    return normalized;
  } catch {
    return null;
  }
}

function extractBalancedJson(text: string, start: number) {
  const opener = text[start];

  if (opener !== '{' && opener !== '[') {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === '\\') {
        escape = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{' || char === '[') {
      depth += 1;
    } else if (char === '}' || char === ']') {
      depth -= 1;

      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

/** 定位混合文本中的 JSON 片段，并保留前后原文。 */
export function locateJsonInText(source: string): LocatedJson | null {
  const leading = source.match(/^\s*/)?.[0].length ?? 0;
  const trailing = source.match(/\s*$/)?.[0].length ?? 0;
  const coreStart = leading;
  const coreEnd = source.length - trailing;
  const core = source.slice(coreStart, coreEnd);

  if (!core) {
    return null;
  }

  const normalizedCore = normalizeJsonText(core);

  if (normalizedCore) {
    return {
      isPure: true,
      json: normalizedCore,
      prefix: source.slice(0, coreStart),
      suffix: source.slice(coreEnd)
    };
  }

  const starts: number[] = [];

  for (let index = 0; index < core.length; index += 1) {
    const char = core[index];

    if (char === '{' || char === '[') {
      starts.push(index);
    }
  }

  for (const start of starts) {
    const candidate = extractBalancedJson(core, start);

    if (!candidate) {
      continue;
    }

    const normalizedCandidate = normalizeJsonText(candidate);

    if (normalizedCandidate) {
      const jsonStart = coreStart + start;
      const jsonEnd = jsonStart + candidate.length;

      return {
        isPure: false,
        json: normalizedCandidate,
        prefix: source.slice(0, jsonStart),
        suffix: source.slice(jsonEnd)
      };
    }
  }

  return null;
}

/** 从「说明文字 + JSON」混合文本中提取可解析的 JSON 片段。 */
export function extractJsonFromText(source: string) {
  return locateJsonInText(source)?.json ?? null;
}

export const MIXED_JSON_FORMAT_ERROR = '整体内容不是合法 JSON（已格式化其中的 JSON 部分）';

export function composeFormattedMixedText(prefix: string, formattedJson: string, suffix: string) {
  if (!prefix) {
    return formattedJson + suffix;
  }

  const separator = prefix.endsWith('\n') ? '' : '\n';

  return `${prefix}${separator}${formattedJson}${suffix}`;
}
