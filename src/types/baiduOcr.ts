export type BaiduOcrProvider = 'baidu';

export type BaiduOcrApiVariant = 'standard_located' | 'accurate_located';

export const BAIDU_OCR_PROVIDER_ORDER: BaiduOcrProvider[] = ['baidu'];

export const BAIDU_OCR_API_VARIANT_ORDER: BaiduOcrApiVariant[] = ['standard_located', 'accurate_located'];

export interface OcrConfigStatus {
  configured: boolean;
  locked: boolean;
  provider: 'baidu' | 'local' | 'none';
  source: 'cloud' | 'remote' | 'global' | 'env' | 'user' | 'none';
}

export interface BaiduOcrSettings {
  apiKey: string;
  apiVariant: BaiduOcrApiVariant;
  provider: BaiduOcrProvider;
  secretKey: string;
}

export function getDefaultBaiduOcrSettings(): BaiduOcrSettings {
  return {
    apiKey: '',
    apiVariant: 'standard_located',
    provider: 'baidu',
    secretKey: ''
  };
}

export function normalizeBaiduOcrApiVariant(value: unknown): BaiduOcrApiVariant {
  return value === 'accurate_located' ? 'accurate_located' : 'standard_located';
}

export function getBaiduOcrProviderLabel(provider: BaiduOcrProvider) {
  switch (provider) {
    case 'baidu':
      return '百度 OCR';
  }
}

export function getBaiduOcrApiVariantLabel(variant: BaiduOcrApiVariant) {
  switch (variant) {
    case 'accurate_located':
      return '通用文字识别（高精度含位置版）';
    default:
      return '通用文字识别（标准含位置版）';
  }
}

export function getOcrConfigSourceLabel(source: OcrConfigStatus['source']) {
  switch (source) {
    case 'cloud':
      return '云函数';
    case 'remote':
      return '腾讯云加密共享配置';
    case 'global':
      return '全局配置文件 tooldesk.config.json';
    case 'env':
      return '环境变量';
    case 'user':
      return '应用设置';
    default:
      return '未配置';
  }
}
