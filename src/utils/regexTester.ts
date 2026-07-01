export interface RegexMatchResult {
  groups: string[];
  index: number;
  text: string;
}

export interface RegexTestResult {
  error: string;
  flags: string;
  matches: RegexMatchResult[];
  pattern: string;
  replacePreview: string;
  valid: boolean;
}

export interface RegexTestOptions {
  flags: string;
  pattern: string;
  replaceWith?: string;
  text: string;
}

function normalizeFlags(flags: string) {
  const allowed = new Set(['d', 'g', 'i', 'm', 's', 'u', 'v', 'y']);
  const normalized = flags
    .split('')
    .filter((flag, index, array) => allowed.has(flag) && array.indexOf(flag) === index)
    .join('');

  return normalized.includes('g') ? normalized : `${normalized}g`;
}

export function testRegex(options: RegexTestOptions): RegexTestResult {
  const pattern = options.pattern;
  const flags = normalizeFlags(options.flags);
  const replaceWith = options.replaceWith ?? '';

  if (!pattern) {
    return {
      error: '',
      flags,
      matches: [],
      pattern,
      replacePreview: options.text,
      valid: true
    };
  }

  try {
    const regex = new RegExp(pattern, flags);
    const matches: RegexMatchResult[] = [];

    if (flags.includes('g')) {
      for (const match of options.text.matchAll(regex)) {
        matches.push({
          groups: match.slice(1).map((group) => group ?? ''),
          index: match.index ?? 0,
          text: match[0]
        });
      }
    } else {
      const match = regex.exec(options.text);

      if (match) {
        matches.push({
          groups: match.slice(1).map((group) => group ?? ''),
          index: match.index ?? 0,
          text: match[0]
        });
      }
    }

    const replaceRegex = new RegExp(pattern, options.flags.replace(/g/g, ''));

    return {
      error: '',
      flags,
      matches,
      pattern,
      replacePreview: options.text.replace(replaceRegex, replaceWith),
      valid: true
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : '正则表达式无效',
      flags,
      matches: [],
      pattern,
      replacePreview: options.text,
      valid: false
    };
  }
}
