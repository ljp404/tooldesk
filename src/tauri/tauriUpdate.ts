import { invoke } from '@tauri-apps/api/core';
import { isServiceGatewayConfigured, postServiceGateway } from './tauriServiceGateway';

export type TauriUpdateCheckResult = {
  downloadUrl?: string;
  fileName?: string;
  hasUpdate: boolean;
  message: string;
  sha512?: string;
  success: boolean;
  version?: string;
};

type TauriDownloadUpdateResult = {
  filePath: string;
  version: string;
};

function isPortableUpdateFile(fileName: string | undefined, version: string) {
  return new RegExp(`^tooldesk-Portable-${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-x64\\.exe$`, 'i').test(fileName ?? '');
}

async function resolveDownloadUrl(downloadUrl: string, fileName: string | undefined, version: string) {
  if (!isPortableUpdateFile(fileName, version) || !(await isServiceGatewayConfigured())) {
    return downloadUrl;
  }

  const result = await postServiceGateway<{ downloadUrl?: string }>(
    {
      action: 'update.portable-url',
      fileName,
      version
    },
    { timeoutMs: 15_000 }
  );

  return result.downloadUrl?.trim() || downloadUrl;
}

export async function checkForUpdates() {
  const result = await invoke<TauriUpdateCheckResult>('check_for_updates');

  if (result.success && result.hasUpdate && result.version && result.downloadUrl) {
    void downloadUpdate({
      downloadUrl: await resolveDownloadUrl(result.downloadUrl, result.fileName, result.version),
      fileName: result.fileName,
      sha512: result.sha512,
      version: result.version
    });
  }

  return result;
}

export function downloadUpdate(payload: {
  downloadUrl: string;
  fileName?: string;
  sha512?: string;
  version: string;
}) {
  return invoke<TauriDownloadUpdateResult>('download_update', { payload });
}

export function installDownloadedUpdate() {
  return invoke<void>('install_downloaded_update');
}
