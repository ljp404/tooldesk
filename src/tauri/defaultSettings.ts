import { getDefaultBaiduOcrSettings } from '../types/baiduOcr';
import { getDefaultGlobalShortcutsSettings } from '../types/globalShortcuts';
import { getDefaultTranslateSettings } from '../types/translate';
import { getDefaultScreenshotSettings } from '../utils/screenshotClient';
import { getDefaultSuperClipboardSettings } from '../utils/superClipboardClient';

export function getDefaultTauriSettings(): TooldeskAppSettings {
  return {
    baiduOcr: getDefaultBaiduOcrSettings(),
    closeToTray: true,
    globalShortcuts: getDefaultGlobalShortcutsSettings(),
    keepass: {
      dbPath: '',
      keyword: 'kp'
    },
    localLibrary: {
      libraries: [],
      maxFilesToScan: 5000,
      maxResults: 50,
      searchContent: true
    },
    musicCloud: {
      provider: 'none',
      qiniu: {
        accessKey: '',
        bucket: '',
        domain: '',
        prefix: 'tooldesk/music/',
        region: 'z0',
        secretKey: ''
      }
    },
    ocrConfigStatus: {
      configured: false,
      locked: false,
      provider: 'none',
      source: 'none'
    },
    pluginAutoUpdateEnabled: false,
    quickWindowBounds: {},
    screenshot: getDefaultScreenshotSettings(),
    superClipboard: getDefaultSuperClipboardSettings(),
    syncCloud: {
      autoSyncEnabled: false,
      lastSyncMessage: '',
      lastSyncedAt: '',
      loginName: '',
      syncPassword: ''
    },
    translate: getDefaultTranslateSettings(),
    translateConfigStatus: {
      configured: false,
      locked: false,
      provider: 'none',
      source: 'none'
    }
  };
}
