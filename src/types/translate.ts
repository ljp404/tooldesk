export type TranslateProvider = 'baidu' | 'tencent' | 'aliyun';

export const TRANSLATE_PROVIDER_ORDER: TranslateProvider[] = ['baidu', 'tencent', 'aliyun'];

export interface BaiduTranslateCredentials {
  appId: string;
  secretKey: string;
}

export interface TencentTranslateCredentials {
  region: string;
  secretId: string;
  secretKey: string;
}

export interface AliyunTranslateCredentials {
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
}

export interface TranslateSettings {
  aliyun: AliyunTranslateCredentials;
  baidu: BaiduTranslateCredentials;
  provider: TranslateProvider;
  tencent: TencentTranslateCredentials;
}

export interface TranslateConfigStatus {
  configured: boolean;
  locked: boolean;
  provider: TranslateProvider | 'none';
  source: 'cloud' | 'remote' | 'global' | 'env' | 'user' | 'none';
}

export interface TranslateRequestPayload {
  from: string;
  text: string;
  to: string;
}

export interface TranslateResponsePayload {
  provider: TranslateProvider;
  providerLabel: string;
  text: string;
}

export function getDefaultTranslateSettings(): TranslateSettings {
  return {
    provider: 'baidu',
    baidu: {
      appId: '',
      secretKey: ''
    },
    tencent: {
      region: 'ap-guangzhou',
      secretId: '',
      secretKey: ''
    },
    aliyun: {
      accessKeyId: '',
      accessKeySecret: '',
      region: 'cn-hangzhou'
    }
  };
}

export function getTranslateConfigSourceLabel(source: TranslateConfigStatus['source']) {
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

export function getTranslateProviderLabel(provider: TranslateProvider) {
  switch (provider) {
    case 'baidu':
      return '百度翻译';
    case 'tencent':
      return '腾讯云翻译';
    case 'aliyun':
      return '阿里云翻译';
  }
}
