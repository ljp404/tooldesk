export type ClipboardMatchPreset =
  | 'amount-lines'
  | 'bank-card'
  | 'base64'
  | 'calculator-expression'
  | 'cron'
  | 'decimal-amount'
  | 'html'
  | 'http-url'
  | 'id-card'
  | 'ip'
  | 'iso-date'
  | 'json'
  | 'jwt'
  | 'timestamp'
  | 'url-encoded';

export interface ClipboardMatchConfig {
  priority?: number;
  type: ClipboardMatchPreset;
}

export interface ClipboardMatchRule {
  kind: string;
  match: (content: string) => boolean;
  priority: number;
}

const timestampMin = new Date('2000-01-01T00:00:00.000Z').getTime();
const timestampMax = new Date('2100-01-01T00:00:00.000Z').getTime();

export const CLIPBOARD_MATCH_DEFAULT_PRIORITIES: Record<ClipboardMatchPreset, number> = {
  'amount-lines': 79,
  'bank-card': 95,
  base64: 87,
  'calculator-expression': 97,
  cron: 86,
  'decimal-amount': 81,
  html: 91,
  'http-url': 84,
  'id-card': 96,
  ip: 89,
  'iso-date': 85,
  json: 90,
  jwt: 88,
  timestamp: 100,
  'url-encoded': 83
};

const clipboardMatchPresetSet = new Set<string>(Object.keys(CLIPBOARD_MATCH_DEFAULT_PRIORITIES));

export function isClipboardMatchPreset(value: string): value is ClipboardMatchPreset {
  return clipboardMatchPresetSet.has(value);
}

export function createJsonMatcher(extractJsonText: (content: string) => string | null = (content) => content.trim() || null) {
  return (content: string) => {
    const jsonText = extractJsonText(content);

    if (!jsonText) {
      return false;
    }

    try {
      const parsed = JSON.parse(jsonText) as unknown;
      return parsed !== null && typeof parsed === 'object';
    } catch {
      return false;
    }
  };
}

export function isHttpUrl(content: string) {
  return /^https?:\/\//i.test(content);
}

export function isUrlEncodedContent(content: string) {
  const trimmed = content.trim();

  if (!/%[0-9a-f]{2}/i.test(trimmed)) {
    return false;
  }

  try {
    return decodeURIComponent(trimmed) !== trimmed;
  } catch {
    return false;
  }
}

export function isBankCardNumber(content: string) {
  const value = content.trim();

  if (!/^[\d\s-]+$/.test(value)) {
    return false;
  }

  const digits = value.replace(/[\s-]/g, '');

  return /^\d{13,19}$/.test(digits);
}

export function isIdCardNumber(content: string) {
  const value = content.trim().toUpperCase().replace(/\s+/g, '');

  return /^\d{15}$/.test(value) || /^\d{17}[\dX]$/.test(value);
}

function isValidIpv4Octet(value: string) {
  if (!/^(0|[1-9]\d{0,2})$/.test(value)) {
    return false;
  }

  return Number(value) <= 255;
}

export function isIpAddress(content: string) {
  const value = content.trim();

  if (!value || /\s/.test(value)) {
    return false;
  }

  const octets = value.split('.');

  if (octets.length === 4) {
    return octets.every(isValidIpv4Octet);
  }

  return false;
}

export function isTimestamp(content: string) {
  if (!/^\d{10}(\d{3})?$/.test(content)) {
    return false;
  }

  const timestamp = Number(content.length === 10 ? `${content}000` : content);
  return Number.isSafeInteger(timestamp) && timestamp >= timestampMin && timestamp < timestampMax;
}

export function isJwt(content: string) {
  return /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(content.trim());
}

export function isBase64Content(content: string) {
  const trimmed = content.trim();
  const dataUrlMatch = /^data:[^;,]+;base64,([A-Za-z0-9+/=_-]+)$/i.exec(trimmed);
  const value = (dataUrlMatch ? dataUrlMatch[1] : trimmed).replace(/\s+/g, '');

  if (value.length < 16 || /^\d+$/.test(value)) {
    return false;
  }

  if (!/^[A-Za-z0-9+/=_-]+$/.test(value)) {
    return false;
  }

  return value.length % 4 !== 1;
}

export function isHtmlContent(content: string) {
  const trimmed = content.trim();

  if (!trimmed || trimmed.length < 8) {
    return false;
  }

  if (/^<!doctype\s+html\b/i.test(trimmed)) {
    return true;
  }

  return /<\/?[a-z][\w:-]*(?:\s[^<>]*)?>/i.test(trimmed) && /<\/[a-z][\w:-]*>/i.test(trimmed);
}

export function isCalculatorExpression(content: string) {
  const trimmed = content.trim();

  if (!trimmed || trimmed.includes('\n')) {
    return false;
  }

  if (isHttpUrl(trimmed)) {
    return false;
  }

  if (isIsoDate(trimmed)) {
    return false;
  }

  const normalizedExpression = trimmed.replace(/=+\s*$/, '');
  const withoutNumberSeparators = normalizedExpression.replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '');

  if (!/^[\d\s.+\-*/^%()]+$/.test(withoutNumberSeparators)) {
    return false;
  }

  if (!/[\d]/.test(withoutNumberSeparators) || !/[+\-*/^%()]/.test(withoutNumberSeparators)) {
    return false;
  }

  if (/^\d{10}(\d{3})?$/.test(withoutNumberSeparators)) {
    return false;
  }

  const fields = withoutNumberSeparators.split(/\s+/);
  if ((fields.length === 5 || fields.length === 6) && fields.every((field) => /^[\d*/,\-A-Z#a-z?LW]+$/.test(field))) {
    return false;
  }

  return true;
}

export function isCronExpression(content: string) {
  const trimmed = content.trim();

  if (!trimmed || trimmed.includes('\n')) {
    return false;
  }

  const fields = trimmed.split(/\s+/);

  if (fields.length !== 5 && fields.length !== 6) {
    return false;
  }

  return fields.every((field) => /^[\d*/,\-A-Z#a-z?LW]+$/.test(field));
}

function normalizeAmountToken(content: string) {
  return content.trim().replace(/[¥￥,\s]/g, '');
}

export function isDecimalAmount(content: string) {
  const trimmed = content.trim();

  if (!trimmed || trimmed.includes('\n')) {
    return false;
  }

  if (/^\d{10}(\d{3})?$/.test(trimmed)) {
    return false;
  }

  const normalized = normalizeAmountToken(trimmed);

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) {
    return false;
  }

  return Number.isFinite(Number(normalized));
}

export function isAmountLines(content: string) {
  const lines = content
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return false;
  }

  let amountLineCount = 0;

  for (const line of lines) {
    const normalized = normalizeAmountToken(line);

    if (/^-?\d+(\.\d+)?$/.test(normalized) && Number.isFinite(Number(normalized))) {
      amountLineCount += 1;
    }
  }

  return amountLineCount >= 2;
}

export function isIsoDate(content: string) {
  const trimmed = content.trim();

  if (!trimmed || trimmed.includes('\n')) {
    return false;
  }

  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(trimmed);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function createClipboardMatchPresetMap(jsonMatcher = createJsonMatcher()) {
  return {
    'amount-lines': isAmountLines,
    'bank-card': isBankCardNumber,
    base64: isBase64Content,
    'calculator-expression': isCalculatorExpression,
    cron: isCronExpression,
    'decimal-amount': isDecimalAmount,
    html: isHtmlContent,
    'http-url': isHttpUrl,
    'id-card': isIdCardNumber,
    ip: isIpAddress,
    'iso-date': isIsoDate,
    json: jsonMatcher,
    jwt: isJwt,
    timestamp: isTimestamp,
    'url-encoded': isUrlEncodedContent
  } satisfies Record<ClipboardMatchPreset, (content: string) => boolean>;
}

export function normalizeClipboardMatchConfig(raw: unknown): ClipboardMatchConfig[] {
  const entries = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? [raw] : [];
  const normalized: ClipboardMatchConfig[] = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const type = String((entry as ClipboardMatchConfig).type ?? '')
      .trim()
      .toLowerCase();

    if (!isClipboardMatchPreset(type)) {
      continue;
    }

    const priorityValue = (entry as ClipboardMatchConfig).priority;
    const priority =
      typeof priorityValue === 'number' && Number.isFinite(priorityValue)
        ? Math.trunc(priorityValue)
        : CLIPBOARD_MATCH_DEFAULT_PRIORITIES[type];

    normalized.push({
      priority,
      type
    });
  }

  return normalized;
}

export function buildClipboardMatchRules(
  kind: string,
  raw: unknown,
  presetMap = createClipboardMatchPresetMap()
): ClipboardMatchRule[] {
  const toolKey = String(kind ?? '').trim();

  if (!toolKey) {
    return [];
  }

  return normalizeClipboardMatchConfig(raw).map((config) => ({
    kind: toolKey,
    match: presetMap[config.type],
    priority: config.priority ?? CLIPBOARD_MATCH_DEFAULT_PRIORITIES[config.type]
  }));
}

export function resolveMatchedToolKeys(content: string, rules: ClipboardMatchRule[]) {
  const value = content.trim();

  if (!value) {
    return [];
  }

  const matchedKeys = rules
    .filter((rule) => rule.match(value))
    .sort((current, next) => next.priority - current.priority)
    .map((rule) => rule.kind);

  return Array.from(new Set(matchedKeys));
}
