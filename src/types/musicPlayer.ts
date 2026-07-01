export type MusicSource = 'local' | 'cloud' | 'online';
export type AudioQuality = 'standard' | 'high';
export type OnlinePlatform = 'netease' | 'tencent' | 'kugou' | 'kuwo' | 'baidu';

export interface OnlineSongItem {
  id: string;
  name: string;
  artist: string[];
  album: string;
  pic_id: string;
  url_id: string;
  lyric_id: string;
  source: string;
  cover?: string;
  duration?: number;
}

export interface MusicTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  path: string;
  cover?: string;
  lrc?: string;
  lrcText?: string;
  isFolder?: boolean;
  source: MusicSource;
  cloudProvider?: 'aliyun' | 'qiniu';
  cloudFileId?: string;
  fileName?: string;
  onlinePlatform?: OnlinePlatform;
  onlineSongId?: string;
  onlineLyricId?: string;
}

export interface MusicPlayerSettings {
  audioQuality: AudioQuality;
  downloadDir: string;
  saveDownloadDir: string;
  localMusicDir: string;
  cacheEnabled: boolean;
  volume: number;
}

export interface StoredFavoriteTrack {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration: number;
  source: MusicSource;
  cloudProvider?: 'aliyun' | 'qiniu';
  localPath?: string;
  cloudFileId?: string;
  cover?: string;
  lrc?: string;
  lrcText?: string;
  fileName?: string;
  onlinePlatform?: OnlinePlatform;
  onlineSongId?: string;
  onlineLyricId?: string;
}

export interface StoredRecentTrack extends StoredFavoriteTrack {
  playedAt: number;
}

export interface MusicPlaylist {
  id: string;
  name: string;
  description?: string;
  cover?: string;
  tracks: StoredFavoriteTrack[];
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_PLAYLIST_ID = 'default';

export interface CloudScanProgress {
  scannedFolders: number;
  foundTracks: number;
  currentFolder: string;
}
