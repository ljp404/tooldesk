import { invoke } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { sendHttpRequest } from './tauriHttp';

type ServiceGatewayConfig = {
  apiKey: string;
  bucket: string;
  clientTokenConfigured: boolean;
  functionUrl: string;
};

type ServiceGatewaySignature = {
  bodySha256: string;
  deviceId: string;
  nonce: string;
  signature: string;
  timestamp: string;
};

let configCache: ServiceGatewayConfig | null = null;
let appVersionCache: string | null = null;

async function getServiceGatewayConfig() {
  if (!configCache) {
    configCache = await invoke<ServiceGatewayConfig>('get_service_gateway_config');
  }

  return configCache;
}

async function getAppVersionHeader() {
  if (!appVersionCache) {
    appVersionCache = await getVersion().catch(() => '0.1.0');
  }

  return appVersionCache;
}

async function signServiceGatewayRequest(body: string) {
  return invoke<ServiceGatewaySignature | null>('sign_service_gateway_request', {
    payload: { body }
  });
}

export async function getServiceGatewayBucket() {
  const config = await getServiceGatewayConfig();
  return config.bucket || 'tooldesk-sync';
}

export async function isServiceGatewayConfigured() {
  const config = await getServiceGatewayConfig();
  return Boolean(config.functionUrl);
}

export async function postServiceGateway<T>(payload: Record<string, unknown>, options: { timeoutMs?: number } = {}) {
  const config = await getServiceGatewayConfig();

  if (!config.functionUrl) {
    throw new Error('未配置云函数服务地址，请配置 TOOLDESK_SERVICE_FUNCTION_URL 或本地 tooldesk.config.json');
  }

  const body = JSON.stringify({
    ...payload,
    schemaVersion: 1
  });
  const signature = await signServiceGatewayRequest(body);
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-tooldesk-app-version': await getAppVersionHeader()
  };

  if (config.apiKey) {
    headers.apikey = config.apiKey;
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  if (signature) {
    headers['x-tooldesk-body-sha256'] = signature.bodySha256;
    headers['x-tooldesk-device-id'] = signature.deviceId;
    headers['x-tooldesk-nonce'] = signature.nonce;
    headers['x-tooldesk-signature'] = signature.signature;
    headers['x-tooldesk-timestamp'] = signature.timestamp;
  }

  const response = await sendHttpRequest({
    body,
    headers,
    method: 'POST',
    timeoutMs: options.timeoutMs ?? 30_000,
    url: config.functionUrl
  });

  if (response.status < 200 || response.status >= 300) {
    let message = response.error || `云函数请求失败 HTTP ${response.status}`;

    try {
      const data = JSON.parse(response.body || '{}') as { error?: string };
      message = data.error || message;
    } catch {
      // keep original message
    }

    throw new Error(message);
  }

  return JSON.parse(response.body || 'null') as T;
}
