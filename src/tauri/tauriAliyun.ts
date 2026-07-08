import { join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { getStorageDirectories } from './tauriStorage';
import { readTextFile, removeFile, writeTextFile } from './tauriFile';
import { resolveLocalPlayUrl } from './tauriMusic';

type AliyunTokenPayload = {
  refresh_token: string;
};

async function tokenPath() {
  const directories = await getStorageDirectories();
  return join(directories.data.currentPath, 'aliyun-token.json');
}

function normalizeToken(value: unknown): AliyunTokenPayload | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const refreshToken = String((value as { refresh_token?: unknown }).refresh_token ?? '').trim();

  if (!refreshToken) {
    return null;
  }

  return {
    refresh_token: refreshToken
  };
}

export async function getAliyunToken(): Promise<AliyunTokenPayload | null> {
  try {
    return normalizeToken(JSON.parse(await readTextFile(await tokenPath())));
  } catch {
    return null;
  }
}

export async function saveAliyunToken(token: AliyunTokenPayload): Promise<void> {
  const normalized = normalizeToken(token);

  if (!normalized) {
    throw new Error('阿里云盘 refresh_token 不能为空');
  }

  await writeTextFile(await tokenPath(), `${JSON.stringify(normalized, null, 2)}\n`);
}

export async function clearAliyunToken(): Promise<void> {
  await removeFile(await tokenPath());
}

export function aliyunGenerateQRCode(): Promise<{ qrCodeContent: string; sid: string; t: string }> {
  return invoke('aliyun_generate_qrcode');
}

export function aliyunCheckQRCode(t: string, sid: string): Promise<Record<string, unknown>> {
  return invoke('aliyun_check_qrcode', { payload: { sid, t } });
}

export function aliyunRefreshToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string }> {
  return invoke('aliyun_refresh_token', { refreshToken });
}

export function aliyunListFiles(accessToken: string, parentId?: string): Promise<Record<string, unknown>[]> {
  return invoke('aliyun_list_files', { accessToken, parentId: parentId ?? null });
}

export function aliyunGetDownloadUrl(
  accessToken: string,
  fileId: string,
  audioQuality?: 'standard' | 'high'
): Promise<string> {
  return invoke('aliyun_get_download_url', { accessToken, audioQuality: audioQuality ?? null, fileId });
}

export function aliyunScanAllMusic(accessToken: string): Promise<Record<string, unknown>[]> {
  return scanAliyunMusic(accessToken);
}

function isMusicFileName(name: string) {
  return /\.(mp3|flac|m4a|wav|aac|ogg|wma)$/i.test(name);
}

function mapAliyunCloudTrack(file: Record<string, unknown>) {
  const cover = typeof file.cover === 'string'
    ? file.cover
    : typeof file.thumbnail === 'string'
      ? file.thumbnail
      : undefined;

  return {
    file_id: file.file_id,
    name: typeof file.name === 'string' ? file.name : 'music',
    type: typeof file.type === 'string' ? file.type : 'file',
    thumbnail: cover,
    duration: typeof file.duration === 'number' ? file.duration : 0,
    cover
  };
}

export async function scanAliyunMusic(
  accessToken: string,
  onProgress?: (progress: { scannedFolders: number; foundTracks: number; currentFolder: string }) => void
) {
  const tracks: Record<string, unknown>[] = [];
  const folderQueue = [{ id: 'root', name: '阿里云盘' }];
  let scannedFolders = 0;

  while (folderQueue.length > 0) {
    const folder = folderQueue.shift()!;
    scannedFolders += 1;
    const files = await aliyunListFiles(accessToken, folder.id);

    for (const file of files) {
      const name = typeof file.name === 'string' ? file.name : '';
      const type = typeof file.type === 'string' ? file.type : '';

      if (type === 'folder') {
        const fileId = typeof file.file_id === 'string' ? file.file_id : '';
        if (fileId) {
          folderQueue.push({ id: fileId, name });
        }
        continue;
      }

      if (isMusicFileName(name)) {
        tracks.push(mapAliyunCloudTrack(file));
      }
    }

    onProgress?.({
      currentFolder: folder.name,
      foundTracks: tracks.length,
      scannedFolders
    });
  }

  return tracks;
}

export async function resolveCloudPlayUrl(
  accessToken: string,
  fileId: string,
  fileName: string
): Promise<{
  album?: string;
  artist?: string;
  cachedPath?: string;
  cover?: string;
  duration?: number;
  playUrl: string;
}> {
  const result = await invoke<{
    album?: string;
    artist?: string;
    cachedPath: string;
    cover?: string;
    duration?: number;
    playUrl: string;
  }>('resolve_cloud_play_url', { accessToken, fileId, fileName });

  return {
    ...result,
    playUrl: await resolveLocalPlayUrl(result.playUrl)
  };
}

export function downloadCloudMusic(
  accessToken: string,
  fileId: string,
  fileName: string,
  targetDir?: string
): Promise<{ filePath: string; skipped: boolean }> {
  return invoke('download_cloud_music', {
    accessToken,
    fileId,
    fileName,
    targetDir: targetDir ?? null
  });
}
