import { invoke } from '@tauri-apps/api/core';
import { getTranslateProviderLabel, type TranslateProvider } from '../types/translate';
import { sendHttpRequest } from './tauriHttp';

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

function toBytes(value: string) {
  return new TextEncoder().encode(value);
}

function bytesToHex(bytes: Uint8Array | ArrayBuffer) {
  return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function bytesToBase64(bytes: ArrayBuffer) {
  let binary = '';
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// Small MD5 implementation for Baidu signing. Inputs here are UTF-8 text and short credential material.
function md5(value: string) {
  function rotateLeft(input: number, count: number) {
    return (input << count) | (input >>> (32 - count));
  }
  function addUnsigned(left: number, right: number) {
    const left4 = left & 0x40000000;
    const right4 = right & 0x40000000;
    const left8 = left & 0x80000000;
    const right8 = right & 0x80000000;
    const result = (left & 0x3fffffff) + (right & 0x3fffffff);

    if (left4 & right4) {
      return result ^ 0x80000000 ^ left8 ^ right8;
    }
    if (left4 | right4) {
      return result & 0x40000000 ? result ^ 0xc0000000 ^ left8 ^ right8 : result ^ 0x40000000 ^ left8 ^ right8;
    }
    return result ^ left8 ^ right8;
  }
  const f = (x: number, y: number, z: number) => (x & y) | (~x & z);
  const g = (x: number, y: number, z: number) => (x & z) | (y & ~z);
  const h = (x: number, y: number, z: number) => x ^ y ^ z;
  const i = (x: number, y: number, z: number) => y ^ (x | ~z);
  const transform = (
    fn: (x: number, y: number, z: number) => number,
    a: number,
    b: number,
    c: number,
    d: number,
    x: number,
    s: number,
    ac: number
  ) => addUnsigned(rotateLeft(addUnsigned(addUnsigned(a, fn(b, c, d)), addUnsigned(x, ac)), s), b);
  const bytes = Array.from(toBytes(value));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) {
    bytes.push(0);
  }
  for (let index = 0; index < 8; index += 1) {
    bytes.push((bitLength >>> (8 * index)) & 0xff);
  }
  let a = 0x67452301;
  let b = 0xefcdab89;
  let c = 0x98badcfe;
  let d = 0x10325476;

  for (let block = 0; block < bytes.length; block += 64) {
    const x = Array.from({ length: 16 }, (_, index) =>
      bytes[block + index * 4] |
      (bytes[block + index * 4 + 1] << 8) |
      (bytes[block + index * 4 + 2] << 16) |
      (bytes[block + index * 4 + 3] << 24)
    );
    const aa = a;
    const bb = b;
    const cc = c;
    const dd = d;

    a = transform(f, a, b, c, d, x[0], 7, 0xd76aa478);
    d = transform(f, d, a, b, c, x[1], 12, 0xe8c7b756);
    c = transform(f, c, d, a, b, x[2], 17, 0x242070db);
    b = transform(f, b, c, d, a, x[3], 22, 0xc1bdceee);
    a = transform(f, a, b, c, d, x[4], 7, 0xf57c0faf);
    d = transform(f, d, a, b, c, x[5], 12, 0x4787c62a);
    c = transform(f, c, d, a, b, x[6], 17, 0xa8304613);
    b = transform(f, b, c, d, a, x[7], 22, 0xfd469501);
    a = transform(f, a, b, c, d, x[8], 7, 0x698098d8);
    d = transform(f, d, a, b, c, x[9], 12, 0x8b44f7af);
    c = transform(f, c, d, a, b, x[10], 17, 0xffff5bb1);
    b = transform(f, b, c, d, a, x[11], 22, 0x895cd7be);
    a = transform(f, a, b, c, d, x[12], 7, 0x6b901122);
    d = transform(f, d, a, b, c, x[13], 12, 0xfd987193);
    c = transform(f, c, d, a, b, x[14], 17, 0xa679438e);
    b = transform(f, b, c, d, a, x[15], 22, 0x49b40821);

    a = transform(g, a, b, c, d, x[1], 5, 0xf61e2562);
    d = transform(g, d, a, b, c, x[6], 9, 0xc040b340);
    c = transform(g, c, d, a, b, x[11], 14, 0x265e5a51);
    b = transform(g, b, c, d, a, x[0], 20, 0xe9b6c7aa);
    a = transform(g, a, b, c, d, x[5], 5, 0xd62f105d);
    d = transform(g, d, a, b, c, x[10], 9, 0x02441453);
    c = transform(g, c, d, a, b, x[15], 14, 0xd8a1e681);
    b = transform(g, b, c, d, a, x[4], 20, 0xe7d3fbc8);
    a = transform(g, a, b, c, d, x[9], 5, 0x21e1cde6);
    d = transform(g, d, a, b, c, x[14], 9, 0xc33707d6);
    c = transform(g, c, d, a, b, x[3], 14, 0xf4d50d87);
    b = transform(g, b, c, d, a, x[8], 20, 0x455a14ed);
    a = transform(g, a, b, c, d, x[13], 5, 0xa9e3e905);
    d = transform(g, d, a, b, c, x[2], 9, 0xfcefa3f8);
    c = transform(g, c, d, a, b, x[7], 14, 0x676f02d9);
    b = transform(g, b, c, d, a, x[12], 20, 0x8d2a4c8a);

    a = transform(h, a, b, c, d, x[5], 4, 0xfffa3942);
    d = transform(h, d, a, b, c, x[8], 11, 0x8771f681);
    c = transform(h, c, d, a, b, x[11], 16, 0x6d9d6122);
    b = transform(h, b, c, d, a, x[14], 23, 0xfde5380c);
    a = transform(h, a, b, c, d, x[1], 4, 0xa4beea44);
    d = transform(h, d, a, b, c, x[4], 11, 0x4bdecfa9);
    c = transform(h, c, d, a, b, x[7], 16, 0xf6bb4b60);
    b = transform(h, b, c, d, a, x[10], 23, 0xbebfbc70);
    a = transform(h, a, b, c, d, x[13], 4, 0x289b7ec6);
    d = transform(h, d, a, b, c, x[0], 11, 0xeaa127fa);
    c = transform(h, c, d, a, b, x[3], 16, 0xd4ef3085);
    b = transform(h, b, c, d, a, x[6], 23, 0x04881d05);
    a = transform(h, a, b, c, d, x[9], 4, 0xd9d4d039);
    d = transform(h, d, a, b, c, x[12], 11, 0xe6db99e5);
    c = transform(h, c, d, a, b, x[15], 16, 0x1fa27cf8);
    b = transform(h, b, c, d, a, x[2], 23, 0xc4ac5665);

    a = transform(i, a, b, c, d, x[0], 6, 0xf4292244);
    d = transform(i, d, a, b, c, x[7], 10, 0x432aff97);
    c = transform(i, c, d, a, b, x[14], 15, 0xab9423a7);
    b = transform(i, b, c, d, a, x[5], 21, 0xfc93a039);
    a = transform(i, a, b, c, d, x[12], 6, 0x655b59c3);
    d = transform(i, d, a, b, c, x[3], 10, 0x8f0ccc92);
    c = transform(i, c, d, a, b, x[10], 15, 0xffeff47d);
    b = transform(i, b, c, d, a, x[1], 21, 0x85845dd1);
    a = transform(i, a, b, c, d, x[8], 6, 0x6fa87e4f);
    d = transform(i, d, a, b, c, x[15], 10, 0xfe2ce6e0);
    c = transform(i, c, d, a, b, x[6], 15, 0xa3014314);
    b = transform(i, b, c, d, a, x[13], 21, 0x4e0811a1);
    a = transform(i, a, b, c, d, x[4], 6, 0xf7537e82);
    d = transform(i, d, a, b, c, x[11], 10, 0xbd3af235);
    c = transform(i, c, d, a, b, x[2], 15, 0x2ad7d2bb);
    b = transform(i, b, c, d, a, x[9], 21, 0xeb86d391);

    a = addUnsigned(a, aa);
    b = addUnsigned(b, bb);
    c = addUnsigned(c, cc);
    d = addUnsigned(d, dd);
  }

  return [a, b, c, d]
    .map((word) => [0, 8, 16, 24].map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, '0')).join(''))
    .join('');
}

function toArrayBuffer(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function hmac(algorithm: 'SHA-1' | 'SHA-256', key: string | ArrayBuffer, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? toArrayBuffer(toBytes(key)) : key,
    { hash: algorithm, name: 'HMAC' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, toBytes(value));
}

async function sha256Hex(value: string) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', toBytes(value)));
}

async function translateWithBaidu(settings: TooldeskTranslateSettings, text: string, from: string, to: string) {
  const { appId, secretKey } = settings.baidu;
  if (!appId.trim() || !secretKey.trim()) {
    throw new Error('请先配置百度翻译 App ID 和密钥');
  }
  const salt = String(Date.now());
  const params = new URLSearchParams({
    appid: appId.trim(),
    from: mapLanguageCode(from, 'baidu'),
    q: text,
    salt,
    sign: md5(`${appId.trim()}${text}${salt}${secretKey.trim()}`),
    to: mapLanguageCode(to, 'baidu')
  });
  const response = await sendHttpRequest({
    headers: {},
    method: 'GET',
    timeoutMs: 30000,
    url: `https://fanyi-api.baidu.com/api/trans/vip/translate?${params.toString()}`
  });
  const data = JSON.parse(response.body || '{}') as {
    error_code?: string;
    error_msg?: string;
    trans_result?: Array<{ dst: string }>;
  };
  if (data.error_code) {
    throw new Error(data.error_msg || `百度翻译错误 ${data.error_code}`);
  }
  const translated = data.trans_result?.map((item) => item.dst).join('\n').trim();
  if (!translated) {
    throw new Error('百度翻译未返回结果');
  }
  return translated;
}

async function buildTencentAuthorization(settings: TooldeskTranslateSettings, payload: string, timestamp: number) {
  const host = 'tmt.tencentcloudapi.com';
  const service = 'tmt';
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10);
  const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${host}\n`;
  const signedHeaders = 'content-type;host';
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, await sha256Hex(payload)].join('\n');
  const credentialScope = `${date}/${service}/tc3_request`;
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), credentialScope, await sha256Hex(canonicalRequest)].join('\n');
  const secretDate = await hmac('SHA-256', `TC3${settings.tencent.secretKey.trim()}`, date);
  const secretService = await hmac('SHA-256', secretDate, service);
  const secretSigning = await hmac('SHA-256', secretService, 'tc3_request');
  const signature = bytesToHex(await hmac('SHA-256', secretSigning, stringToSign));

  return `TC3-HMAC-SHA256 Credential=${settings.tencent.secretId.trim()}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

async function translateWithTencent(settings: TooldeskTranslateSettings, text: string, from: string, to: string) {
  const { region, secretId, secretKey } = settings.tencent;
  if (!secretId.trim() || !secretKey.trim()) {
    throw new Error('请先配置腾讯云翻译 SecretId 和 SecretKey');
  }
  const payload = JSON.stringify({
    ProjectId: 0,
    Source: mapLanguageCode(from, 'tencent'),
    SourceText: text,
    Target: mapLanguageCode(to, 'tencent')
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const response = await sendHttpRequest({
    body: payload,
    headers: {
      Authorization: await buildTencentAuthorization(settings, payload, timestamp),
      'Content-Type': 'application/json; charset=utf-8',
      Host: 'tmt.tencentcloudapi.com',
      'X-TC-Action': 'TextTranslate',
      'X-TC-Region': region.trim() || 'ap-guangzhou',
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Version': '2018-03-21'
    },
    method: 'POST',
    timeoutMs: 30000,
    url: 'https://tmt.tencentcloudapi.com/'
  });
  const data = JSON.parse(response.body || '{}') as {
    Response?: { Error?: { Code: string; Message: string }; TargetText?: string };
  };
  if (data.Response?.Error) {
    throw new Error(data.Response.Error.Message || data.Response.Error.Code);
  }
  const translated = data.Response?.TargetText?.trim();
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

async function buildAliyunSignature(settings: TooldeskTranslateSettings, params: Record<string, string>) {
  const canonicalized = Object.entries(params)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${percentEncode(key)}=${percentEncode(value)}`)
    .join('&');
  const stringToSign = `POST&${percentEncode('/')}&${percentEncode(canonicalized)}`;
  return bytesToBase64(await hmac('SHA-1', `${settings.aliyun.accessKeySecret.trim()}&`, stringToSign));
}

async function translateWithAliyun(settings: TooldeskTranslateSettings, text: string, from: string, to: string) {
  const { accessKeyId, accessKeySecret, region } = settings.aliyun;
  if (!accessKeyId.trim() || !accessKeySecret.trim()) {
    throw new Error('请先配置阿里云翻译 AccessKey');
  }
  const activeRegion = region.trim() || 'cn-hangzhou';
  const params: Record<string, string> = {
    AccessKeyId: accessKeyId.trim(),
    Action: 'TranslateGeneral',
    Format: 'JSON',
    FormatType: 'text',
    RegionId: activeRegion,
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
  params.Signature = await buildAliyunSignature(settings, params);
  const response = await sendHttpRequest({
    body: new URLSearchParams(params).toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    method: 'POST',
    timeoutMs: 30000,
    url: `https://mt.${activeRegion}.aliyuncs.com/`
  });
  const data = JSON.parse(response.body || '{}') as { Code?: string; Data?: { Translated?: string }; Message?: string };
  if (data.Code && data.Code !== '200') {
    throw new Error(data.Message || `阿里云翻译错误 ${data.Code}`);
  }
  const translated = data.Data?.Translated?.trim();
  if (!translated) {
    throw new Error('阿里云翻译未返回结果');
  }
  return translated;
}

async function translateChunk(settings: TooldeskTranslateSettings, text: string, from: string, to: string) {
  if (settings.provider === 'tencent') {
    return translateWithTencent(settings, text, from, to);
  }
  if (settings.provider === 'aliyun') {
    return translateWithAliyun(settings, text, from, to);
  }
  return translateWithBaidu(settings, text, from, to);
}

export async function translateText(payload: TooldeskTranslateRequestPayload): Promise<TooldeskTranslateResponsePayload> {
  const source = payload.text.trim();
  if (!source) {
    throw new Error('请输入要翻译的文本');
  }
  if (payload.from !== 'auto' && payload.from === payload.to) {
    throw new Error('源语言和目标语言不能相同');
  }

  const result = await invoke<{ provider?: TranslateProvider; text?: string }>('translate_screenshot_overlay_text', {
    payload: {
      from: payload.from,
      text: source,
      to: payload.to
    }
  });
  const provider = result.provider === 'tencent' || result.provider === 'aliyun' ? result.provider : 'baidu';
  const text = result.text?.trim() ?? '';

  if (!text) {
    throw new Error('翻译未返回结果');
  }

  return {
    provider,
    providerLabel: getTranslateProviderLabel(provider),
    text
  };
}

export async function validateTranslateSettings(settings: TooldeskTranslateSettings) {
  await translateChunk(settings, 'hello', 'en', 'zh-cn');
  return { message: '翻译配置可用', ok: true };
}
