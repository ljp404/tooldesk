import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import type {
  MusicPlayerSettings,
  MusicPlaylist,
  StoredFavoriteTrack,
  StoredRecentTrack
} from '../types/musicPlayer';
import type { TrackMetadataProbeItem, TrackMetadataProbeResult } from '../utils/musicPlayerClient';
import type { OnlinePlatform } from '../types/musicPlayer';

export type TauriMusicCacheStats = {
  bytes: number;
  cacheDir: string;
  fileCount: number;
};

export type TauriMusicTrack = {
  album: string;
  artist: string;
  duration: number;
  fileName: string;
  id: string;
  lrc?: string;
  name: string;
  path: string;
  source: 'local';
  title: string;
};

export function getMusicPlayerSettings() {
  return invoke<MusicPlayerSettings>('get_music_player_settings');
}

export function saveMusicPlayerSettings(settings: MusicPlayerSettings) {
  return invoke<MusicPlayerSettings>('save_music_player_settings', { settings });
}

export function getMusicFavorites() {
  return invoke<StoredFavoriteTrack[]>('get_music_favorites');
}

export function saveMusicFavorites(favorites: StoredFavoriteTrack[]) {
  return invoke<void>('save_music_favorites', { favorites });
}

export function getMusicRecent() {
  return invoke<StoredRecentTrack[]>('get_music_recent');
}

export function saveMusicRecent(recent: StoredRecentTrack[]) {
  return invoke<void>('save_music_recent', { recent });
}

export function clearMusicRecent() {
  return invoke<void>('clear_music_recent');
}

export function getMusicPlaylists() {
  return invoke<MusicPlaylist[]>('get_music_playlists');
}

export function saveMusicPlaylists(playlists: MusicPlaylist[]) {
  return invoke<void>('save_music_playlists', { playlists });
}

export function getMusicDownloads() {
  return invoke<StoredFavoriteTrack[]>('get_music_downloads');
}

export function saveMusicDownloads(downloads: StoredFavoriteTrack[]) {
  return invoke<void>('save_music_downloads', { downloads });
}

export function getMusicCacheStats() {
  return invoke<TauriMusicCacheStats>('get_music_cache_stats');
}

export function clearMusicCache() {
  return invoke<void>('clear_music_cache');
}

export function invalidateCloudCache(fileId: string, fileName: string) {
  return invoke<void>('invalidate_cloud_cache', { fileId, fileName });
}

export function scanMusicFiles(folderPath: string) {
  return invoke<TauriMusicTrack[]>('scan_music_files', { folderPath });
}

export function resolveLocalPlayUrl(filePath: string) {
  if (filePath.startsWith('asset://') || filePath.startsWith('http://') || filePath.startsWith('https://')) {
    return Promise.resolve(filePath);
  }

  return Promise.resolve(convertFileSrc(filePath));
}

export function resolveTrackLyrics(
  _cloudAccessToken: string | undefined,
  track: {
    lrc?: string;
    lrcText?: string;
    path?: string;
    source?: string;
  }
) {
  return invoke<string | null>('resolve_track_lyrics', { track });
}

export function searchOnlineMusic(platform: string, keyword: string, page = 1, limit = 30) {
  return invoke<unknown[]>('search_online_music', { keyword, limit, page, platform });
}

export function resolveOnlinePlayUrl(platform: string, songId: string) {
  return invoke<string>('resolve_online_play_url', { platform, songId });
}

export function downloadOnlineMusic(
  platform: OnlinePlatform,
  songId: string,
  fileName: string,
  targetDir?: string,
  lyric?: { album?: string; artist?: string; lyricId?: string; title?: string }
) {
  return invoke<{ filePath: string; skipped: boolean }>('download_online_music', {
    fileName,
    lyric: lyric ?? null,
    platform,
    songId,
    targetDir: targetDir ?? null
  });
}

type MusicCloudUploadResult = {
  bucket: string;
  hash: string;
  key: string;
  provider: 'qiniu';
  size: number;
  url: string;
};

type MusicCloudDownloadResult = {
  cachedPath: string;
  key: string;
  playUrl: string;
  provider: 'qiniu';
};

type MusicCloudValidateResult = {
  bucket: string;
  domain: string;
  provider: 'qiniu';
  region: string;
};

async function normalizeCloudDownloadResult(result: MusicCloudDownloadResult): Promise<MusicCloudDownloadResult> {
  return {
    ...result,
    playUrl: await resolveLocalPlayUrl(result.playUrl)
  };
}

export function uploadMusicCloudStorageFile(filePath: string) {
  return invoke<MusicCloudUploadResult>('upload_music_cloud_storage_file', { filePath });
}

export async function downloadMusicCloudStorageFile(key: string, fileName?: string) {
  const result = await invoke<MusicCloudDownloadResult>('download_music_cloud_storage_file', {
    fileName: fileName ?? null,
    key
  });
  return normalizeCloudDownloadResult(result);
}

export async function resolveMusicCloudStoragePlayUrl(key: string, fileName?: string) {
  const result = await invoke<MusicCloudDownloadResult>('resolve_music_cloud_storage_play_url', {
    fileName: fileName ?? null,
    key
  });
  return normalizeCloudDownloadResult(result);
}

export function validateMusicCloudStorage() {
  return invoke<MusicCloudValidateResult>('validate_music_cloud_storage');
}

export function probeTracksMetadata(tracks: TrackMetadataProbeItem[]): Promise<TrackMetadataProbeResult[]> {
  return invoke<TrackMetadataProbeResult[]>('probe_tracks_metadata', { tracks });
}
