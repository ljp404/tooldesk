export interface JwtDecodedPart {
  json: string;
  object: Record<string, unknown> | unknown[] | null;
  raw: string;
}

export interface JwtDecodeResult {
  header: JwtDecodedPart;
  payload: JwtDecodedPart;
  signature: string;
}

function decodeBase64Binary(value: string) {
  return atob(value);
}

function encodeBase64Binary(value: string) {
  return btoa(value);
}

function normalizeBase64Input(value: string, urlSafe: boolean) {
  let normalized = value.trim().replace(/\s+/g, '');

  if (urlSafe) {
    normalized = normalized.replace(/-/g, '+').replace(/_/g, '/');
  }

  const padding = normalized.length % 4;

  if (padding) {
    normalized += '='.repeat(4 - padding);
  }

  return normalized;
}

function toBase64Url(value: string) {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBinaryToUtf8(binary: string) {
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeUtf8ToBinary(value: string) {
  const bytes = new TextEncoder().encode(value);
  return String.fromCharCode(...bytes);
}

export function decodeBase64Text(value: string, urlSafe = false) {
  const normalized = normalizeBase64Input(value, urlSafe);

  try {
    return decodeBinaryToUtf8(decodeBase64Binary(normalized));
  } catch {
    throw new Error('Base64 解码失败');
  }
}

export function encodeBase64Text(value: string, urlSafe = false) {
  const encoded = encodeBase64Binary(encodeUtf8ToBinary(value));
  return urlSafe ? toBase64Url(encoded) : encoded;
}

export function decodeUrlText(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    throw new Error('URL 解码失败');
  }
}

export function encodeUrlText(value: string) {
  return encodeURIComponent(value);
}

function decodeBase64UrlPart(value: string) {
  const normalized = normalizeBase64Input(value, true);
  const binary = decodeBase64Binary(normalized);
  return decodeBinaryToUtf8(binary);
}

function parseJsonPart(raw: string): JwtDecodedPart['object'] {
  try {
    return JSON.parse(raw) as JwtDecodedPart['object'];
  } catch {
    return null;
  }
}

export function decodeJwt(token: string): JwtDecodeResult {
  const parts = token.trim().split('.');

  if (parts.length < 2) {
    throw new Error('JWT 格式无效');
  }

  const [headerRaw, payloadRaw, signature = ''] = parts;

  try {
    const headerDecoded = decodeBase64UrlPart(headerRaw);
    const payloadDecoded = decodeBase64UrlPart(payloadRaw);

    return {
      header: {
        json: headerDecoded,
        object: parseJsonPart(headerDecoded),
        raw: headerRaw
      },
      payload: {
        json: payloadDecoded,
        object: parseJsonPart(payloadDecoded),
        raw: payloadRaw
      },
      signature
    };
  } catch {
    throw new Error('JWT 解码失败');
  }
}

export function formatJwtClaims(payload: Record<string, unknown> | unknown[] | null) {
  if (!payload || Array.isArray(payload)) {
    return [];
  }

  const rows: Array<{ label: string; value: string }> = [];
  const claimLabels: Record<string, string> = {
    aud: '受众 aud',
    exp: '过期 exp',
    iat: '签发 iat',
    iss: '签发者 iss',
    jti: 'ID jti',
    nbf: '生效 nbf',
    sub: '主题 sub'
  };

  for (const [key, label] of Object.entries(claimLabels)) {
    if (!(key in payload)) {
      continue;
    }

    const value = payload[key];
    rows.push({
      label,
      value: formatClaimValue(key, value)
    });
  }

  return rows;
}

function formatClaimValue(key: string, value: unknown) {
  if ((key === 'exp' || key === 'iat' || key === 'nbf') && typeof value === 'number') {
    const date = new Date(value * 1000);

    if (!Number.isNaN(date.getTime())) {
      return `${value} · ${date.toLocaleString()}`;
    }
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

export function prettyJson(value: unknown) {
  if (value === null || value === undefined) {
    return '';
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
