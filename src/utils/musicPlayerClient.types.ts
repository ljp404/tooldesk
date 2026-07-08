export interface AliyunQRCodeResult {
  qrCodeContent: string;
  sid: string;
  t: string;
}

export interface AliyunTokenPayload {
  refresh_token: string;
}

export interface AliyunRefreshResult {
  access_token: string;
  refresh_token: string;
}

export interface AliyunFileItem {
  file_id: string;
  name: string;
  type: string;
  thumbnail?: string;
  duration?: number;
  cover?: string;
}

export interface MusicCloudStorageValidation {
  bucket: string;
  domain: string;
  provider: 'qiniu';
  region: string;
}

export interface MusicCloudStorageUploadResult {
  bucket: string;
  hash: string;
  key: string;
  provider: 'qiniu';
  size: number;
  url: string;
}

export interface MusicCloudStorageDownloadResult {
  cachedPath: string;
  key: string;
  playUrl: string;
  provider: 'qiniu';
}
