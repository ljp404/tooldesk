import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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
type CaptureTrigger = 'event' | 'fallback' | 'initial' | 'manual';

const newEntryListeners = new Set<EntryListener>();
const statsListeners = new Set<StatsListener>();

let currentSettings = getDefaultSuperClipboardSettings();
let clipboardChangedUnlisten: (() => void) | undefined;
let lastFingerprint = '';
let lastClipboardSequence = -1;
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
      return { dataUrl: '', size: null };
    }

    const rgba = await image.rgba();

    if (!rgba.length) {
      return { dataUrl: '', size: null };
    }

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');

    if (!context) {
      return { dataUrl: '', size: null };
    }

    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), size.width, size.height), 0, 0);
    const dataUrl = canvas.toDataURL('image/png');

    return {
      dataUrl,
      size: { height: size.height, width: size.width }
    };
  } catch {
    return { dataUrl: '', size: null };
  }
}

async function getClipboardChangeCount() {
  try {
    return await invoke<number>('get_clipboard_change_count');
  } catch {
    return null;
  }
}

function rememberClipboardPollState(changeCount: number | null, fingerprint: string) {
  if (changeCount !== null) {
    lastClipboardSequence = changeCount;
  }

  lastFingerprint = fingerprint;
}

async function storeClipboardImageEntry(imageBase64: string, changeCount: number | null) {
  const fingerprint = hashImage(imageBase64, '');

  if (
    changeCount !== null &&
    changeCount === lastClipboardSequence &&
    fingerprint === lastFingerprint &&
    lastClipboardSequence !== -1
  ) {
    return;
  }

  if (fingerprint === lastFingerprint) {
    rememberClipboardPollState(changeCount, fingerprint);
    return;
  }

  if (Date.now() < ignoreUntil && fingerprint === ignoreHash) {
    rememberClipboardPollState(changeCount, fingerprint);
    return;
  }

  const imageBytes = Math.floor((imageBase64.length * 3) / 4);

  if (!imageBase64 || imageBytes > currentSettings.maxImageBytes) {
    rememberClipboardPollState(changeCount, '');
    return;
  }

  const entry = await invoke<SuperClipboardEntryMeta | null>('capture_super_clipboard', {
    payload: { imagePng: imageBase64, text: '', type: 'image' },
    settings: currentSettings
  });

  rememberClipboardPollState(changeCount, fingerprint);

  if (!entry) {
    return;
  }

  emitEntry(entry);
  await refreshStats();
}

export function captureScreenshotImageToSuperClipboard(dataUrl: string) {
  void (async () => {
    if (!currentSettings.enabled || captureInFlight) {
      return;
    }

    const imageBase64 = dataUrlToBase64(dataUrl);

    if (!imageBase64) {
      return;
    }

    captureInFlight = true;

    try {
      const changeCount = await getClipboardChangeCount();
      await storeClipboardImageEntry(imageBase64, changeCount);
    } finally {
      captureInFlight = false;
    }
  })();
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

async function captureCurrentClipboard(
  changeCountOverride?: number | null,
  trigger: CaptureTrigger = 'manual'
) {
  if (!currentSettings.enabled) {
    return;
  }

  if (captureInFlight) {
    return;
  }

  captureInFlight = true;

  try {
    const changeCount =
      changeCountOverride === undefined ? await getClipboardChangeCount() : changeCountOverride;

    if (
      changeCount !== null &&
      changeCount === lastClipboardSequence &&
      lastFingerprint &&
      lastClipboardSequence !== -1
    ) {
      return;
    }

    if (trigger === 'fallback') {
      return;
    }

    const text = await readText().catch(() => '');
    const html = await invoke<string | null>('read_clipboard_html').catch(() => null);
    const trimmed = text.trim();

    if (!trimmed) {
      const { dataUrl: imageDataUrl, size: imageSize } = await readClipboardImageAsPngDataUrl();

      if (!imageDataUrl || !imageSize) {
        rememberClipboardPollState(changeCount, '');
        return;
      }

      const imageBase64 = dataUrlToBase64(imageDataUrl);
      await storeClipboardImageEntry(imageBase64, changeCount);
      return;
    }

    const htmlValue = html?.trim() ?? '';
    const fingerprint = htmlValue ? hashText(`html:${trimmed}:${htmlValue}`) : hashText(trimmed);

    if (fingerprint === lastFingerprint) {
      rememberClipboardPollState(changeCount, fingerprint);
      return;
    }

    if (Date.now() < ignoreUntil && fingerprint === ignoreHash) {
      rememberClipboardPollState(changeCount, fingerprint);
      return;
    }

    const entry = await invoke<SuperClipboardEntryMeta | null>('capture_super_clipboard', {
      payload: { html: htmlValue, text, type: htmlValue ? 'html' : 'text' },
      settings: currentSettings
    });

    rememberClipboardPollState(changeCount, fingerprint);

    if (!entry) {
      return;
    }

    emitEntry(entry);
    await refreshStats();
  } finally {
    captureInFlight = false;
  }
}

async function stopClipboardChangedListener() {
  if (clipboardChangedUnlisten) {
    clipboardChangedUnlisten();
    clipboardChangedUnlisten = undefined;
  }
}

function stopWatcher() {
  void stopClipboardChangedListener();
}

async function syncClipboardWatcherInterval() {
  await invoke<boolean>('configure_super_clipboard_watcher', {
    pollIntervalMs: Math.max(400, currentSettings.pollIntervalMs)
  }).catch(() => false);
}

async function ensureClipboardChangedListener() {
  if (clipboardChangedUnlisten) {
    return;
  }

  clipboardChangedUnlisten = await listen<{ sequence?: number }>(
    'super-clipboard:clipboard-changed',
    (event) => {
      const sequence = event.payload?.sequence;
      void captureCurrentClipboard(typeof sequence === 'number' ? sequence : null, 'event');
    }
  );
}

async function startWatcher() {
  stopWatcher();

  if (!currentSettings.enabled) {
    void refreshStats();
    return;
  }

  await syncClipboardWatcherInterval();
  await ensureClipboardChangedListener();

  void captureCurrentClipboard(undefined, 'initial');
}

export function syncSuperClipboardSettings(settings?: Partial<SuperClipboardSettings>) {
  const previousInterval = currentSettings.pollIntervalMs;
  const previousEnabled = currentSettings.enabled;
  normalizeSettings(settings);

  if (previousEnabled !== currentSettings.enabled || previousInterval !== currentSettings.pollIntervalMs) {
    void startWatcher();
    return;
  }

  void refreshStats();
}

export function startSuperClipboardWatcher(settings?: Partial<SuperClipboardSettings>) {
  normalizeSettings(settings);
  void startWatcher();
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
