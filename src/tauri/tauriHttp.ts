import { invoke } from '@tauri-apps/api/core';
import type { HttpRequestPayload, HttpResponsePayload } from '../types/http';

export async function sendHttpRequest(payload: HttpRequestPayload): Promise<HttpResponsePayload> {
  const startedAt = performance.now();

  try {
    return await invoke<HttpResponsePayload>('send_http_request', { payload });
  } catch (error) {
    return {
      body: '',
      bodyByteLength: 0,
      bodyEncoding: 'utf-8',
      durationMs: Math.round(performance.now() - startedAt),
      error: error instanceof Error ? error.message : String(error),
      headers: {},
      ok: false,
      status: 0,
      statusText: 'Native HTTP command failed'
    };
  }
}
