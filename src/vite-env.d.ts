/// <reference types="vite/client" />

interface Window {
  __TAURI_INTERNALS__?: unknown;
}

interface ShortcutRegistrationResult {
  accelerator: string;
  error?: string;
  registered: boolean;
}

interface TooldeskBaiduOcrSettings {
  apiKey: string;
  apiVariant: 'standard_located' | 'accurate_located';
  provider: 'baidu';
  secretKey: string;
}

interface TooldeskSettingsValidationResult {
  message?: string;
  ok: boolean;
}

interface TooldeskScreenshotSettings {
  autoCopy: boolean;
  enabled: boolean;
  ocrEnabled: boolean;
  saveToFile: boolean;
}

interface TooldeskScreenshotCaptureResult {
  capturedAt: number;
  canceled?: boolean;
  dataUrl: string;
  filePath?: string;
  height: number;
  width: number;
}

type TooldeskScreenRecordingFormat = 'gif' | 'mp4' | 'webm';

interface TooldeskScreenRecordingSavePayload {
  buffer: ArrayBuffer;
  cropRect?: {
    displayHeight?: number;
    displayWidth?: number;
    height: number;
    width: number;
    x: number;
    y: number;
  };
  durationMs: number;
  format: TooldeskScreenRecordingFormat;
}

interface TooldeskScreenRecordingSaveResult {
  canceled: boolean;
  filePath?: string;
}

interface TooldeskSuperClipboardSettings {
  enabled: boolean;
  ignoreDuplicates: boolean;
  maxImageBytes: number;
  maxItems: number;
  pollIntervalMs: number;
}

interface TooldeskSuperClipboardEntryMeta {
  category: string;
  charCount: number;
  contentHash: string;
  createdAt: number;
  id: string;
  preview: string;
  thumbnailDataUrl?: string;
  type: string;
}

interface TooldeskSuperClipboardEntryDetail extends TooldeskSuperClipboardEntryMeta {
  html?: string;
  imagePreviewDataUrl?: string;
  text?: string;
}

interface TooldeskSuperClipboardQuery {
  category?: string;
  limit?: number;
  offset?: number;
  search?: string;
}

interface TooldeskSuperClipboardQueryResult {
  items: TooldeskSuperClipboardEntryMeta[];
  total: number;
}

interface TooldeskSuperClipboardStats {
  byCategory: Record<string, number>;
  enabled: boolean;
  storageBytes: number;
  total: number;
}

interface TooldeskOcrConfigStatus {
  configured: boolean;
  locked: boolean;
  provider: 'baidu' | 'local' | 'none';
  source: 'cloud' | 'remote' | 'global' | 'env' | 'user' | 'none';
}

type TooldeskGlobalShortcutId = 'quickLauncher' | 'screenshot' | 'screenRecorder' | 'superClipboard';

interface TooldeskGlobalShortcutBinding {
  accelerator: string;
  enabled: boolean;
  id: TooldeskGlobalShortcutId;
}

interface TooldeskGlobalShortcutsSettings {
  bindings: TooldeskGlobalShortcutBinding[];
}

interface TooldeskTranslateSettings {
  aliyun: {
    accessKeyId: string;
    accessKeySecret: string;
    region: string;
  };
  baidu: {
    appId: string;
    secretKey: string;
  };
  provider: 'baidu' | 'tencent' | 'aliyun';
  tencent: {
    region: string;
    secretId: string;
    secretKey: string;
  };
}

interface TooldeskTranslateConfigStatus {
  configured: boolean;
  locked: boolean;
  provider: 'baidu' | 'tencent' | 'aliyun' | 'none';
  source: 'cloud' | 'remote' | 'global' | 'env' | 'user' | 'none';
}

interface TooldeskTranslateRequestPayload {
  from: string;
  text: string;
  to: string;
}

interface TooldeskTranslateResponsePayload {
  provider: 'baidu' | 'tencent' | 'aliyun';
  providerLabel: string;
  text: string;
}

interface TooldeskBrowserBookmarkItem {
  browser: string;
  createdAt?: string;
  domain: string;
  id: string;
  path: string[];
  profile: string;
  title: string;
  url: string;
}

interface TooldeskBrowserBookmarksResult {
  browsers: Array<{
    count: number;
    name: string;
    profiles: string[];
  }>;
  items: TooldeskBrowserBookmarkItem[];
  scannedAt: string;
}

interface TooldeskLocalLibraryConfig {
  keyword: string;
  name: string;
  path: string;
  extensions: string[];
  icon?: string;
  openWith: 'default' | 'typora' | 'vscode' | 'obsidian';
  typoraPath?: string;
  vaultName?: string;
  enabled: boolean;
}

interface TooldeskLocalLibrarySearchResult {
  fileName: string;
  filePath: string;
  relativePath: string;
  line?: number;
  content?: string;
  matchedKeyword?: string;
  modifiedTime: number;
}

interface TooldeskLocalLibrarySettings {
  libraries: TooldeskLocalLibraryConfig[];
  maxResults: number;
  searchContent: boolean;
  maxFilesToScan: number;
}

interface TooldeskKeePassSettings {
  dbPath: string;
  keyword: string;
}

interface TooldeskKeePassEntry {
  group: string;
  modifiedTime?: number;
  notes: string;
  password?: string;
  title: string;
  url: string;
  username: string;
  uuid: string;
}

interface TooldeskKeePassResult {
  dbPath?: string;
  entries?: TooldeskKeePassEntry[];
  error?: string;
  success: boolean;
}

type TooldeskPluginToolPermission =
  | 'browser-bookmarks'
  | 'clipboard'
  | 'docker'
  | 'filesystem'
  | 'hosts'
  | 'http'
  | 'mail'
  | 'keepass'
  | 'local-library'
  | 'music'
  | 'native-tool'
  | 'ssh';

interface TooldeskMailAccountConfig {
  authCode?: string;
  email?: string;
  imapHost?: string;
  imapPort?: number;
  secure?: boolean;
  username?: string;
}

interface TooldeskMailMessageSummary {
  attachments: Array<{
    contentType: string;
    filename: string;
    index?: number;
    size: number;
  }>;
  date: string;
  flags: string[];
  folder: string;
  from: string;
  html: string;
  id: string;
  seen: boolean;
  subject: string;
  text: string;
  to: string;
  uid: number;
}

interface TooldeskMailFetchResult {
  messages: TooldeskMailMessageSummary[];
  total: number;
}

interface TooldeskMailSendPayload {
  attachments?: Array<{
    contentBase64: string;
    contentType?: string;
    filename: string;
  }>;
  cc?: string[];
  html?: string;
  subject?: string;
  text?: string;
  to: string[];
}

interface TooldeskMailAttachmentDownloadResult {
  filename: string;
  path: string;
  size: number;
}

interface TooldeskMailFolderSummary {
  kind: string;
  name: string;
  path: string;
  total: number;
}

interface TooldeskPluginClipboardMatchConfig {
  priority?: number;
  type:
    | 'amount-lines'
    | 'bank-card'
    | 'base64'
    | 'calculator-expression'
    | 'cron'
    | 'decimal-amount'
    | 'html'
    | 'http-url'
    | 'id-card'
    | 'ip'
    | 'iso-date'
    | 'json'
    | 'jwt'
    | 'timestamp'
    | 'url-encoded';
}

interface TooldeskPluginToolRegistration {
  accent: string;
  capabilities?: string[];
  caption: string;
  category: string;
  clipboardMatch?: TooldeskPluginClipboardMatchConfig | TooldeskPluginClipboardMatchConfig[];
  defaultAlias: string;
  entryUrl: string;
  icon: string;
  installPath?: string;
  key: string;
  keywords: string[];
  label: string;
  manifestVersion: string;
  minHostVersion?: string;
  permissions: TooldeskPluginToolPermission[];
  pluginId: string;
  sdkVersion?: string;
  settings?: TooldeskPluginSettingsRegistration;
  source: 'plugin';
  sync?: TooldeskPluginSyncRegistration;
  windowIcon?: string;
}

interface TooldeskPluginSettingsRegistration {
  accent: string;
  entryUrl: string;
  icon: string;
  label: string;
}

interface TooldeskPluginSyncRegistration {
  localStorageKeys: string[];
}

interface TooldeskPluginMarketItem {
  accent: string;
  capabilities?: string[];
  caption: string;
  category: string;
  defaultAlias: string;
  downloadUrl: string;
  icon: string;
  keywords: string[];
  label: string;
  manifestUrl?: string;
  permissions: TooldeskPluginToolPermission[];
  pluginId: string;
  publisher: string;
  sha256: string;
  signature?: string;
  signatureUrl?: string;
  trusted: boolean;
  trustLevel: 'community' | 'official' | 'verified';
  updatedAt: string;
  version: string;
  windowIcon?: string;
}

interface TooldeskPluginMarketCatalog {
  error?: string;
  items: TooldeskPluginMarketItem[];
  marketUrl: string;
  updatedAt?: string;
  version: number;
}

interface TooldeskPluginInstallResult {
  canceled?: boolean;
  details?: string[];
  error?: string;
  pluginId?: string;
  tools: TooldeskPluginToolRegistration[];
  updated?: boolean;
}

type TooldeskSyncClassification = 'local' | 'sensitive' | 'syncable';

interface TooldeskSyncManifestItem {
  classification: TooldeskSyncClassification;
  description: string;
  exists: boolean;
  id: string;
  label: string;
  relativePath?: string;
  size: number;
  updatedAt?: string;
}

interface TooldeskSyncSnapshot {
  exportedAt: string;
  items: Record<string, unknown>;
  schemaVersion: 1;
}

interface TooldeskSyncCloudOptions {
  localItems?: Record<string, unknown>;
  loginName?: string;
  syncPassword?: string;
}

interface TooldeskSyncCloudSettings {
  autoSyncEnabled: boolean;
  lastSyncedAt?: string;
  lastSyncMessage?: string;
  loginName: string;
  syncPassword: string;
}

type TooldeskMusicCloudProvider = 'none' | 'qiniu';

interface TooldeskMusicCloudSettings {
  provider: TooldeskMusicCloudProvider;
  qiniu: {
    accessKey: string;
    bucket: string;
    domain: string;
    prefix: string;
    region: string;
    secretKey: string;
  };
}

interface TooldeskQuickWindowBounds {
  height: number;
  width: number;
  x?: number;
  y?: number;
}

interface TooldeskAppSettings {
  baiduOcr: TooldeskBaiduOcrSettings;
  closeToTray: boolean;
  globalShortcuts: TooldeskGlobalShortcutsSettings;
  keepass: TooldeskKeePassSettings;
  localLibrary: TooldeskLocalLibrarySettings;
  musicCloud: TooldeskMusicCloudSettings;
  ocrConfigStatus: TooldeskOcrConfigStatus;
  pluginAutoUpdateEnabled: boolean;
  quickWindowBounds: Record<string, TooldeskQuickWindowBounds>;
  screenshot: TooldeskScreenshotSettings;
  superClipboard: TooldeskSuperClipboardSettings;
  syncCloud: TooldeskSyncCloudSettings;
  translate: TooldeskTranslateSettings;
  translateConfigStatus: TooldeskTranslateConfigStatus;
}

type TooldeskStorageDirectoryKind = 'cache' | 'data';

interface TooldeskStorageDirectoryItem {
  configuredPath: string;
  currentPath: string;
  defaultPath: string;
  pendingPath: string;
  requiresRestart: boolean;
}

interface TooldeskStorageDirectoryConfig {
  cache: TooldeskStorageDirectoryItem;
  configPath: string;
  data: TooldeskStorageDirectoryItem;
}

interface TooldeskCacheCleanupResult {
  bytesFreed: number;
  path: string;
}

interface TooldeskShortcutApi {
  checkForUpdates(): Promise<{ success: boolean; hasUpdate?: boolean; message: string; version?: string }>;
  chooseStorageDirectory(kind: TooldeskStorageDirectoryKind): Promise<TooldeskStorageDirectoryConfig>;
  clearAppCache(): Promise<TooldeskCacheCleanupResult>;
  closeCurrentWindow(): Promise<void>;
  copyImage(dataUrl: string): Promise<boolean>;
  copyText(text: string): Promise<boolean>;
  defaultAccelerator: string;
  fitCurrentWindow(size: { height: number; width: number }): Promise<void>;
  moveCurrentWindowBy(delta: { x: number; y: number }): Promise<void>;
  showCurrentWindow(): Promise<void>;
  startCurrentWindowDrag(): Promise<void>;
  getAppSettings(): Promise<TooldeskAppSettings>;
  getInstalledApplicationIcon(applicationId: string): Promise<string | null>;
  getAppVersion(): Promise<string>;
  getStorageDirectories(): Promise<TooldeskStorageDirectoryConfig>;
  resetStorageDirectory(kind: TooldeskStorageDirectoryKind): Promise<TooldeskStorageDirectoryConfig>;
  getLastContent(): Promise<import('./types/toolbox').ShortcutContentPayload | null>;
  installDownloadedUpdate?: () => Promise<void>;
  onUpdateAvailable?: (callback: (data: { version: string }) => void) => () => void;
  onUpdateCheckComplete?: (callback: (data: { hasUpdate: boolean; version?: string }) => void) => () => void;
  onUpdateCheckError?: (callback: (data: { error: string }) => void) => () => void;
  onUpdateDownloadStart?: (callback: (data: { version: string }) => void) => () => void;
  onUpdateDownloadProgress?: (callback: (data: { percent: number; downloadedBytes: number; totalBytes: number; version?: string }) => void) => () => void;
  onUpdateDownloadComplete?: (callback: (data: { version: string }) => void) => () => void;
  onUpdateDownloadError?: (callback: (data: { error: string }) => void) => () => void;
  onUpdateInstallStart?: (callback: (data: { version: string }) => void) => () => void;
  isWindowMaximized(): Promise<boolean>;
  isWindowPinned(): Promise<boolean>;
  startScreenshot(): Promise<TooldeskScreenshotCaptureResult | null>;
  startScrollScreenshot(): Promise<{ message?: string; ok: boolean }>;
  dismissStaleScreenshotOverlay(): Promise<null>;
  getLastScreenshot(): Promise<TooldeskScreenshotCaptureResult | null>;
  copyLastScreenshot(): Promise<boolean>;
  openScreenshotSaveDir(): Promise<string>;
  saveScreenshotAs(payload?: TooldeskScreenshotCaptureResult): Promise<string | null>;
  saveScreenRecording(payload: TooldeskScreenRecordingSavePayload): Promise<TooldeskScreenRecordingSaveResult>;
  showScreenRecordingInFolder(targetPath: string): Promise<boolean>;
  closeScreenRecordingRegionFrame(): Promise<void>;
  showRegionRecordingPlayback(payload: {
    buffer: ArrayBuffer;
    cropRect: { height: number; width: number; x: number; y: number };
    durationMs?: number;
    sourceHeight: number;
    sourceWidth: number;
  }): Promise<boolean>;
  notifyRegionRecordingCaptureStarted(): Promise<void>;
  onRegionRecordingControl(callback: (action: 'stop' | 'toggle-pause') => void): () => void;
  pinScreenshot(payload?: TooldeskScreenshotCaptureResult): Promise<boolean>;
  onScreenshotCaptured(callback: (result: TooldeskScreenshotCaptureResult | null) => void): () => void;
  recognizeScreenshotText(payload: {
    imageBase64?: string;
    imagePath?: string;
  }): Promise<{
    imageHeight: number;
    imageWidth: number;
    lines: string[];
    rawText: string;
    words: Array<{ height: number; text: string; width: number; x: number; y: number }>;
  }>;
  querySuperClipboard(query: TooldeskSuperClipboardQuery): Promise<TooldeskSuperClipboardQueryResult>;
  getSuperClipboardDetail(id: string): Promise<TooldeskSuperClipboardEntryDetail | null>;
  deleteSuperClipboardItem(id: string): Promise<boolean>;
  clearSuperClipboard(category?: string): Promise<number>;
  getSuperClipboardStats(): Promise<TooldeskSuperClipboardStats>;
  copySuperClipboardItem(id: string): Promise<boolean>;
  onSuperClipboardNewEntry(callback: (entry: TooldeskSuperClipboardEntryMeta) => void): () => void;
  onSuperClipboardStatsChanged(callback: (stats: TooldeskSuperClipboardStats) => void): () => void;
  searchLocalLibrary(libraryKeyword: string, searchKeyword: string): Promise<TooldeskLocalLibrarySearchResult[]>;
  openLocalLibraryFile(filePath: string, libraryKeyword: string, line?: number, keyword?: string): Promise<void>;
  getLocalLibraries(): Promise<TooldeskLocalLibraryConfig[]>;
  onLocalLibraryChanged(callback: () => void): () => void;
  installLocalPlugin(): Promise<TooldeskPluginInstallResult>;
  installMarketPlugin(pluginId: string): Promise<TooldeskPluginInstallResult>;
  launchInstalledApplication(applicationId: string): Promise<void>;
  listInstalledApplications(): Promise<import('./types/installedApplication').InstalledApplication[]>;
  getPluginStorageItem(key: string): Promise<string | null>;
  listPluginMarket(): Promise<TooldeskPluginMarketCatalog>;
  listPluginTools(): Promise<TooldeskPluginToolRegistration[]>;
  onPluginToolsChanged(callback: (tools: TooldeskPluginToolRegistration[]) => void): () => void;
  removePluginStorageItem(key: string): Promise<boolean>;
  setPluginStorageItem(key: string, value: string): Promise<boolean>;
  uninstallPlugin(pluginId: string): Promise<TooldeskPluginInstallResult>;
  getSyncManifest(): Promise<TooldeskSyncManifestItem[]>;
  exportLocalSyncSnapshot(options?: Pick<TooldeskSyncCloudOptions, 'localItems'>): Promise<TooldeskSyncSnapshot>;
  exportLocalSyncSnapshotToFile(options?: Pick<TooldeskSyncCloudOptions, 'localItems'>): Promise<{
    canceled: boolean;
    exportedAt?: string;
    filePath?: string;
  }>;
  importLocalSyncSnapshot(snapshot: TooldeskSyncSnapshot): Promise<{ clientItems?: Record<string, unknown>; importedAt: string }>;
  importLocalSyncSnapshotFromFile(): Promise<{
    canceled: boolean;
    clientItems?: Record<string, unknown>;
    filePath?: string;
    importedAt?: string;
  }>;
  syncCloudSnapshot(options?: TooldeskSyncCloudOptions): Promise<{
    accountHash: string;
    clientItems?: Record<string, unknown>;
    lastSyncedAt: string;
    message: string;
    objectKey: string;
  }>;
  minimizeCurrentWindow(): Promise<void>;
  onAppNavigate(callback: (target: 'extensions' | 'settings') => void): () => void;
  onWindowMaximizedChange(callback: (maximized: boolean) => void): () => void;
  onTaskbarCalendarPopupOpened(callback: () => void): () => void;
  onClipboardContent(callback: (payload: import('./types/toolbox').ShortcutContentPayload) => void): () => void;
  onShortcutRecorded(callback: (accelerator: string) => void): () => void;
  openExternalUrl(targetUrl: string): Promise<boolean>;
  openHostsFolder(): Promise<string>;
  openPath(targetPath: string): Promise<string>;
  readTextFile(filePath: string): Promise<string>;
  showOpenDialog(options: any): Promise<{ canceled: boolean; filePaths: string[] }>;
  checkDockerAvailable(): Promise<{ available: boolean; error?: string; version?: string }>;
  dockerImageExists(image: string): Promise<boolean>;
  dockerPullImage(image: string): Promise<{ exitCode: number; ok: boolean; stderr: string; stdout: string }>;
  dockerTagImage(source: string, target: string): Promise<{ exitCode: number; ok: boolean; stderr: string; stdout: string }>;
  runDockerCompose(composeDir: string, args?: string[]): Promise<{ exitCode: number; ok: boolean; stderr: string; stdout: string }>;
  runPluginTool(payload: {
    args?: string[];
    cwd?: string;
    pluginId?: string;
    tool: string;
  }): Promise<{ exitCode: number; ok: boolean; stderr: string; stdout: string }>;
  testSshConnection(config: { host?: string; password?: string; port?: number | string; username?: string }): Promise<{ message: string; ok: boolean }>;
  sshExec(
    config: { host?: string; password?: string; port?: number | string; username?: string },
    command: string,
    options?: { timeoutMs?: number }
  ): Promise<{ exitCode: number; ok: boolean; stderr: string; stdout: string }>;
  sshExecStream(
    config: { host?: string; password?: string; port?: number | string; username?: string },
    command: string,
    options?: { timeoutMs?: number }
  ): Promise<{ exitCode: number; ok: boolean; stderr: string; stdout: string }>;
  onSshExecOutput(callback: (chunk: { line: string; stream: 'stderr' | 'stdout' }) => void): () => void;
  createTextExport(suggestedName?: string): Promise<{ exportId: string; filePath: string }>;
  appendTextExport(exportId: string, chunk: string): Promise<{ filePath: string }>;
  finishTextExport(exportId: string, openFile?: boolean): Promise<{ filePath: string }>;
  readHostsFile(): Promise<{ content: string; path: string }>;
  readBinaryFile(filePath: string): Promise<ArrayBuffer | Uint8Array>;
  updateHostsEntry(payload: { domain?: string; ip?: string }): Promise<{
    backupPath: string;
    domain: string;
    ip: string;
    path: string;
    savedAt: string;
    updated: boolean;
  }>;
  writeHostsFile(content: string): Promise<{ path: string; savedAt: string }>;
  openQuickTool(kind: string, content?: string, forceNew?: boolean): Promise<void>;
  queryDirectExternalIp(): Promise<{ ip: string; source: string }>;
  downloadMailAttachment(
    account: TooldeskMailAccountConfig,
    message: { folder?: string; uid: number },
    attachment: { filename?: string; folder?: string; index?: number }
  ): Promise<TooldeskMailAttachmentDownloadResult>;
  deleteMailMessage(account: TooldeskMailAccountConfig, message: { folder?: string; uid: number }): Promise<{ success: boolean }>;
  fetchMailMessages(account: TooldeskMailAccountConfig, options?: { folder?: string; limit?: number }): Promise<TooldeskMailFetchResult>;
  listMailFolders(account: TooldeskMailAccountConfig): Promise<TooldeskMailFolderSummary[]>;
  sendMailMessage(account: TooldeskMailAccountConfig, payload: TooldeskMailSendPayload): Promise<{ success: boolean }>;
  setMailMessageSeen(account: TooldeskMailAccountConfig, message: { folder?: string; uid: number }, seen: boolean): Promise<{ seen: boolean; success: boolean }>;
  getKeePassSession(dbPath?: string): Promise<TooldeskKeePassResult>;
  lockKeePassDatabase(): Promise<{ success: boolean }>;
  unlockKeePassDatabase(dbPath: string, password: string): Promise<TooldeskKeePassResult>;
  sendHttpRequest(payload: import('./types/http').HttpRequestPayload): Promise<import('./types/http').HttpResponsePayload>;
  translateText(payload: TooldeskTranslateRequestPayload): Promise<TooldeskTranslateResponsePayload>;
  listBrowserBookmarks(): Promise<TooldeskBrowserBookmarksResult>;
  validateBaiduOcrSettings(settings: TooldeskBaiduOcrSettings): Promise<TooldeskSettingsValidationResult>;
  validateTranslateSettings(settings: TooldeskTranslateSettings): Promise<TooldeskSettingsValidationResult>;
  readText(): Promise<string>;
  resumeShortcut(): Promise<{ registered: boolean }>;
  setAppSettings(settings: Partial<TooldeskAppSettings>): Promise<TooldeskAppSettings>;
  clearUserApiKeys(scope?: { ocr?: boolean; translate?: boolean }): Promise<TooldeskAppSettings>;
  setWindowPinned(pinned: boolean): Promise<void>;
  suspendShortcut(): Promise<{ suspended: boolean }>;
  toggleMaximizeCurrentWindow(): Promise<boolean>;
  // 音乐播放器 - 阿里云盘
  aliyunGenerateQRCode(): Promise<{ qrCodeContent: string; sid: string; t: string }>;
  aliyunCheckQRCode(t: string, sid: string): Promise<Record<string, unknown>>;
  aliyunRefreshToken(refreshToken: string): Promise<{ access_token: string; refresh_token: string }>;
  aliyunListFiles(accessToken: string, parentId?: string): Promise<Record<string, unknown>[]>;
  aliyunGetDownloadUrl(accessToken: string, fileId: string, audioQuality?: 'standard' | 'high'): Promise<string>;
  aliyunScanAllMusic(accessToken: string): Promise<Record<string, unknown>[]>;
  saveAliyunToken(token: { refresh_token: string }): Promise<void>;
  getAliyunToken(): Promise<{ refresh_token: string } | null>;
  clearAliyunToken(): Promise<void>;
  resolveCloudPlayUrl(accessToken: string, fileId: string, fileName: string): Promise<{
    playUrl: string;
    cachedPath?: string;
    cover?: string;
    artist?: string;
    album?: string;
    duration?: number;
  }>;
  resolveLocalPlayUrl(filePath: string): Promise<string>;
  invalidateCloudCache(fileId: string, fileName: string): Promise<void>;
  probeTracksMetadata(tracks: Array<{
    id: string;
    source: 'local' | 'cloud';
    localPath?: string;
    cloudFileId?: string;
    fileName?: string;
  }>): Promise<Array<{
    id: string;
    source: 'local' | 'cloud';
    duration?: number;
    cover?: string;
    artist?: string;
    album?: string;
  }>>;
  resolveTrackLyrics(
    accessToken: string | undefined,
    track: {
      source: 'local' | 'cloud' | 'online';
      title?: string;
      artist?: string;
      album?: string;
      lrc?: string;
      lrcText?: string;
      cloudFileId?: string;
      fileName?: string;
      onlinePlatform?: string;
      onlineSongId?: string;
      onlineLyricId?: string;
    }
  ): Promise<string | null>;
  downloadCloudMusic(
    accessToken: string,
    fileId: string,
    fileName: string,
    targetDir?: string
  ): Promise<{ filePath: string; skipped: boolean }>;
  searchOnlineMusic(platform: string, keyword: string, page?: number, limit?: number): Promise<unknown[]>;
  resolveOnlinePlayUrl(platform: string, songId: string): Promise<string>;
  downloadOnlineMusic(
    platform: string,
    songId: string,
    fileName: string,
    targetDir?: string,
    lyric?: { album?: string; artist?: string; lyricId?: string; title?: string }
  ): Promise<{ filePath: string; skipped: boolean }>;
  getMusicPlayerSettings(): Promise<{ audioQuality: 'standard' | 'high'; downloadDir: string; saveDownloadDir: string; localMusicDir: string; cacheEnabled: boolean; volume: number }>;
  saveMusicPlayerSettings(settings: { audioQuality: 'standard' | 'high'; downloadDir: string; saveDownloadDir: string; localMusicDir: string; cacheEnabled: boolean; volume: number }): Promise<{ audioQuality: 'standard' | 'high'; downloadDir: string; saveDownloadDir: string; localMusicDir: string; cacheEnabled: boolean; volume: number }>;
  getMusicFavorites(): Promise<unknown[]>;
  saveMusicFavorites(favorites: unknown[]): Promise<void>;
  getMusicRecent(): Promise<unknown[]>;
  saveMusicRecent(recent: unknown[]): Promise<void>;
  clearMusicRecent(): Promise<void>;
  getMusicPlaylists(): Promise<unknown[]>;
  saveMusicPlaylists(playlists: unknown[]): Promise<void>;
  getMusicDownloads(): Promise<unknown[]>;
  saveMusicDownloads(records: unknown[]): Promise<void>;
  getMusicCacheStats(): Promise<{ bytes: number; fileCount: number; cacheDir: string }>;
  clearMusicCache(): Promise<void>;
  onCloudScanProgress(callback: (progress: { scannedFolders: number; foundTracks: number; currentFolder: string }) => void): () => void;
  // 音乐播放器 - 本地音乐
  scanMusicFiles(folderPath: string): Promise<Record<string, unknown>[]>;
  validateMusicCloudStorage(): Promise<{
    bucket: string;
    domain: string;
    provider: 'qiniu';
    region: string;
  }>;
  uploadMusicCloudStorageFile(filePath: string): Promise<{
    bucket: string;
    hash: string;
    key: string;
    provider: 'qiniu';
    size: number;
    url: string;
  }>;
  downloadMusicCloudStorageFile(key: string, fileName?: string): Promise<{
    cachedPath: string;
    key: string;
    playUrl: string;
    provider: 'qiniu';
  }>;
  resolveMusicCloudStoragePlayUrl(key: string, fileName?: string): Promise<{
    cachedPath: string;
    key: string;
    playUrl: string;
    provider: 'qiniu';
  }>;
}

interface Window {
  tooldeskShortcut?: TooldeskShortcutApi;
}
