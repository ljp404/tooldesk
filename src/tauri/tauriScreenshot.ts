import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { ScreenshotCaptureResult } from '../types/screenshot';
import { copyImage } from './tauriClipboard';

let lastScreenshot: ScreenshotCaptureResult | null = null;
const screenshotCapturedListeners = new Set<(result: ScreenshotCaptureResult | null) => void>();
let screenshotCapturedUnlisten: (() => void) | undefined;

export async function startScreenshot(): Promise<ScreenshotCaptureResult | null> {
  const waitForCapture = new Promise<ScreenshotCaptureResult | null>((resolve) => {
    const unsubscribe = onScreenshotCaptured((result) => {
      unsubscribe();
      resolve(result);
    });
  });

  await invoke<boolean>('open_screenshot_selection');
  return waitForCapture;
}

export function dismissStaleScreenshotOverlay(): Promise<null> {
  return invoke<null>('dismiss_stale_screenshot_overlay');
}

export async function getLastScreenshot(): Promise<ScreenshotCaptureResult | null> {
  if (lastScreenshot) {
    return lastScreenshot;
  }

  lastScreenshot = await invoke<ScreenshotCaptureResult | null>('get_last_screenshot');
  return lastScreenshot;
}

export async function copyLastScreenshot() {
  const screenshot = await getLastScreenshot();

  if (!screenshot?.dataUrl) {
    return false;
  }

  return copyImage(screenshot.dataUrl);
}

export function pinScreenshot(payload?: ScreenshotCaptureResult): Promise<boolean> {
  return invoke('pin_screenshot', { payload: payload ?? null, rect: null });
}

export function onScreenshotCaptured(callback: (result: ScreenshotCaptureResult | null) => void) {
  screenshotCapturedListeners.add(callback);

  if (!screenshotCapturedUnlisten) {
    void listen<ScreenshotCaptureResult | null>('screenshot:captured', (event) => {
      lastScreenshot = event.payload;
      screenshotCapturedListeners.forEach((listener) => listener(event.payload));
    }).then((value) => {
      screenshotCapturedUnlisten = value;
    });
  }

  return () => {
    screenshotCapturedListeners.delete(callback);

    if (screenshotCapturedListeners.size === 0) {
      screenshotCapturedUnlisten?.();
      screenshotCapturedUnlisten = undefined;
    }
  };
}
