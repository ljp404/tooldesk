export declare const SDK_VERSION: '1.0.0';
export declare const HOST_API_VERSION: '1.0.0';

export declare const ERROR_CODES: {
  readonly PLUGIN_API_DENIED: 'PLUGIN_API_DENIED';
  readonly PLUGIN_API_UNAVAILABLE: 'PLUGIN_API_UNAVAILABLE';
  readonly PLUGIN_CONNECT_FAILED: 'PLUGIN_CONNECT_FAILED';
  readonly PLUGIN_HOST_INCOMPATIBLE: 'PLUGIN_HOST_INCOMPATIBLE';
  readonly PLUGIN_SDK_NOT_READY: 'PLUGIN_SDK_NOT_READY';
  readonly PLUGIN_STORAGE_DENIED: 'PLUGIN_STORAGE_DENIED';
};

export declare class TooldeskPluginError extends Error {
  code: string;
  constructor(code: string, message?: string);
}

export interface TooldeskLaunchContext {
  appVersion?: string;
  content?: string;
  hostApiVersion?: string;
  pluginId?: string;
  sdkVersion?: string;
  toolKey?: string;
  triggeredAt?: number;
}

export interface TooldeskHostInfo {
  appVersion?: string;
  hostApiVersion: string;
  permissions?: string[];
  sdkVersion: string;
}

export interface TooldeskConnectResult {
  error: TooldeskPluginError | null;
  hostInfo: TooldeskHostInfo | null;
  ready: boolean;
}

export interface TooldeskPluginCreateOptions {
  capabilities?: string[];
  id?: string;
  minHostVersion?: string;
  onError?: (error: TooldeskPluginError) => void;
  onLaunchContext?: (context: TooldeskLaunchContext) => void;
  onReady?: (info: TooldeskHostInfo) => void;
}

export interface TooldeskPluginHandle {
  api: Record<string, (...args: unknown[]) => Promise<unknown>>;
  connect: () => Promise<TooldeskConnectResult>;
  getHostInfo: () => Promise<TooldeskHostInfo>;
  id: string;
}

export interface TooldeskPluginSdk {
  ERROR_CODES: typeof ERROR_CODES;
  HOST_API_VERSION: typeof HOST_API_VERSION;
  SDK_VERSION: typeof SDK_VERSION;
  TooldeskPluginError: typeof TooldeskPluginError;
  create: (options?: TooldeskPluginCreateOptions) => TooldeskPluginHandle;
}

declare global {
  const TooldeskPlugin: TooldeskPluginSdk;
}

export {};
