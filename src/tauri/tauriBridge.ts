import { getDefaultSuperClipboardSettings } from '../utils/superClipboardClient';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { LogicalSize, PhysicalPosition } from '@tauri-apps/api/dpi';
import { listen } from '@tauri-apps/api/event';
import { openUrl as openTauriUrl } from '@tauri-apps/plugin-opener';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getDefaultBaiduOcrSettings } from '../types/baiduOcr';
import { getDefaultTranslateSettings } from '../types/translate';
import { copyImage, copyText, readText } from './tauriClipboard';
import { listBrowserBookmarks } from './tauriBrowserBookmarks';
import {
  checkDockerAvailable,
  dockerImageExists,
  dockerPullImage,
  dockerTagImage,
  runDockerCompose
} from './tauriDocker';
import {
  chooseStorageDirectory,
  getAppSettings,
  getPluginStorageItem,
  getStorageDirectories,
  removePluginStorageItem,
  resetStorageDirectory,
  setAppSettings,
  setPluginStorageItem
} from './tauriStorage';
import { sendHttpRequest } from './tauriHttp';
import { resumeGlobalShortcuts, suspendGlobalShortcuts } from './tauriGlobalShortcuts';
import {
  aliyunCheckQRCode,
  aliyunGenerateQRCode,
  aliyunGetDownloadUrl,
  aliyunListFiles,
  aliyunRefreshToken,
  clearAliyunToken,
  downloadCloudMusic,
  getAliyunToken,
  resolveCloudPlayUrl,
  saveAliyunToken,
  scanAliyunMusic
} from './tauriAliyun';
import {
  appendTextExport,
  createTextExport,
  finishTextExport,
  openHostsFolder,
  readBinaryFile,
  readHostsFile,
  readTextFile,
  showOpenDialog,
  updateHostsEntry,
  writeHostsFile
} from './tauriFile';
import {
  getLocalLibraries,
  notifyLocalLibraryChanged,
  onLocalLibraryChanged,
  openLocalLibraryFile,
  searchLocalLibrary
} from './tauriLocalLibrary';
import { getKeePassSession, lockKeePassDatabase, unlockKeePassDatabase } from './tauriKeepass';
import { deleteMailMessage, downloadMailAttachment, fetchMailMessages, listMailFolders, sendMailMessage, setMailMessageSeen } from './tauriMail';
import {
  clearMusicCache,
  clearMusicRecent,
  downloadOnlineMusic,
  downloadMusicCloudStorageFile,
  getMusicCacheStats,
  getMusicDownloads,
  getMusicFavorites,
  getMusicPlayerSettings,
  getMusicPlaylists,
  getMusicRecent,
  invalidateCloudCache,
  probeTracksMetadata,
  resolveLocalPlayUrl,
  resolveMusicCloudStoragePlayUrl,
  resolveOnlinePlayUrl,
  resolveTrackLyrics,
  saveMusicDownloads,
  saveMusicFavorites,
  saveMusicPlayerSettings,
  saveMusicPlaylists,
  saveMusicRecent,
  scanMusicFiles,
  searchOnlineMusic,
  uploadMusicCloudStorageFile,
  validateMusicCloudStorage
} from './tauriMusic';
import { getLastContent, openQuickToolWindow } from './tauriQuickTool';
import {
  getInstalledApplicationIcon,
  launchInstalledApplication,
  listInstalledApplications
} from './tauriInstalledApplications';
import {
  installLocalPlugin,
  installMarketPlugin,
  listPluginMarket,
  listPluginTools,
  onPluginToolsChanged,
  uninstallPlugin
} from './tauriPlugins';
import {
  exportLocalSyncSnapshot,
  exportLocalSyncSnapshotToFile,
  getSyncManifest,
  importLocalSyncSnapshot,
  importLocalSyncSnapshotFromFile,
  syncCloudSnapshot
} from './tauriSync';
import { onSshExecOutput, sshExec, sshExecStream, testSshConnection } from './tauriSsh';
import {
  clearSuperClipboard,
  copySuperClipboardItem,
  deleteSuperClipboardItem,
  getSuperClipboardDetail,
  getSuperClipboardStats,
  onSuperClipboardNewEntry,
  onSuperClipboardStatsChanged,
  querySuperClipboard,
  startSuperClipboardWatcher,
  syncSuperClipboardSettings
} from './tauriSuperClipboard';
import { recognizeScreenshotText, validateBaiduOcrSettings } from './tauriOcr';
import { translateText, validateTranslateSettings } from './tauriTranslate';
import { checkForUpdates, installDownloadedUpdate } from './tauriUpdate';
import {
  openScreenshotSaveDir,
  saveScreenRecording,
  saveScreenshotAs,
  showInFolder,
  showRegionRecordingPlayback
} from './tauriMediaSave';
import {
  copyLastScreenshot,
  dismissStaleScreenshotOverlay,
  getLastScreenshot,
  initScreenshotCapturedListener,
  onScreenshotCaptured,
  pinScreenshot,
  startScreenshot
} from './tauriScreenshot';

type TauriWindow = Window & {
  __TAURI_INTERNALS__?: unknown;
};

const APP_VERSION = '0.1.0';
const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'obsidian:']);
let tauriPinned = false;
const cloudScanProgressListeners = new Set<(progress: { scannedFolders: number; foundTracks: number; currentFolder: string }) => void>();
const shortcutRecordedListeners = new Set<(accelerator: string) => void>();
const regionRecordingControlListeners = new Set<(action: 'stop' | 'toggle-pause') => void>();
let shortcutRecorderActive = false;

function isTauriRuntime() {
  return Boolean((window as TauriWindow).__TAURI_INTERNALS__);
}

function normalizeShortcutRecordKey(event: KeyboardEvent) {
  if (event.code === 'Space') {
    return 'Space';
  }

  if (/^Key[A-Z]$/.test(event.code)) {
    return event.code.replace('Key', '');
  }

  if (/^Digit[0-9]$/.test(event.code)) {
    return event.code.replace('Digit', '');
  }

  const keyMap: Record<string, string> = {
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ArrowUp: 'Up',
    Backspace: 'Backspace',
    Delete: 'Delete',
    End: 'End',
    Enter: 'Enter',
    Escape: 'Escape',
    Home: 'Home',
    Insert: 'Insert',
    PageDown: 'PageDown',
    PageUp: 'PageUp',
    Tab: 'Tab'
  };

  if (keyMap[event.key]) {
    return keyMap[event.key];
  }

  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.key)) {
    return event.key;
  }

  if (event.key.length === 1) {
    return event.key.toUpperCase();
  }

  return '';
}

function handleShortcutRecordKeydown(event: KeyboardEvent) {
  if (!shortcutRecorderActive || event.key === 'Tab') {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const key = normalizeShortcutRecordKey(event);
  const isModifierOnly = ['Alt', 'Control', 'Meta', 'Shift'].includes(event.key);

  if (!key || isModifierOnly) {
    return;
  }

  const modifiers = [
    event.ctrlKey ? 'Ctrl' : '',
    event.altKey ? 'Alt' : '',
    event.shiftKey ? 'Shift' : '',
    event.metaKey ? 'Meta' : ''
  ].filter(Boolean);

  if (modifiers.length === 0) {
    return;
  }

  const accelerator = [...modifiers, key].join('+');
  shortcutRecordedListeners.forEach((callback) => callback(accelerator));
}

function onTauriShortcutRecorded(callback: (accelerator: string) => void) {
  shortcutRecordedListeners.add(callback);
  let unlisten: (() => void) | undefined;
  window.addEventListener('keydown', handleShortcutRecordKeydown, true);
  void listen<string>('shortcut:recorded', (event) => {
    if (!shortcutRecorderActive) {
      return;
    }

    const accelerator = String(event.payload ?? '').trim();
    if (accelerator) {
      callback(accelerator);
    }
  }).then((value) => {
    unlisten = value;
  });

  return () => {
    shortcutRecordedListeners.delete(callback);
    unlisten?.();

    if (shortcutRecordedListeners.size === 0) {
      window.removeEventListener('keydown', handleShortcutRecordKeydown, true);
    }
  };
}

function onTauriCloudScanProgress(callback: (progress: { scannedFolders: number; foundTracks: number; currentFolder: string }) => void) {
  cloudScanProgressListeners.add(callback);
  return () => {
    cloudScanProgressListeners.delete(callback);
  };
}

function onTauriRegionRecordingControl(callback: (action: 'stop' | 'toggle-pause') => void) {
  regionRecordingControlListeners.add(callback);
  let unlisten: (() => void) | undefined;
  void listen<'stop' | 'toggle-pause'>('screen-recorder:control', (event) => {
    regionRecordingControlListeners.forEach((listener) => listener(event.payload));
  }).then((value) => {
    unlisten = value;
  });

  return () => {
    regionRecordingControlListeners.delete(callback);
    unlisten?.();
  };
}

function onTauriClipboardContent(callback: (payload: import('../types/toolbox').ShortcutContentPayload) => void) {
  let unlisten: (() => void) | undefined;
  void listen<import('../types/toolbox').ShortcutContentPayload>('shortcut:clipboard-content', (event) => {
    callback(event.payload);
  }).then((value) => {
    unlisten = value;
  });
  return () => unlisten?.();
}

function onTauriAppNavigate(callback: (target: 'extensions' | 'settings') => void) {
  let unlisten: (() => void) | undefined;
  void listen<'extensions' | 'settings'>('app:navigate', (event) => {
    callback(event.payload);
  }).then((value) => {
    unlisten = value;
  });
  return () => unlisten?.();
}

function onTauriTaskbarCalendarPopupOpened(callback: () => void) {
  let unlisten: (() => void) | undefined;
  void listen('taskbar-calendar:popup-opened', () => {
    callback();
  }).then((value) => {
    unlisten = value;
  });
  return () => unlisten?.();
}

function onTauriUpdateEvent<T>(eventName: string, callback: (data: T) => void) {
  let unlisten: (() => void) | undefined;
  void listen<T>(eventName, (event) => {
    callback(event.payload);
  }).then((value) => {
    unlisten = value;
  });
  return () => unlisten?.();
}

function normalizeExternalUrl(value: string) {
  const trimmed = String(value ?? '').trim();

  if (!trimmed) {
    throw new Error('URL 不能为空');
  }

  const parsed = new URL(trimmed);

  if (!ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(`不支持打开 ${parsed.protocol} 链接`);
  }

  return parsed.toString();
}

async function getTauriAppVersion() {
  try {
    return await getVersion();
  } catch {
    return APP_VERSION;
  }
}

async function fitCurrentWindow(size: { height: number; width: number }) {
  await getCurrentWindow().setSize(new LogicalSize(size.width, size.height));
}

async function moveCurrentWindowBy(delta: { x: number; y: number }) {
  const currentWindow = getCurrentWindow();
  const position = await currentWindow.outerPosition();
  await currentWindow.setPosition(new PhysicalPosition(position.x + delta.x, position.y + delta.y));
}

async function startCurrentWindowDrag() {
  await getCurrentWindow().startDragging();
}

async function showCurrentWindow() {
  const currentWindow = getCurrentWindow();
  await currentWindow.show();
  await currentWindow.setFocus();
}

async function openExternalUrl(targetUrl: string) {
  let normalizedUrl: string;

  try {
    normalizedUrl = normalizeExternalUrl(targetUrl);
  } catch (error) {
    console.warn('[tauri] Blocked external URL.', error);
    return false;
  }

  try {
    await openTauriUrl(normalizedUrl);
    return true;
  } catch (error) {
    console.warn('[tauri] Failed to open external URL.', error);
    return false;
  }
}

async function openPath(targetPath: string) {
  const normalizedPath = String(targetPath ?? '').trim();

  if (!normalizedPath) {
    return '路径不能为空';
  }

  try {
    await invoke('open_path', { targetPath: normalizedPath });
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : '打开路径失败';
  }
}

async function suspendTauriShortcutRecording() {
  shortcutRecorderActive = true;
  return suspendGlobalShortcuts();
}

async function resumeTauriShortcutRecording() {
  shortcutRecorderActive = false;
  return resumeGlobalShortcuts(await getAppSettings());
}

export function installTauriBridge() {
  if (!isTauriRuntime() || window.tooldeskShortcut) {
    return;
  }

  const isQuickWindow = new URLSearchParams(window.location.search).has('quick');

  if (!isQuickWindow) {
    initScreenshotCapturedListener();
    startSuperClipboardWatcher(getDefaultSuperClipboardSettings());
    void getAppSettings()
      .then((settings) => syncSuperClipboardSettings(settings.superClipboard))
      .catch(() => undefined);
  }

  const bridge: TooldeskShortcutApi = {
    aliyunCheckQRCode,
    aliyunGenerateQRCode,
    aliyunGetDownloadUrl,
    aliyunListFiles,
    aliyunRefreshToken,
    aliyunScanAllMusic: (accessToken) => scanAliyunMusic(accessToken, (progress) => {
      cloudScanProgressListeners.forEach((callback) => callback(progress));
    }),
    appendTextExport,
    checkDockerAvailable,
    checkForUpdates,
    chooseStorageDirectory,
    clearAliyunToken,
    clearAppCache: () => invoke<TooldeskCacheCleanupResult>('clear_app_cache'),
    clearMusicCache,
    clearMusicRecent,
    clearSuperClipboard,
    clearUserApiKeys: async (scope) => {
      const settings = await getAppSettings();
      if (scope?.ocr) {
        settings.baiduOcr = getDefaultBaiduOcrSettings();
      }
      if (scope?.translate) {
        settings.translate = getDefaultTranslateSettings();
      }
      return setAppSettings(settings);
    },
    closeCurrentWindow: () => getCurrentWindow().close(),
    closeScreenRecordingRegionFrame: () => invoke<number>('close_screen_recording_region_frame').then(() => undefined),
    copyImage,
    copyLastScreenshot,
    copySuperClipboardItem,
    copyText,
    createTextExport,
    defaultAccelerator: 'Alt+Space',
    deleteSuperClipboardItem,
    deleteMailMessage,
    dismissStaleScreenshotOverlay,
    dockerImageExists,
    dockerPullImage,
    dockerTagImage,
    downloadCloudMusic,
    downloadMusicCloudStorageFile,
    downloadOnlineMusic,
    downloadMailAttachment,
    exportLocalSyncSnapshot,
    exportLocalSyncSnapshotToFile,
    fetchMailMessages,
    finishTextExport: (exportId, openFile) => finishTextExport(openPath, exportId, openFile),
    fitCurrentWindow,
    getAliyunToken,
    getAppSettings,
    getAppVersion: getTauriAppVersion,
    getInstalledApplicationIcon,
    getLastContent,
    getKeePassSession,
    getLastScreenshot,
    getLocalLibraries,
    getMusicCacheStats,
    getMusicDownloads,
    getMusicFavorites,
    getMusicPlayerSettings,
    getMusicPlaylists,
    getMusicRecent,
    getPluginStorageItem,
    getStorageDirectories,
    getSuperClipboardDetail,
    getSuperClipboardStats,
    getSyncManifest,
    importLocalSyncSnapshot,
    importLocalSyncSnapshotFromFile,
    installDownloadedUpdate,
    installLocalPlugin,
    installMarketPlugin,
    invalidateCloudCache,
    isWindowMaximized: () => getCurrentWindow().isMaximized(),
    isWindowPinned: () => Promise.resolve(tauriPinned),
    launchInstalledApplication,
    listBrowserBookmarks,
    listInstalledApplications,
    listMailFolders,
    listPluginMarket,
    listPluginTools,
    lockKeePassDatabase,
    minimizeCurrentWindow: () => getCurrentWindow().minimize(),
    moveCurrentWindowBy,
    notifyRegionRecordingCaptureStarted: () => invoke<number>('notify_region_recording_capture_started').then(() => undefined),
    onAppNavigate: onTauriAppNavigate,
    onClipboardContent: onTauriClipboardContent,
    onCloudScanProgress: onTauriCloudScanProgress,
    onLocalLibraryChanged,
    onPluginToolsChanged,
    onRegionRecordingControl: onTauriRegionRecordingControl,
    onScreenshotCaptured,
    onShortcutRecorded: onTauriShortcutRecorded,
    onSshExecOutput,
    onSuperClipboardNewEntry,
    onSuperClipboardStatsChanged,
    onTaskbarCalendarPopupOpened: onTauriTaskbarCalendarPopupOpened,
    onUpdateAvailable: (callback) => onTauriUpdateEvent('update-available', callback),
    onUpdateCheckComplete: (callback) => onTauriUpdateEvent('update-check-complete', callback),
    onUpdateCheckError: (callback) => onTauriUpdateEvent('update-check-error', callback),
    onUpdateDownloadComplete: (callback) => onTauriUpdateEvent('update-download-complete', callback),
    onUpdateDownloadError: (callback) => onTauriUpdateEvent('update-download-error', callback),
    onUpdateDownloadProgress: (callback) => onTauriUpdateEvent('update-download-progress', callback),
    onUpdateDownloadStart: (callback) => onTauriUpdateEvent('update-download-start', callback),
    onUpdateInstallStart: (callback) => onTauriUpdateEvent('update-install-start', callback),
    onWindowMaximizedChange: (callback) => {
      let unlisten: (() => void) | undefined;
      void getCurrentWindow().onResized(() => {
        void getCurrentWindow().isMaximized().then(callback);
      }).then((value) => {
        unlisten = value;
      });
      return () => unlisten?.();
    },
    openExternalUrl,
    openHostsFolder: () => openHostsFolder(openPath),
    openLocalLibraryFile: (filePath, libraryKeyword, line) => openLocalLibraryFile(openExternalUrl, openPath, filePath, libraryKeyword, line),
    openPath,
    openQuickTool: openQuickToolWindow,
    openScreenshotSaveDir,
    pinScreenshot,
    probeTracksMetadata,
    queryDirectExternalIp: async () => {
      const response = await sendHttpRequest({
        body: '',
        headers: {},
        method: 'GET',
        timeoutMs: 5000,
        url: 'https://api.ipify.org?format=json'
      });
      const data = JSON.parse(response.body || '{}') as { ip?: string };
      return { ip: data.ip ?? '', source: 'ipify' };
    },
    querySuperClipboard,
    readBinaryFile,
    readHostsFile,
    readText,
    readTextFile,
    recognizeScreenshotText,
    resetStorageDirectory,
    resolveCloudPlayUrl,
    resolveLocalPlayUrl,
    resolveMusicCloudStoragePlayUrl,
    resolveOnlinePlayUrl,
    resolveTrackLyrics,
    removePluginStorageItem,
    resumeShortcut: resumeTauriShortcutRecording,
    runDockerCompose,
    runPluginTool: (payload) => invoke('run_plugin_tool', { payload }),
    saveAliyunToken,
    saveMusicDownloads,
    saveMusicFavorites,
    saveMusicPlayerSettings,
    saveMusicPlaylists,
    saveMusicRecent,
    saveScreenRecording,
    saveScreenshotAs,
    scanMusicFiles,
    searchLocalLibrary,
    searchOnlineMusic,
    sendMailMessage,
    sendHttpRequest,
    startCurrentWindowDrag,
    setAppSettings: async (settings) => {
      const previousSettings = await getAppSettings();
      const nextSettings = await setAppSettings(settings);
      syncSuperClipboardSettings(nextSettings.superClipboard);
      if (
        settings.localLibrary &&
        JSON.stringify(previousSettings.localLibrary) !== JSON.stringify(nextSettings.localLibrary)
      ) {
        notifyLocalLibraryChanged();
      }
      return nextSettings;
    },
    setPluginStorageItem,
    setMailMessageSeen,
    setWindowPinned: async (pinned) => {
      tauriPinned = pinned;
      await getCurrentWindow().setAlwaysOnTop(pinned);
    },
    showCurrentWindow,
    showRegionRecordingPlayback,
    showScreenRecordingInFolder: showInFolder,
    showOpenDialog,
    sshExec,
    sshExecStream,
    startScreenshot,
    startScrollScreenshot: async () => {
      const ok = await invoke<boolean>('open_scroll_screenshot_selection');
      return {
        message: ok ? '请框选可滚动区域，然后点击开始滚动截图' : '滚动截图启动失败',
        ok
      };
    },
    suspendShortcut: suspendTauriShortcutRecording,
    syncCloudSnapshot,
    testSshConnection,
    toggleMaximizeCurrentWindow: async () => {
      const currentWindow = getCurrentWindow();
      const maximized = await currentWindow.isMaximized();
      if (maximized) {
        await currentWindow.unmaximize();
        return false;
      }

      await currentWindow.maximize();
      return true;
    },
    translateText,
    uninstallPlugin,
    unlockKeePassDatabase,
    updateHostsEntry,
    uploadMusicCloudStorageFile,
    validateBaiduOcrSettings,
    validateMusicCloudStorage,
    validateTranslateSettings,
    writeHostsFile
  };

  window.tooldeskShortcut = bridge;
}
