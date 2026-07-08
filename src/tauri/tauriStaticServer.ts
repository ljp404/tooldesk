import { invoke } from '@tauri-apps/api/core';

export type StaticServerStatus = {
  running: boolean;
  root?: string;
  host?: string;
  port?: number;
  spaFallback?: boolean;
  url?: string;
};

export type StartStaticServerPayload = {
  rootPath: string;
  port: number;
  host: string;
  spaFallback: boolean;
};

export function getStaticServerStatus(): Promise<StaticServerStatus> {
  return invoke<StaticServerStatus>('get_static_server_status');
}

export function startStaticServer(payload: StartStaticServerPayload): Promise<StaticServerStatus> {
  return invoke<StaticServerStatus>('start_static_server', { payload });
}

export function stopStaticServer(): Promise<StaticServerStatus> {
  return invoke<StaticServerStatus>('stop_static_server');
}
