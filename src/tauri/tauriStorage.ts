import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getDefaultTauriSettings } from './defaultSettings';
import { syncGlobalShortcuts } from './tauriGlobalShortcuts';
import { isServiceGatewayConfigured } from './tauriServiceGateway';

async function resolveRuntimeSettings(settings: TooldeskAppSettings) {
  const serviceGatewayConfigured = await isServiceGatewayConfigured().catch(() => false);
  const hasUserOcr = Boolean(settings.baiduOcr.apiKey.trim() && settings.baiduOcr.secretKey.trim());
  const hasUserTranslate = (() => {
    if (settings.translate.provider === 'tencent') {
      return Boolean(settings.translate.tencent.secretId.trim() && settings.translate.tencent.secretKey.trim());
    }

    if (settings.translate.provider === 'aliyun') {
      return Boolean(settings.translate.aliyun.accessKeyId.trim() && settings.translate.aliyun.accessKeySecret.trim());
    }

    return Boolean(settings.translate.baidu.appId.trim() && settings.translate.baidu.secretKey.trim());
  })();

  return {
    ...settings,
    ocrConfigStatus: hasUserOcr
      ? {
          configured: true,
          locked: false,
          provider: 'baidu' as const,
          source: 'user' as const
        }
      : serviceGatewayConfigured
      ? {
          configured: true,
          locked: false,
          provider: 'baidu' as const,
          source: 'cloud' as const
        }
      : settings.ocrConfigStatus,
    translateConfigStatus: hasUserTranslate
      ? {
          configured: true,
          locked: false,
          provider: settings.translate.provider,
          source: 'user' as const
        }
      : serviceGatewayConfigured
      ? {
          configured: true,
          locked: false,
          provider: settings.translate.provider,
          source: 'cloud' as const
        }
      : settings.translateConfigStatus
  };
}

export async function getAppSettings(): Promise<TooldeskAppSettings> {
  try {
    const rawSettings = await invoke<TooldeskAppSettings>('get_app_settings', {
      defaultSettings: getDefaultTauriSettings()
    });
    const settings = await resolveRuntimeSettings(rawSettings);
    void syncGlobalShortcuts(settings).catch((error) => {
      console.warn('[tauri] Failed to sync global shortcuts.', error);
    });
    return settings;
  } catch {
    return getDefaultTauriSettings();
  }
}

export async function setAppSettings(partial: Partial<TooldeskAppSettings>): Promise<TooldeskAppSettings> {
  const rawSettings = await invoke<TooldeskAppSettings>('set_app_settings', {
    defaultSettings: getDefaultTauriSettings(),
    settings: partial
  });
  const settings = await resolveRuntimeSettings(rawSettings);
  void syncGlobalShortcuts(settings).catch((error) => {
    console.warn('[tauri] Failed to sync global shortcuts.', error);
  });
  return settings;
}

export async function getStorageDirectories(): Promise<TooldeskStorageDirectoryConfig> {
  return invoke<TooldeskStorageDirectoryConfig>('get_storage_directories');
}

export async function chooseStorageDirectory(kind: TooldeskStorageDirectoryKind) {
  const current = await getStorageDirectories();
  const selected = await openDialog({
    canCreateDirectories: true,
    defaultPath: current[kind].pendingPath || current[kind].currentPath,
    directory: true,
    multiple: false,
    title: kind === 'data' ? '选择数据目录' : '选择缓存目录'
  });

  if (typeof selected !== 'string' || !selected.trim()) {
    return current;
  }

  return invoke<TooldeskStorageDirectoryConfig>('set_storage_directory', {
    kind,
    targetPath: selected.trim()
  });
}

export async function resetStorageDirectory(kind: TooldeskStorageDirectoryKind) {
  return invoke<TooldeskStorageDirectoryConfig>('reset_storage_directory', { kind });
}

export async function getPluginStorageItem(key: string) {
  return invoke<string | null>('get_plugin_storage_item', { key });
}

export async function setPluginStorageItem(key: string, value: string) {
  return invoke<boolean>('set_plugin_storage_item', { key, value });
}

export async function removePluginStorageItem(key: string) {
  return invoke<boolean>('remove_plugin_storage_item', { key });
}
