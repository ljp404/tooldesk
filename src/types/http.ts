export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export interface HttpRequestPayload {
  body?: string;
  headers: Record<string, string>;
  method: HttpMethod;
  timeoutMs?: number;
  url: string;
}

export interface HttpResponsePayload {
  body: string;
  bodyByteLength: number;
  bodyEncoding: 'base64' | 'utf-8';
  durationMs: number;
  error?: string;
  headers: Record<string, string>;
  ok: boolean;
  setCookies?: string[];
  status: number;
  statusText: string;
}
