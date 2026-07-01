import { invoke } from '@tauri-apps/api/core';
import { getAppSettings } from './tauriStorage';

const localLibraryListeners = new Set<() => void>();

export function onLocalLibraryChanged(callback: () => void) {
  localLibraryListeners.add(callback);
  return () => {
    localLibraryListeners.delete(callback);
  };
}

export function notifyLocalLibraryChanged() {
  for (const listener of localLibraryListeners) {
    listener();
  }
}

async function getLocalLibrarySettings() {
  return (await getAppSettings()).localLibrary;
}

function encodeObsidianParam(value: string) {
  return encodeURIComponent(value);
}

function normalizeVaultRelativePath(library: TooldeskLocalLibraryConfig, filePath: string) {
  const normalizedBase = library.path.replace(/\\/g, '/').replace(/\/+$/, '');
  const normalizedFile = filePath.replace(/\\/g, '/');

  if (!normalizedFile.toLowerCase().startsWith(`${normalizedBase.toLowerCase()}/`)) {
    throw new Error('文件不在库目录内');
  }

  const relative = normalizedFile.slice(normalizedBase.length + 1);
  return relative.toLowerCase().endsWith('.md') ? relative.slice(0, -3) : relative;
}

function buildObsidianVaultParams(library: TooldeskLocalLibraryConfig) {
  const params: string[] = [];

  if (library.vaultName?.trim()) {
    params.push(`vault=${encodeObsidianParam(library.vaultName.trim())}`);
  }

  return params;
}

function buildObsidianAdvUri(library: TooldeskLocalLibraryConfig, filePath: string, line?: number) {
  const params = [
    ...buildObsidianVaultParams(library),
    `filepath=${encodeObsidianParam(normalizeVaultRelativePath(library, filePath))}`,
    'viewmode=preview'
  ];

  if (line && line > 0) {
    params.push(`line=${line}`);
  }

  return `obsidian://adv-uri?${params.join('&')}`;
}

function buildObsidianOpenUri(library: TooldeskLocalLibraryConfig, filePath: string) {
  const params = [
    ...buildObsidianVaultParams(library),
    `file=${encodeObsidianParam(normalizeVaultRelativePath(library, filePath))}`
  ];

  return `obsidian://open?${params.join('&')}`;
}

async function tryOpenExternalUrl(
  openExternalUrl: (targetUrl: string) => Promise<boolean>,
  targetUrl: string
) {
  try {
    return await openExternalUrl(targetUrl);
  } catch {
    return false;
  }
}

async function openWithObsidianUri(
  openExternalUrl: (targetUrl: string) => Promise<boolean>,
  library: TooldeskLocalLibraryConfig,
  filePath: string,
  line?: number
) {
  const candidateUrls = [buildObsidianAdvUri(library, filePath, line), buildObsidianOpenUri(library, filePath)];

  for (const targetUrl of candidateUrls) {
    if (await tryOpenExternalUrl(openExternalUrl, targetUrl)) {
      return true;
    }
  }

  return false;
}

export async function getLocalLibraries(): Promise<TooldeskLocalLibraryConfig[]> {
  return invoke('get_local_libraries', {
    settings: await getLocalLibrarySettings()
  });
}

export async function searchLocalLibrary(
  libraryKeyword: string,
  searchKeyword: string
): Promise<TooldeskLocalLibrarySearchResult[]> {
  return invoke('search_local_library', {
    libraryKeyword,
    searchKeyword,
    settings: await getLocalLibrarySettings()
  });
}

export async function openLocalLibraryFile(
  openExternalUrl: (targetUrl: string) => Promise<boolean>,
  openPath: (targetPath: string) => Promise<string>,
  filePath: string,
  libraryKeyword: string,
  line?: number
) {
  const settings = await getLocalLibrarySettings();
  const library = settings.libraries.find((item) => item.keyword === libraryKeyword);

  if (!library) {
    throw new Error('库不存在');
  }

  if (library.openWith === 'obsidian') {
    try {
      if (await openWithObsidianUri(openExternalUrl, library, filePath, line)) {
        return;
      }
    } catch {
      // Fall back to the platform opener below.
    }
  }

  const fallbackPath = await invoke<string | null>('open_local_library_file', {
    filePath,
    libraryKeyword,
    line,
    settings
  });

  if (fallbackPath) {
    const error = await openPath(fallbackPath);

    if (error) {
      throw new Error(error);
    }
  }
}
