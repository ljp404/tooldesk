import { invoke } from '@tauri-apps/api/core';
import { readImage } from '@tauri-apps/plugin-clipboard-manager';
import { copyHtml, copyImage, readText, copyText } from './tauriClipboard';
import type {
  SuperClipboardEntryDetail,
  SuperClipboardEntryMeta,
  SuperClipboardQuery,
  SuperClipboardQueryResult,
  SuperClipboardSettings,
  SuperClipboardStats
} from '../types/superClipboard';
import { getDefaultSuperClipboardSettings } from '../utils/superClipboardClient';

type EntryListener = (entry: SuperClipboardEntryMeta) => void;
type StatsListener = (stats: SuperClipboardStats) => void;

const newEntryListeners = new Set<EntryListener>();
const statsListeners = new Set<StatsListener>();

let currentSettings = getDefaultSuperClipboardSettings();
let pollTimer: number | undefined;
let lastFingerprint = '';
let ignoreHash = '';
let ignoreUntil = 0;
let captureInFlight = false;

type SuperClipboardNativePayload = {
  html?: string;
  imagePng?: string;
  text?: string;
  type: 'html' | 'image' | 'text';
};

function hashText(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return `${hash >>> 0}:${value.length}`;
}

function dataUrlToBase64(dataUrl: string) {
  return String(dataUrl).split(',', 2)[1] ?? '';
}

function hashImage(base64: string, text: string) {
  return hashText(`image:${base64.slice(0, 2000)}:${text}`);
}

async function readClipboardImageAsPngDataUrl() {
  try {
    const image = await readImage();
    const size = await image.size();

    if (size.width <= 0 || size.height <= 0) {
      return '';
    }

    const rgba = await image.rgba();

    if (!rgba.length) {
      return '';
    }

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');

    if (!context) {
      return '';
    }

    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), size.width, size.height), 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return '';
  }
}

function normalizeSettings(settings?: Partial<SuperClipboardSettings>) {
  currentSettings = {
    ...getDefaultSuperClipboardSettings(),
    ...currentSettings,
    ...(settings ?? {})
  };
}

function emitEntry(entry: SuperClipboardEntryMeta) {
  for (const listener of newEntryListeners) {
    listener(entry);
  }
}

function emitStats(stats: SuperClipboardStats) {
  for (const listener of statsListeners) {
    listener(stats);
  }
}

async function refreshStats() {
  const stats = await getSuperClipboardStats(currentSettings.enabled);
  emitStats(stats);
  return stats;
}

async function captureCurrentClipboard() {
  if (!currentSettings.enabled) {
    return;
  }

  if (captureInFlight) {
    return;
  }

  captureInFlight = true;

  try {
    const text = await readText().catch(() => '');
    const html = await invoke<string | null>('read_clipboard_html').catch(() => null);
    const trimmed = text.trim();

    if (!trimmed) {
      const imageDataUrl = await readClipboardImageAsPngDataUrl();

      if (!imageDataUrl) {
        lastFingerprint = '';
        return;
      }

      const imageBase64 = dataUrlToBase64(imageDataUrl);
      const imageBytes = Math.floor((imageBase64.length * 3) / 4);

      if (!imageBase64 || imageBytes > currentSettings.maxImageBytes) {
        lastFingerprint = '';
        return;
      }

      const fingerprint = hashImage(imageBase64, '');

      if (fingerprint === lastFingerprint) {
        return;
      }

      lastFingerprint = fingerprint;

      if (Date.now() < ignoreUntil && fingerprint === ignoreHash) {
        return;
      }

      const entry = await invoke<SuperClipboardEntryMeta | null>('capture_super_clipboard', {
        payload: { imagePng: imageBase64, text: '', type: 'image' },
        settings: currentSettings
      });

      if (!entry) {
        return;
      }

      emitEntry(entry);
      await refreshStats();
      return;
    }

    const htmlValue = html?.trim() ?? '';
    const fingerprint = htmlValue ? hashText(`html:${trimmed}:${htmlValue}`) : hashText(trimmed);

    if (fingerprint === lastFingerprint) {
      return;
    }

    lastFingerprint = fingerprint;

    if (Date.now() < ignoreUntil && fingerprint === ignoreHash) {
      return;
    }

    const entry = await invoke<SuperClipboardEntryMeta | null>('capture_super_clipboard', {
      payload: { html: htmlValue, text, type: htmlValue ? 'html' : 'text' },
      settings: currentSettings
    });

    if (!entry) {
      return;
    }

    emitEntry(entry);
    await refreshStats();
  } finally {
    captureInFlight = false;
  }
}

function stopWatcher() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

function startWatcher() {
  stopWatcher();

  if (!currentSettings.enabled) {
    void refreshStats();
    return;
  }

  void captureCurrentClipboard();
  pollTimer = window.setInterval(
    () => void captureCurrentClipboard(),
    Math.max(400, currentSettings.pollIntervalMs)
  );
}

export function syncSuperClipboardSettings(settings?: Partial<SuperClipboardSettings>) {
  const previousInterval = currentSettings.pollIntervalMs;
  const previousEnabled = currentSettings.enabled;
  normalizeSettings(settings);

  if (previousEnabled !== currentSettings.enabled || previousInterval !== currentSettings.pollIntervalMs) {
    startWatcher();
    return;
  }

  void refreshStats();
}

export function startSuperClipboardWatcher(settings?: Partial<SuperClipboardSettings>) {
  normalizeSettings(settings);
  startWatcher();
}

export function querySuperClipboard(query: SuperClipboardQuery) {
  return invoke<SuperClipboardQueryResult>('query_super_clipboard', { query });
}

export function getSuperClipboardDetail(id: string) {
  return invoke<SuperClipboardEntryDetail | null>('get_super_clipboard_detail', { id });
}

export async function deleteSuperClipboardItem(id: string) {
  const deleted = await invoke<boolean>('delete_super_clipboard_item', { id });

  if (deleted) {
    await refreshStats();
  }

  return deleted;
}

export async function clearSuperClipboard(category?: string) {
  const count = await invoke<number>('clear_super_clipboard', { category });
  await refreshStats();
  return count;
}

export function getSuperClipboardStats(enabled = currentSettings.enabled) {
  return invoke<SuperClipboardStats>('get_super_clipboard_stats', { enabled });
}

export async function copySuperClipboardItem(id: string) {
  const payload = await invoke<SuperClipboardNativePayload | null>('get_super_clipboard_payload', { id });

  if (!payload) {
    return false;
  }

  if (payload.type === 'image' && payload.imagePng) {
    await copyImage(`data:image/png;base64,${payload.imagePng}`);
    ignoreHash = hashImage(payload.imagePng, payload.text?.trim() ?? '');
    ignoreUntil = Date.now() + 2500;
    return true;
  }

  if (payload.type === 'html' && payload.html) {
    await copyHtml(payload.html, payload.text || undefined);
    ignoreHash = hashText(`html:${payload.text?.trim() ?? ''}:${payload.html.trim()}`);
    ignoreUntil = Date.now() + 2500;
    return true;
  }

  const text = payload.text || payload.html || '';

  if (!text) {
    return false;
  }

  await copyText(text);
  ignoreHash = hashText(text.trim());
  ignoreUntil = Date.now() + 2500;
  return true;
}

export function onSuperClipboardNewEntry(callback: EntryListener) {
  newEntryListeners.add(callback);
  return () => {
    newEntryListeners.delete(callback);
  };
}

export function onSuperClipboardStatsChanged(callback: StatsListener) {
  statsListeners.add(callback);
  return () => {
    statsListeners.delete(callback);
  };
}
