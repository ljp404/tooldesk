import { sendHttpRequest } from './tauriHttp';
import { readBinaryFile } from './tauriFile';
import { getAppSettings } from './tauriStorage';
import { isServiceGatewayConfigured, postServiceGateway } from './tauriServiceGateway';
import type { ScreenshotOcrResult } from '../types/screenshot';

type BaiduOcrApiResponse = {
  error_code?: number;
  error_msg?: string;
  words_result?: Array<{
    location?: {
      height: number;
      left: number;
      top: number;
      width: number;
    };
    words?: string;
  }>;
};

type BaiduOcrTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  expires_in?: number;
};

type ServiceOcrResponse = {
  wordsResult?: BaiduOcrApiResponse['words_result'];
};

let tokenCache: { accessToken: string; expiresAt: number; key: string } | null = null;

function getBaiduOcrApiPath(apiVariant: TooldeskBaiduOcrSettings['apiVariant']) {
  return apiVariant === 'accurate_located'
    ? '/rest/2.0/ocr/v1/accurate'
    : '/rest/2.0/ocr/v1/general';
}

function normalizeImageBase64(value?: string) {
  const trimmed = String(value ?? '').trim();
  const match = trimmed.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  return match?.[1] ?? trimmed;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

async function getImageBase64(payload: { imageBase64?: string; imagePath?: string }) {
  const imageBase64 = normalizeImageBase64(payload.imageBase64);

  if (imageBase64) {
    return imageBase64;
  }

  const imagePath = String(payload.imagePath ?? '').trim();

  if (!imagePath) {
    throw new Error('请提供需要识别的图片');
  }

  return bytesToBase64(await readBinaryFile(imagePath));
}

async function fetchBaiduAccessToken(settings: TooldeskBaiduOcrSettings) {
  const apiKey = settings.apiKey.trim();
  const secretKey = settings.secretKey.trim();

  if (!apiKey || !secretKey) {
    throw new Error('请填写百度 OCR API Key 和 Secret Key');
  }

  const cacheKey = `${apiKey}:${secretKey}`;

  if (tokenCache?.key === cacheKey && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.accessToken;
  }

  const query = new URLSearchParams({
    client_id: apiKey,
    client_secret: secretKey,
    grant_type: 'client_credentials'
  });
  const response = await sendHttpRequest({
    body: '',
    headers: {
      'Content-Length': '0'
    },
    method: 'POST',
    timeoutMs: 30000,
    url: `https://aip.baidubce.com/oauth/2.0/token?${query.toString()}`
  });
  const data = JSON.parse(response.body || '{}') as BaiduOcrTokenResponse;

  if (!data.access_token) {
    throw new Error(data.error_description ?? data.error ?? '获取百度 OCR Token 失败');
  }

  tokenCache = {
    accessToken: data.access_token,
    expiresAt: Date.now() + Number(data.expires_in ?? 2_592_000) * 1000,
    key: cacheKey
  };

  return tokenCache.accessToken;
}

async function recognizeWithBaidu(imageBase64: string, settings: TooldeskBaiduOcrSettings) {
  const accessToken = await fetchBaiduAccessToken(settings);
  const body = new URLSearchParams({
    detect_direction: 'true',
    image: imageBase64,
    paragraph: 'false',
    probability: 'false',
    vertexes_location: 'false'
  });
  const response = await sendHttpRequest({
    body: body.toString(),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    method: 'POST',
    timeoutMs: 30000,
    url: `https://aip.baidubce.com${getBaiduOcrApiPath(settings.apiVariant)}?access_token=${encodeURIComponent(accessToken)}`
  });
  const data = JSON.parse(response.body || '{}') as BaiduOcrApiResponse;

  if (data.error_code) {
    throw new Error(data.error_msg ?? `百度 OCR 错误 ${data.error_code}`);
  }

  return data.words_result ?? [];
}

function mapWords(items: NonNullable<BaiduOcrApiResponse['words_result']>): ScreenshotOcrResult['words'] {
  const words: ScreenshotOcrResult['words'] = [];

  for (const item of items) {
    const text = item.words?.trim();

    if (!text) {
      continue;
    }

    if (item.location) {
      words.push({
        height: Math.max(1, Math.round(item.location.height)),
        text,
        width: Math.max(1, Math.round(item.location.width)),
        x: Math.max(0, Math.round(item.location.left)),
        y: Math.max(0, Math.round(item.location.top))
      });
    } else {
      words.push({
        height: 16,
        text,
        width: Math.max(24, text.length * 14),
        x: 0,
        y: words.length * 20
      });
    }
  }

  return words;
}

export async function validateBaiduOcrSettings(settings: TooldeskBaiduOcrSettings): Promise<TooldeskSettingsValidationResult> {
  tokenCache = null;
  await fetchBaiduAccessToken(settings);
  return { message: '百度 OCR 配置可用', ok: true };
}

export async function recognizeScreenshotText(payload: {
  imageBase64?: string;
  imagePath?: string;
}): Promise<ScreenshotOcrResult> {
  const settings = await getAppSettings();
  const baiduOcr = settings.baiduOcr;
  const imageBase64 = await getImageBase64(payload);

  if (!baiduOcr?.apiKey?.trim() || !baiduOcr.secretKey?.trim()) {
    if (await isServiceGatewayConfigured()) {
      const result = await postServiceGateway<ServiceOcrResponse>(
        {
          action: 'ocr.baidu',
          apiVariant: baiduOcr?.apiVariant ?? 'standard_located',
          imageBase64,
          mode: 'positioned'
        },
        { timeoutMs: 30_000 }
      );
      const items = result.wordsResult ?? [];
      const rawText = items
        .map((item) => item.words?.trim())
        .filter(Boolean)
        .join('\n');
      const lines = rawText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);

      return {
        imageHeight: 0,
        imageWidth: 0,
        lines,
        rawText,
        words: mapWords(items)
      };
    }

    throw new Error('请先配置百度 OCR API Key 和 Secret Key，或配置 Supabase 服务网关');
  }

  if (!baiduOcr) {
    throw new Error('请先配置百度 OCR API Key 和 Secret Key');
  }

  const items = await recognizeWithBaidu(imageBase64, baiduOcr);
  const rawText = items
    .map((item) => item.words?.trim())
    .filter(Boolean)
    .join('\n');
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    imageHeight: 0,
    imageWidth: 0,
    lines,
    rawText,
    words: mapWords(items)
  };
}
