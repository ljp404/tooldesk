import type {
  SuperClipboardEntryDetail,
  SuperClipboardEntryMeta,
  SuperClipboardQuery,
  SuperClipboardSettings,
  SuperClipboardStats
} from '../types/superClipboard';

export function isSuperClipboardSupported() {
  return Boolean(window.tooldeskShortcut?.querySuperClipboard);
}

export function getDefaultSuperClipboardSettings(): SuperClipboardSettings {
  return {
    enabled: true,
    ignoreDuplicates: true,
    maxImageBytes: 2 * 1024 * 1024,
    maxItems: 500,
    pollIntervalMs: 800
  };
}

export function querySuperClipboard(query: SuperClipboardQuery) {
  if (!window.tooldeskShortcut?.querySuperClipboard) {
    return Promise.reject(new Error('Super clipboard API is unavailable.'));
  }

  return window.tooldeskShortcut.querySuperClipboard(query).then((result) => ({
    items: result.items as SuperClipboardEntryMeta[],
    total: result.total
  }));
}

export function getSuperClipboardDetail(id: string) {
  if (!window.tooldeskShortcut?.getSuperClipboardDetail) {
    return Promise.reject(new Error('Super clipboard API is unavailable.'));
  }

  return window.tooldeskShortcut
    .getSuperClipboardDetail(id)
    .then((result) => result as SuperClipboardEntryDetail | null);
}

export function deleteSuperClipboardItem(id: string) {
  if (!window.tooldeskShortcut?.deleteSuperClipboardItem) {
    return Promise.reject(new Error('Super clipboard API is unavailable.'));
  }

  return window.tooldeskShortcut.deleteSuperClipboardItem(id);
}

export function clearSuperClipboard(category?: string) {
  if (!window.tooldeskShortcut?.clearSuperClipboard) {
    return Promise.reject(new Error('Super clipboard API is unavailable.'));
  }

  return window.tooldeskShortcut.clearSuperClipboard(category);
}

export function getSuperClipboardStats() {
  if (!window.tooldeskShortcut?.getSuperClipboardStats) {
    return Promise.reject(new Error('Super clipboard API is unavailable.'));
  }

  return window.tooldeskShortcut.getSuperClipboardStats() as Promise<SuperClipboardStats>;
}

export function copySuperClipboardItem(id: string) {
  if (!window.tooldeskShortcut?.copySuperClipboardItem) {
    return Promise.reject(new Error('Super clipboard API is unavailable.'));
  }

  return window.tooldeskShortcut.copySuperClipboardItem(id);
}

export function onSuperClipboardNewEntry(callback: (entry: SuperClipboardEntryMeta) => void) {
  if (!window.tooldeskShortcut?.onSuperClipboardNewEntry) {
    return () => undefined;
  }

  return window.tooldeskShortcut.onSuperClipboardNewEntry((entry) => callback(entry as SuperClipboardEntryMeta));
}

export function onSuperClipboardStatsChanged(callback: (stats: SuperClipboardStats) => void) {
  if (!window.tooldeskShortcut?.onSuperClipboardStatsChanged) {
    return () => undefined;
  }

  return window.tooldeskShortcut.onSuperClipboardStatsChanged(callback);
}
