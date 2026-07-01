import * as crypto from 'node:crypto';

const CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, x-tooldesk-app-version, x-tooldesk-body-sha256, x-tooldesk-device-id, x-tooldesk-nonce, x-tooldesk-signature, x-tooldesk-timestamp, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*'
};

type TranslateProvider = 'baidu' | 'tencent' | 'aliyun';

interface ServiceRequest {
  action?: 'ocr.baidu' | 'pull' | 'push' | 'sync.pull' | 'sync.push' | 'translate' | 'update.portable-url';
  accountHash?: string;
  apiVariant?: 'accurate_located' | 'standard_located';
  bucket?: string;
  fileName?: string;
  from?: string;
  imageBase64?: string;
  mode?: 'fast_text' | 'positioned';
  objectKey?: string;
  payload?: unknown;
  schemaVersion?: number;
  text?: string;
  to?: string;
  version?: string;
}

interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}

const MAX_REQUEST_BYTES = 8 * 1024 * 1024;
const SYNC_BUCKET = 'tooldesk-sync';
const SYNC_RATE_LIMIT_PER_MINUTE = 30;
const SYNC_RATE_LIMIT_PER_DAY = 300;
let baiduOcrTokenCache: { accessToken: string; expiresAt: number } | null = null;

function getRequestIp(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  const realIp = request.headers.get('x-real-ip')?.trim();
  const cfIp = request.headers.get('cf-connecting-ip')?.trim();
  return forwardedFor || realIp || cfIp || 'unknown';
}

function normalizeDeviceId(value: string | null) {
  const trimmed = String(value ?? '').trim().toLowerCase();
  return /^[a-f0-9-]{32,64}$/.test(trimmed) ? trimmed : 'unknown';
}

function compareVersion(left: string, right: string) {
  const leftParts = left.split('.').map((part) => Number(part) || 0);
  const rightParts = right.split('.').map((part) => Number(part) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue > rightValue) {
      return 1;
    }

    if (leftValue < rightValue) {
      return -1;
    }
  }

  return 0;
}

function assertClientVersion(request: Request) {
  const minVersion = getEnv('TOOLDESK_MIN_CLIENT_VERSION');

  if (!minVersion) {
    return;
  }

  const clientVersion = request.headers.get('x-tooldesk-app-version')?.trim() ?? '';

  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(clientVersion) || compareVersion(clientVersion, minVersion) < 0) {
    throw new Error('Client version is no longer supported');
  }
}

function assertRequestSize(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0);

  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    throw new Error('Request body is too large');
  }
}

function getRateLimitRule(action?: ServiceRequest['action']): RateLimitRule {
  if (action === 'update.portable-url') {
    return {
      limit: Number(getEnv('TOOLDESK_UPDATE_RATE_LIMIT_PER_MINUTE')) || 30,
      windowSeconds: 60
    };
  }

  if (action === 'ocr.baidu') {
    return {
      limit: Number(getEnv('TOOLDESK_OCR_RATE_LIMIT_PER_MINUTE')) || 20,
      windowSeconds: 60
    };
  }

  if (action === 'pull' || action === 'push' || action === 'sync.pull' || action === 'sync.push') {
    return {
      limit: SYNC_RATE_LIMIT_PER_MINUTE,
      windowSeconds: 60
    };
  }

  return {
    limit: Number(getEnv('TOOLDESK_TRANSLATE_RATE_LIMIT_PER_MINUTE')) || 60,
    windowSeconds: 60
  };
}

function getDailyRateLimitRule(action?: ServiceRequest['action']): RateLimitRule {
  if (action === 'update.portable-url') {
    return {
      limit: Number(getEnv('TOOLDESK_UPDATE_RATE_LIMIT_PER_DAY')) || 500,
      windowSeconds: 86_400
    };
  }

  if (action === 'ocr.baidu') {
    return {
      limit: Number(getEnv('TOOLDESK_OCR_RATE_LIMIT_PER_DAY')) || 200,
      windowSeconds: 86_400
    };
  }

  if (action === 'pull' || action === 'push' || action === 'sync.pull' || action === 'sync.push') {
    return {
      limit: SYNC_RATE_LIMIT_PER_DAY,
      windowSeconds: 86_400
    };
  }

  return {
    limit: Number(getEnv('TOOLDESK_TRANSLATE_RATE_LIMIT_PER_DAY')) || 1_000,
    windowSeconds: 86_400
  };
}

function assertClientToken(request: Request) {
  const expected = getEnv('TOOLDESK_SERVICE_CLIENT_TOKEN');

  if (!expected) {
    return;
  }

  const timestamp = request.headers.get('x-tooldesk-timestamp')?.trim() ?? '';
  const nonce = request.headers.get('x-tooldesk-nonce')?.trim() ?? '';
  const bodySha256 = request.headers.get('x-tooldesk-body-sha256')?.trim() ?? '';
  const actual = request.headers.get('x-tooldesk-signature')?.trim() ?? '';
  const timestampMs = Number(timestamp);

  if (!timestamp && !nonce && !bodySha256 && !actual) {
    return;
  }

  if (!timestamp || !nonce || !bodySha256 || !actual || !Number.isFinite(timestampMs)) {
    throw new Error('Missing request signature');
  }

  if (Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    throw new Error('Expired request signature');
  }

  if (!/^[a-f0-9-]{32,64}$/i.test(nonce) || !/^[a-f0-9]{64}$/i.test(bodySha256) || !/^[a-f0-9]{64}$/i.test(actual)) {
    throw new Error('Invalid request signature');
  }

  const expectedSignature = crypto
    .createHmac('sha256', expected)
    .update(`${timestamp}.${nonce}.${bodySha256}`, 'utf8')
    .digest('hex');

  const actualBuffer = hexToBytes(actual);
  const expectedBuffer = hexToBytes(expectedSignature);

  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('Unauthorized client');
  }
}

function hexToBytes(value: string) {
  const bytes = new Uint8Array(value.length / 2);

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }

  return bytes;
}

async function assertNonceNotReplayed(request: Request) {
  if (!getEnv('TOOLDESK_SERVICE_CLIENT_TOKEN')) {
    return;
  }

  const nonce = request.headers.get('x-tooldesk-nonce')?.trim() ?? '';
  const deviceId = normalizeDeviceId(request.headers.get('x-tooldesk-device-id'));
  const key = `tooldesk:svc:nonce:${deviceId}:${nonce}`;
  const config = getUpstashConfig();

  if (!config) {
    throw new Error('Missing Upstash Redis config for nonce replay protection');
  }

  const response = await fetch(`${config.url}/pipeline`, {
    body: JSON.stringify([['SET', key, '1', 'NX', 'EX', '300']]),
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });

  if (!response.ok) {
    throw new Error(`Nonce backend failed HTTP ${response.status}`);
  }

  const result = await response.json() as Array<{ result?: string | null }>;

  if (result[0]?.result !== 'OK') {
    throw new Error('Replayed request');
  }
}

function requireUpstashConfig() {
  const config = getUpstashConfig();

  if (!config) {
    throw new Error('Missing Upstash Redis config for rate limiting');
  }

  return config;
}

function getUpstashConfig() {
  const url = getEnv('UPSTASH_REDIS_REST_URL', 'TOOLDESK_UPSTASH_REDIS_REST_URL');
  const token = getEnv('UPSTASH_REDIS_REST_TOKEN', 'TOOLDESK_UPSTASH_REDIS_REST_TOKEN');
  return url && token ? { token, url: url.replace(/\/+$/, '') } : null;
}

async function checkUpstashRateLimit(key: string, rule: RateLimitRule) {
  const config = requireUpstashConfig();

  const response = await fetch(`${config.url}/pipeline`, {
    body: JSON.stringify([
      ['INCR', key],
      ['EXPIRE', key, String(rule.windowSeconds)]
    ]),
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });

  if (!response.ok) {
    throw new Error(`Rate limit backend failed HTTP ${response.status}`);
  }

  const result = await response.json() as Array<{ result?: number }>;
  const count = Number(result[0]?.result ?? 0);
  return count <= rule.limit;
}

async function assertRateLimit(request: Request, action?: ServiceRequest['action']) {
  const ip = getRequestIp(request);
  const deviceId = normalizeDeviceId(request.headers.get('x-tooldesk-device-id'));
  const windows = [
    {
      label: 'minute',
      rule: getRateLimitRule(action)
    },
    {
      label: 'day',
      rule: getDailyRateLimitRule(action)
    }
  ];

  for (const item of windows) {
    const bucket = Math.floor(Date.now() / (item.rule.windowSeconds * 1000));
    const keys = [
      `tooldesk:svc:${action ?? 'unknown'}:${item.label}:ip:${ip}:${bucket}`,
      `tooldesk:svc:${action ?? 'unknown'}:${item.label}:device:${deviceId}:${bucket}`
    ];

    for (const key of keys) {
      const allowed = await checkUpstashRateLimit(key, item.rule);

      if (!allowed) {
        return jsonResponse({ error: '请求过于频繁，请稍后再试' }, 429);
      }
    }
  }

  return null;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8'
    },
    status
  });
}

function normalizeSyncAccountHash(value: unknown) {
  const accountHash = String(value ?? '').trim().toLowerCase();

  if (!/^[a-f0-9]{64}$/.test(accountHash)) {
    throw new Error('Invalid sync account');
  }

  return accountHash;
}

function normalizeSyncBucket(value: unknown) {
  const bucket = SYNC_BUCKET;
  const requestedBucket = String(value ?? '').trim();

  if (!/^[a-z0-9][a-z0-9._-]{1,62}$/i.test(bucket)) {
    throw new Error('Invalid sync bucket');
  }

  if (requestedBucket && requestedBucket !== bucket) {
    throw new Error('Invalid sync bucket');
  }

  return bucket;
}

function normalizeSyncObjectKey(value: unknown, accountHash: string) {
  const objectKey = String(value ?? '').trim();
  const expectedPrefix = `tooldesk/sync/v1/${accountHash}/`;

  if (!objectKey.startsWith(expectedPrefix) || objectKey.includes('..') || objectKey.includes('\\')) {
    throw new Error('Invalid sync object key');
  }

  return objectKey;
}

function getSupabaseStorageConfig() {
  const supabaseUrl = getRequiredEnv('SUPABASE_URL').replace(/\/+$/, '');
  const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');

  return { serviceRoleKey, supabaseUrl };
}

function createStorageObjectUrl(bucket: string, objectKey: string) {
  const { supabaseUrl } = getSupabaseStorageConfig();
  const encodedPath = objectKey
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');

  return `${supabaseUrl}/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`;
}

function getStorageHeaders(contentType = 'application/json; charset=utf-8') {
  const { serviceRoleKey } = getSupabaseStorageConfig();

  return {
    Authorization: `Bearer ${serviceRoleKey}`,
    apikey: serviceRoleKey,
    'Content-Type': contentType
  };
}

async function readStorageObject(bucket: string, objectKey: string) {
  const response = await fetch(createStorageObjectUrl(bucket, objectKey), {
    headers: getStorageHeaders(),
    method: 'GET'
  });
  const body = await response.text();

  if (response.status === 404) {
    return null;
  }

  if (response.status === 400 && /not[_\s-]?found|object not found|statusCode"\s*:\s*"404/i.test(body)) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Sync storage read failed HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error('Sync storage returned invalid JSON');
  }
}

async function writeStorageObject(bucket: string, objectKey: string, payload: unknown) {
  const response = await fetch(createStorageObjectUrl(bucket, objectKey), {
    body: JSON.stringify(payload),
    headers: {
      ...getStorageHeaders(),
      'x-upsert': 'true'
    },
    method: 'POST'
  });
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`Sync storage write failed HTTP ${response.status}: ${body.slice(0, 200)}`);
  }
}

async function syncCloud(payload: ServiceRequest) {
  const accountHash = normalizeSyncAccountHash(payload.accountHash);
  const bucket = normalizeSyncBucket(payload.bucket);
  const objectKey = normalizeSyncObjectKey(payload.objectKey, accountHash);

  if (payload.action === 'pull' || payload.action === 'sync.pull') {
    const snapshot = await readStorageObject(bucket, objectKey);
    return snapshot ? { exists: true, payload: snapshot } : { exists: false };
  }

  if (payload.action === 'push' || payload.action === 'sync.push') {
    if (!payload.payload || typeof payload.payload !== 'object') {
      throw new Error('Missing sync payload');
    }

    await writeStorageObject(bucket, objectKey, payload.payload);
    return { ok: true };
  }

  throw new Error('Unsupported sync action');
}

function getEnv(...names: string[]) {
  for (const name of names) {
    const value = Deno.env.get(name)?.trim();

    if (value) {
      return value;
    }
  }

  return '';
}

function getRequiredEnv(...names: string[]) {
  const value = getEnv(...names);

  if (!value) {
    throw new Error(`Missing ${names.join(' or ')}`);
  }

  return value;
}

function mapLanguageCode(code: string, provider: TranslateProvider) {
  const normalized = code.trim().toLowerCase();

  if (!normalized || normalized === 'auto') {
    return 'auto';
  }

  const table: Record<string, Record<TranslateProvider, string>> = {
    de: { aliyun: 'de', baidu: 'de', tencent: 'de' },
    en: { aliyun: 'en', baidu: 'en', tencent: 'en' },
    es: { aliyun: 'es', baidu: 'spa', tencent: 'es' },
    fr: { aliyun: 'fr', baidu: 'fra', tencent: 'fr' },
    ja: { aliyun: 'ja', baidu: 'jp', tencent: 'ja' },
    ko: { aliyun: 'ko', baidu: 'kor', tencent: 'ko' },
    ru: { aliyun: 'ru', baidu: 'ru', tencent: 'ru' },
    'zh-cn': { aliyun: 'zh', baidu: 'zh', tencent: 'zh' },
    'zh-tw': { aliyun: 'zh-tw', baidu: 'cht', tencent: 'zh-TW' }
  };

  return table[normalized]?.[provider] ?? normalized;
}

async function requestJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, init);
  const body = await response.text();

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
  }

  try {
    return JSON.parse(body) as T;
  } catch {
    throw new Error('Remote service returned invalid JSON');
  }
}

function getBaiduOcrApiPath(apiVariant?: string, mode?: string) {
  if (mode === 'fast_text') {
    return apiVariant === 'accurate_located' ? '/rest/2.0/ocr/v1/accurate_basic' : '/rest/2.0/ocr/v1/general_basic';
  }

  return apiVariant === 'accurate_located' ? '/rest/2.0/ocr/v1/accurate' : '/rest/2.0/ocr/v1/general';
}

async function fetchBaiduOcrToken() {
  if (baiduOcrTokenCache && baiduOcrTokenCache.expiresAt > Date.now() + 60_000) {
    return baiduOcrTokenCache.accessToken;
  }

  const apiKey = getRequiredEnv('TOOLDESK_BAIDU_OCR_API_KEY', 'BAIDU_OCR_API_KEY');
  const secretKey = getRequiredEnv('TOOLDESK_BAIDU_OCR_SECRET_KEY', 'BAIDU_OCR_SECRET_KEY');
  const params = new URLSearchParams({
    client_id: apiKey,
    client_secret: secretKey,
    grant_type: 'client_credentials'
  });
  const response = await requestJson<{
    access_token?: string;
    error?: string;
    error_description?: string;
    expires_in?: number;
  }>(`https://aip.baidubce.com/oauth/2.0/token?${params.toString()}`, {
    method: 'POST'
  });

  if (!response.access_token) {
    throw new Error(response.error_description ?? response.error ?? '获取百度 OCR Token 失败');
  }

  const expiresIn = Number(response.expires_in ?? 2_592_000);
  baiduOcrTokenCache = {
    accessToken: response.access_token,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000
  };

  return baiduOcrTokenCache.accessToken;
}

async function recognizeBaiduOcr(payload: ServiceRequest) {
  const imageBase64 = String(payload.imageBase64 ?? '').trim();

  if (!imageBase64) {
    throw new Error('Missing imageBase64');
  }

  if (imageBase64.length > 6_000_000) {
    throw new Error('Image is too large');
  }

  const accessToken = await fetchBaiduOcrToken();
  const body = new URLSearchParams({
    detect_direction: 'true',
    image: imageBase64,
    paragraph: 'false',
    probability: 'false',
    vertexes_location: 'false'
  }).toString();
  const response = await requestJson<{
    error_code?: number;
    error_msg?: string;
    words_result?: unknown[];
  }>(`https://aip.baidubce.com${getBaiduOcrApiPath(payload.apiVariant, payload.mode)}?access_token=${encodeURIComponent(accessToken)}`, {
    body,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    method: 'POST'
  });

  if (response.error_code) {
    throw new Error(response.error_msg ?? `百度 OCR 错误 ${response.error_code}`);
  }

  return { wordsResult: response.words_result ?? [] };
}

async function translateWithBaidu(text: string, from: string, to: string) {
  const appId = getRequiredEnv('TOOLDESK_BAIDU_TRANSLATE_APP_ID', 'BAIDU_TRANSLATE_APP_ID');
  const secretKey = getRequiredEnv('TOOLDESK_BAIDU_TRANSLATE_SECRET_KEY', 'BAIDU_TRANSLATE_SECRET_KEY');
  const salt = String(Date.now());
  const sign = crypto.createHash('md5').update(`${appId}${text}${salt}${secretKey}`).digest('hex');
  const params = new URLSearchParams({
    appid: appId,
    from: mapLanguageCode(from, 'baidu'),
    q: text,
    salt,
    sign,
    to: mapLanguageCode(to, 'baidu')
  });
  const response = await requestJson<{
    error_code?: string;
    error_msg?: string;
    trans_result?: Array<{ dst: string; src: string }>;
  }>(`https://fanyi-api.baidu.com/api/trans/vip/translate?${params.toString()}`);

  if (response.error_code) {
    throw new Error(response.error_msg || `百度翻译错误 ${response.error_code}`);
  }

  const translated = response.trans_result?.map((item) => item.dst).join('\n').trim();

  if (!translated) {
    throw new Error('百度翻译未返回结果');
  }

  return translated;
}

function sha256(value: string) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmacSha256(key: string | Uint8Array, value: string) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest();
}

function hmacSha1Hex(key: string | Uint8Array, value: string) {
  return crypto.createHmac('sha1', key).update(value, 'utf8').digest('hex');
}

async function translateWithTencent(text: string, from: string, to: string) {
  const secretId = getRequiredEnv('TOOLDESK_TENCENT_TRANSLATE_SECRET_ID', 'TENCENT_TRANSLATE_SECRET_ID');
  const secretKey = getRequiredEnv('TOOLDESK_TENCENT_TRANSLATE_SECRET_KEY', 'TENCENT_TRANSLATE_SECRET_KEY');
  const region = getEnv('TOOLDESK_TENCENT_TRANSLATE_REGION', 'TENCENT_TRANSLATE_REGION') || 'ap-guangzhou';
  const payload = JSON.stringify({
    ProjectId: 0,
    Source: mapLanguageCode(from, 'tencent'),
    SourceText: text,
    Target: mapLanguageCode(to, 'tencent')
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = 'content-type:application/json; charset=utf-8\nhost:tmt.tencentcloudapi.com\n';
  const signedHeaders = 'content-type;host';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, sha256(payload)].join('\n');
  const credentialScope = `${date}/tmt/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), credentialScope, sha256(canonicalRequest)].join('\n');
  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, 'tmt');
  const secretSigning = hmacSha256(secretService, 'tc3_request');
  const signature = hmacSha256(secretSigning, stringToSign).toString('hex');
  const authorization = `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  const response = await requestJson<{
    Response: {
      Error?: { Code: string; Message: string };
      TargetText?: string;
    };
  }>('https://tmt.tencentcloudapi.com/', {
    body: payload,
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/json; charset=utf-8',
      Host: 'tmt.tencentcloudapi.com',
      'X-TC-Action': 'TextTranslate',
      'X-TC-Region': region,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': '2018-03-21'
    },
    method: 'POST'
  });

  if (response.Response.Error) {
    throw new Error(response.Response.Error.Message || response.Response.Error.Code);
  }

  const translated = response.Response.TargetText?.trim();

  if (!translated) {
    throw new Error('腾讯云翻译未返回结果');
  }

  return translated;
}

function percentEncode(value: string) {
  return encodeURIComponent(value)
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~');
}

async function translateWithAliyun(text: string, from: string, to: string) {
  const accessKeyId = getRequiredEnv('TOOLDESK_ALIYUN_TRANSLATE_ACCESS_KEY_ID', 'ALIYUN_TRANSLATE_ACCESS_KEY_ID');
  const accessKeySecret = getRequiredEnv('TOOLDESK_ALIYUN_TRANSLATE_ACCESS_KEY_SECRET', 'ALIYUN_TRANSLATE_ACCESS_KEY_SECRET');
  const region = getEnv('TOOLDESK_ALIYUN_TRANSLATE_REGION', 'ALIYUN_TRANSLATE_REGION') || 'cn-hangzhou';
  const params: Record<string, string> = {
    AccessKeyId: accessKeyId,
    Action: 'TranslateGeneral',
    Format: 'JSON',
    FormatType: 'text',
    RegionId: region,
    Scene: 'general',
    SignatureMethod: 'HMAC-SHA1',
    SignatureNonce: crypto.randomUUID(),
    SignatureVersion: '1.0',
    SourceLanguage: mapLanguageCode(from, 'aliyun'),
    SourceText: text,
    TargetLanguage: mapLanguageCode(to, 'aliyun'),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    Version: '2018-10-12'
  };
  const canonicalized = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${percentEncode(key)}=${percentEncode(value)}`)
    .join('&');
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonicalized)}`;
  params.Signature = crypto.createHmac('sha1', `${accessKeySecret}&`).update(stringToSign, 'utf8').digest('base64');
  const response = await requestJson<{
    Code?: string;
    Data?: { Translated?: string };
    Message?: string;
  }>(`https://mt.${region}.aliyuncs.com/`, {
    body: new URLSearchParams(params).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    method: 'POST'
  });

  if (response.Code && response.Code !== '200') {
    throw new Error(response.Message || `阿里云翻译错误 ${response.Code}`);
  }

  const translated = response.Data?.Translated?.trim();

  if (!translated) {
    throw new Error('阿里云翻译未返回结果');
  }

  return translated;
}

async function translate(payload: ServiceRequest) {
  const text = String(payload.text ?? '').trim();
  const from = String(payload.from ?? 'auto').trim() || 'auto';
  const to = String(payload.to ?? 'zh-cn').trim() || 'zh-cn';
  const provider = (getEnv('TOOLDESK_TRANSLATE_PROVIDER', 'TRANSLATE_PROVIDER') || 'baidu') as TranslateProvider;

  if (!text) {
    throw new Error('Missing text');
  }

  if (text.length > 5_000) {
    throw new Error('Text is too long');
  }

  if (from !== 'auto' && from === to) {
    throw new Error('源语言和目标语言不能相同');
  }

  if (provider === 'tencent') {
    return { provider, text: await translateWithTencent(text, from, to) };
  }

  if (provider === 'aliyun') {
    return { provider, text: await translateWithAliyun(text, from, to) };
  }

  return { provider: 'baidu', text: await translateWithBaidu(text, from, to) };
}

function encodeCosPath(value: string) {
  return value
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function getCosPublicBase() {
  const publicBaseUrl = getEnv('TOOLDESK_UPDATE_COS_PUBLIC_BASE_URL', 'TOOLDESK_COS_PUBLIC_BASE_URL');

  if (publicBaseUrl) {
    return new URL(publicBaseUrl.endsWith('/') ? publicBaseUrl : `${publicBaseUrl}/`);
  }

  const bucket = getRequiredEnv('TOOLDESK_UPDATE_COS_BUCKET', 'TOOLDESK_COS_BUCKET');
  const region = getRequiredEnv('TOOLDESK_UPDATE_COS_REGION', 'TOOLDESK_COS_REGION');
  return new URL(`https://${bucket}.cos.${region}.myqcloud.com/`);
}

function createCosSignedGetUrl(objectKey: string, expiresSeconds: number) {
  const secretId = getRequiredEnv('TOOLDESK_UPDATE_COS_SECRET_ID', 'TOOLDESK_COS_SECRET_ID');
  const secretKey = getRequiredEnv('TOOLDESK_UPDATE_COS_SECRET_KEY', 'TOOLDESK_COS_SECRET_KEY');
  const baseUrl = getCosPublicBase();
  const now = Math.floor(Date.now() / 1000);
  const end = now + expiresSeconds;
  const keyTime = `${now};${end}`;
  const host = baseUrl.host;
  const objectPath = encodeCosPath(objectKey);
  const formatString = `get\n/${objectPath}\n\nhost=${host}\n`;
  const stringToSign = `sha1\n${keyTime}\n${sha256(formatString)}\n`;
  const signKey = hmacSha1Hex(secretKey, keyTime);
  const signature = hmacSha1Hex(signKey, stringToSign);
  const url = new URL(objectPath, baseUrl);

  url.searchParams.set('q-sign-algorithm', 'sha1');
  url.searchParams.set('q-ak', secretId);
  url.searchParams.set('q-sign-time', keyTime);
  url.searchParams.set('q-key-time', keyTime);
  url.searchParams.set('q-header-list', 'host');
  url.searchParams.set('q-url-param-list', '');
  url.searchParams.set('q-signature', signature);

  return {
    expiresAt: new Date(end * 1000).toISOString(),
    url: url.toString()
  };
}

function resolvePortableUpdateUrl(payload: ServiceRequest) {
  const fileName = String(payload.fileName ?? '').trim();
  const version = String(payload.version ?? '').trim();

  if (!/^tooldesk-Portable-[0-9]+\.[0-9]+\.[0-9]+-x64\.exe$/i.test(fileName)) {
    throw new Error('Invalid portable update file name');
  }

  if (!version || !fileName.includes(`-${version}-`)) {
    throw new Error('Invalid portable update version');
  }

  const prefix = getEnv('TOOLDESK_UPDATE_COS_PREFIX', 'TOOLDESK_COS_PREFIX') || 'tooldesk/releases/win/';
  const objectKey = `${prefix.replace(/^\/+|\/+$/g, '')}/${fileName}`;
  const expiresSeconds = Number(getEnv('TOOLDESK_UPDATE_SIGNED_URL_EXPIRES_SECONDS')) || 600;
  const signed = createCosSignedGetUrl(objectKey, Math.max(60, Math.min(expiresSeconds, 3_600)));

  return {
    downloadUrl: signed.url,
    expiresAt: signed.expiresAt
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      headers: CORS_HEADERS,
      status: 204
    });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  try {
    assertRequestSize(request);

    const rawBody = await request.text();

    if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
      throw new Error('Request body is too large');
    }

    const bodySha256 = request.headers.get('x-tooldesk-body-sha256')?.trim() ?? '';

    if (bodySha256) {
      const actualBodySha256 = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');

      if (bodySha256 !== actualBodySha256) {
        throw new Error('Invalid request body signature');
      }
    }

    const payload = JSON.parse(rawBody) as ServiceRequest;

    assertClientVersion(request);
    assertClientToken(request);
    await assertNonceNotReplayed(request);

    if (payload.schemaVersion !== 1) {
      throw new Error('Unsupported schemaVersion');
    }

    const rateLimitResponse = await assertRateLimit(request, payload.action);

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    if (payload.action === 'ocr.baidu') {
      return jsonResponse(await recognizeBaiduOcr(payload));
    }

    if (payload.action === 'translate') {
      return jsonResponse(await translate(payload));
    }

    if (payload.action === 'pull' || payload.action === 'push' || payload.action === 'sync.pull' || payload.action === 'sync.push') {
      return jsonResponse(await syncCloud(payload));
    }

    if (payload.action === 'update.portable-url') {
      return jsonResponse(resolvePortableUpdateUrl(payload));
    }

    throw new Error('Unsupported action');
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      400
    );
  }
});
