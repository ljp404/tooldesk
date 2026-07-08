import type {
  CloudScanProgress,
  MusicPlayerSettings,
  MusicPlaylist,
  OnlinePlatform,
  OnlineSongItem,
  StoredFavoriteTrack,
  StoredRecentTrack
} from '../types/musicPlayer';

export type {
  AliyunQRCodeResult,
  AliyunTokenPayload,
  AliyunRefreshResult,
  AliyunFileItem,
  MusicCloudStorageDownloadResult,
  MusicCloudStorageUploadResult,
  MusicCloudStorageValidation
} from './musicPlayerClient.types';

export type { MusicPlayerSettings, StoredFavoriteTrack, StoredRecentTrack, MusicPlaylist, CloudScanProgress, OnlinePlatform, OnlineSongItem };

type MusicBridgeApi = TooldeskShortcutApi;

function getMusicBridgeApi(): MusicBridgeApi | undefined {
  return window.tooldeskShortcut;
}

function getDialogApi() {
  return window.tooldeskShortcut ?? undefined;
}

export function isMusicPlayerSupported(): boolean {
  const api = getMusicBridgeApi();
  return Boolean(api?.aliyunGenerateQRCode && api?.scanMusicFiles);
}

export async function aliyunGenerateQRCode() {
  const api = getMusicBridgeApi();
  if (!api?.aliyunGenerateQRCode) {
    throw new Error('阿里云盘登录 API 不可用');
  }

  const result = await api.aliyunGenerateQRCode();
  const qrCodeContent = result.qrCodeContent?.trim() ?? '';

  if (!qrCodeContent || !result.sid || !result.t) {
    throw new Error('二维码内容为空，请重试');
  }

  return { qrCodeContent, sid: result.sid, t: String(result.t) };
}

export async function aliyunCheckQRCode(t: string, sid: string) {
  const api = getMusicBridgeApi();
  if (!api?.aliyunCheckQRCode) {
    throw new Error('阿里云盘登录 API 不可用');
  }
  return api.aliyunCheckQRCode(t, sid);
}

export async function aliyunRefreshToken(refreshToken: string) {
  const api = getMusicBridgeApi();
  if (!api?.aliyunRefreshToken) {
    throw new Error('阿里云盘 API 不可用');
  }
  return api.aliyunRefreshToken(refreshToken);
}

export async function aliyunListFiles(accessToken: string, parentId?: string) {
  const api = getMusicBridgeApi();
  if (!api?.aliyunListFiles) {
    throw new Error('阿里云盘 API 不可用');
  }
  return api.aliyunListFiles(accessToken, parentId);
}

export async function aliyunScanAllMusic(accessToken: string) {
  const api = getMusicBridgeApi();
  if (!api?.aliyunScanAllMusic) {
    throw new Error('云盘扫描 API 不可用');
  }
  return api.aliyunScanAllMusic(accessToken);
}

export async function aliyunGetDownloadUrl(
  accessToken: string,
  fileId: string,
  audioQuality?: MusicPlayerSettings['audioQuality']
) {
  const api = getMusicBridgeApi();
  if (!api?.aliyunGetDownloadUrl) {
    throw new Error('阿里云盘 API 不可用');
  }
  return api.aliyunGetDownloadUrl(accessToken, fileId, audioQuality);
}

export async function resolveCloudPlayUrl(accessToken: string, fileId: string, fileName: string) {
  const api = getMusicBridgeApi();
  if (!api?.resolveCloudPlayUrl) {
    throw new Error('云盘播放 API 不可用');
  }
  return api.resolveCloudPlayUrl(accessToken, fileId, fileName);
}

export async function resolveTrackLyrics(
  track: {
    source: 'local' | 'cloud' | 'online';
    title?: string;
    artist?: string;
    album?: string;
    lrc?: string;
    lrcText?: string;
    cloudFileId?: string;
    fileName?: string;
    onlinePlatform?: OnlinePlatform;
    onlineSongId?: string;
    onlineLyricId?: string;
  },
  cloudAccessToken?: string
): Promise<string | null> {
  const api = getMusicBridgeApi();
  if (!api?.resolveTrackLyrics) {
    return null;
  }
  return api.resolveTrackLyrics(cloudAccessToken, track);
}

export async function searchOnlineMusic(
  platform: OnlinePlatform,
  keyword: string,
  page = 1,
  limit = 30
): Promise<OnlineSongItem[]> {
  const api = getMusicBridgeApi();
  if (!api?.searchOnlineMusic) {
    throw new Error('在线音乐搜索 API 不可用');
  }
  return api.searchOnlineMusic(platform, keyword, page, limit) as Promise<OnlineSongItem[]>;
}

export async function resolveOnlinePlayUrl(platform: OnlinePlatform, songId: string): Promise<string> {
  const api = getMusicBridgeApi();
  if (!api?.resolveOnlinePlayUrl) {
    throw new Error('在线播放 API 不可用');
  }
  return api.resolveOnlinePlayUrl(platform, songId);
}

export async function downloadOnlineMusic(
  platform: OnlinePlatform,
  songId: string,
  fileName: string,
  targetDir?: string,
  lyric?: { album?: string; artist?: string; lyricId?: string; title?: string }
): Promise<{ filePath: string; skipped: boolean }> {
  const api = getMusicBridgeApi();
  if (!api?.downloadOnlineMusic) {
    throw new Error('在线下载 API 不可用');
  }
  return api.downloadOnlineMusic(platform, songId, fileName, targetDir, lyric);
}

export async function resolveLocalPlayUrl(filePath: string): Promise<string> {
  const api = getMusicBridgeApi();
  if (!api?.resolveLocalPlayUrl) {
    if (filePath.startsWith('tooldesk-media://')) {
      return filePath;
    }
    if (filePath.startsWith('file://')) {
      return filePath;
    }
    return `file:///${filePath.replace(/\\/g, '/')}`;
  }
  return api.resolveLocalPlayUrl(filePath);
}

export async function invalidateCloudCache(fileId: string, fileName: string): Promise<void> {
  const api = getMusicBridgeApi();
  if (!api?.invalidateCloudCache) {
    return;
  }
  await api.invalidateCloudCache(fileId, fileName);
}

export interface TrackMetadataProbeItem {
  id: string;
  source: 'local' | 'cloud';
  localPath?: string;
  cloudFileId?: string;
  fileName?: string;
}

export interface TrackMetadataProbeResult {
  id: string;
  source: 'local' | 'cloud';
  duration?: number;
  cover?: string;
  artist?: string;
  album?: string;
}

export async function probeTracksMetadata(
  tracks: TrackMetadataProbeItem[]
): Promise<TrackMetadataProbeResult[]> {
  const api = getMusicBridgeApi();
  if (!api?.probeTracksMetadata) {
    return [];
  }
  return api.probeTracksMetadata(tracks) as Promise<TrackMetadataProbeResult[]>;
}

export async function downloadCloudMusic(
  accessToken: string,
  fileId: string,
  fileName: string,
  targetDir?: string
): Promise<{ filePath: string; skipped: boolean }> {
  const api = getMusicBridgeApi();
  if (!api?.downloadCloudMusic) {
    throw new Error('云盘下载 API 不可用');
  }
  return api.downloadCloudMusic(accessToken, fileId, fileName, targetDir);
}

export async function getAliyunToken() {
  const api = getMusicBridgeApi();
  if (!api?.getAliyunToken) {
    return null;
  }
  return api.getAliyunToken();
}

export async function saveAliyunToken(token: { refresh_token: string }) {
  const api = getMusicBridgeApi();
  if (!api?.saveAliyunToken) {
    throw new Error('登录状态保存 API 不可用');
  }
  await api.saveAliyunToken(token);
}

export async function clearAliyunToken() {
  const api = getMusicBridgeApi();
  if (!api?.clearAliyunToken) {
    return;
  }
  await api.clearAliyunToken();
}

export async function scanMusicFiles(folderPath: string) {
  const api = getMusicBridgeApi();
  if (!api?.scanMusicFiles) {
    throw new Error('本地音乐扫描 API 不可用');
  }
  return api.scanMusicFiles(folderPath);
}

export async function validateMusicCloudStorage() {
  const api = getMusicBridgeApi();
  if (!api?.validateMusicCloudStorage) {
    throw new Error('音乐云存储 API 不可用');
  }
  return api.validateMusicCloudStorage();
}

export async function uploadMusicCloudStorageFile(filePath: string) {
  const api = getMusicBridgeApi();
  if (!api?.uploadMusicCloudStorageFile) {
    throw new Error('音乐云存储上传 API 不可用');
  }
  return api.uploadMusicCloudStorageFile(filePath);
}

export async function downloadMusicCloudStorageFile(key: string, fileName?: string) {
  const api = getMusicBridgeApi();
  if (!api?.downloadMusicCloudStorageFile) {
    throw new Error('音乐云存储下载 API 不可用');
  }
  return api.downloadMusicCloudStorageFile(key, fileName);
}

export async function resolveMusicCloudStoragePlayUrl(key: string, fileName?: string) {
  const api = getMusicBridgeApi();
  if (!api?.resolveMusicCloudStoragePlayUrl) {
    throw new Error('音乐云存储播放 API 不可用');
  }
  return api.resolveMusicCloudStoragePlayUrl(key, fileName);
}

export async function showMusicFolderDialog() {
  const api = getDialogApi();
  if (!api?.showOpenDialog) {
    throw new Error('选择文件夹 API 不可用');
  }

  const result = await api.showOpenDialog({ properties: ['openDirectory'] });
  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
}

export async function getMusicPlayerSettings(): Promise<MusicPlayerSettings> {
  const api = getMusicBridgeApi();
  if (!api?.getMusicPlayerSettings) {
    return { audioQuality: 'standard', downloadDir: '', saveDownloadDir: '', localMusicDir: '', cacheEnabled: true, volume: 0.8 };
  }
  return api.getMusicPlayerSettings();
}

export async function saveMusicPlayerSettings(settings: MusicPlayerSettings) {
  const api = getMusicBridgeApi();
  if (!api?.saveMusicPlayerSettings) {
    throw new Error('设置保存 API 不可用');
  }
  return api.saveMusicPlayerSettings(settings);
}

export async function getMusicFavorites(): Promise<StoredFavoriteTrack[]> {
  const api = getMusicBridgeApi();
  if (!api?.getMusicFavorites) {
    return [];
  }
  return api.getMusicFavorites() as Promise<StoredFavoriteTrack[]>;
}

export async function saveMusicFavorites(favorites: StoredFavoriteTrack[]) {
  const api = getMusicBridgeApi();
  if (!api?.saveMusicFavorites) {
    throw new Error('歌单保存 API 不可用');
  }
  await api.saveMusicFavorites(favorites);
}

export async function getMusicRecent(): Promise<StoredRecentTrack[]> {
  const api = getMusicBridgeApi();
  if (!api?.getMusicRecent) {
    return [];
  }
  return api.getMusicRecent() as Promise<StoredRecentTrack[]>;
}

export async function saveMusicRecent(recent: StoredRecentTrack[]) {
  const api = getMusicBridgeApi();
  if (!api?.saveMusicRecent) {
    throw new Error('最近播放保存 API 不可用');
  }
  await api.saveMusicRecent(recent);
}

export async function clearMusicRecent() {
  const api = getMusicBridgeApi();
  if (!api?.clearMusicRecent) {
    return;
  }
  await api.clearMusicRecent();
}

export async function getMusicPlaylists(): Promise<MusicPlaylist[]> {
  const api = getMusicBridgeApi();
  if (!api?.getMusicPlaylists) {
    return [];
  }
  return api.getMusicPlaylists() as Promise<MusicPlaylist[]>;
}

export async function saveMusicPlaylists(playlists: MusicPlaylist[]) {
  const api = getMusicBridgeApi();
  if (!api?.saveMusicPlaylists) {
    throw new Error('歌单保存 API 不可用');
  }
  await api.saveMusicPlaylists(playlists);
}

export async function getMusicCacheStats() {
  const api = getMusicBridgeApi();
  if (!api?.getMusicCacheStats) {
    return { bytes: 0, fileCount: 0, cacheDir: '' };
  }
  return api.getMusicCacheStats();
}

export async function clearMusicCache() {
  const api = getMusicBridgeApi();
  if (!api?.clearMusicCache) {
    throw new Error('缓存清理 API 不可用');
  }
  await api.clearMusicCache();
}

export function onCloudScanProgress(callback: (progress: CloudScanProgress) => void) {
  const api = getMusicBridgeApi();
  if (!api?.onCloudScanProgress) {
    return () => {};
  }
  return api.onCloudScanProgress(callback);
}
