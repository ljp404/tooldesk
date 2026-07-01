import { invoke } from '@tauri-apps/api/core';

type KeePassEntry = {
  group: string;
  modifiedTime?: number;
  notes: string;
  password?: string;
  title: string;
  url: string;
  username: string;
  uuid: string;
};

type KeePassResult = {
  dbPath?: string;
  entries?: KeePassEntry[];
  error?: string;
  success: boolean;
};

export function unlockKeePassDatabase(dbPath: string, password: string): Promise<KeePassResult> {
  return invoke<KeePassResult>('unlock_keepass_database', { dbPath, password });
}

export function getKeePassSession(dbPath?: string): Promise<KeePassResult> {
  return invoke<KeePassResult>('get_keepass_session', { dbPath });
}

export function lockKeePassDatabase(): Promise<{ success: boolean }> {
  return invoke<{ success: boolean }>('lock_keepass_database');
}
