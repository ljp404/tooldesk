import type { ScreenshotCaptureResult, ScreenshotSettings } from '../types/screenshot';

export function isScreenshotSupported() {
  return Boolean(window.tooldeskShortcut?.startScreenshot);
}

export function isScrollScreenshotSupported() {
  return Boolean(window.tooldeskShortcut?.startScrollScreenshot);
}

export function startScreenshot() {
  if (!window.tooldeskShortcut?.startScreenshot) {
    return Promise.reject(new Error('截图 API 不可用'));
  }

  return window.tooldeskShortcut.startScreenshot();
}

export function startScrollScreenshot() {
  if (!window.tooldeskShortcut?.startScrollScreenshot) {
    return Promise.reject(new Error('滚动截图 API 不可用'));
  }

  return window.tooldeskShortcut.startScrollScreenshot();
}

export function getLastScreenshot() {
  if (!window.tooldeskShortcut?.getLastScreenshot) {
    return Promise.reject(new Error('截图 API 不可用'));
  }

  return window.tooldeskShortcut.getLastScreenshot();
}

export function copyLastScreenshot() {
  if (!window.tooldeskShortcut?.copyLastScreenshot) {
    return Promise.reject(new Error('截图 API 不可用'));
  }

  return window.tooldeskShortcut.copyLastScreenshot();
}

export function openScreenshotSaveDir() {
  if (!window.tooldeskShortcut?.openScreenshotSaveDir) {
    return Promise.reject(new Error('截图 API 不可用'));
  }

  return window.tooldeskShortcut.openScreenshotSaveDir();
}

export function saveScreenshotAs(payload?: ScreenshotCaptureResult) {
  if (!window.tooldeskShortcut?.saveScreenshotAs) {
    return Promise.reject(new Error('截图 API 不可用'));
  }

  return window.tooldeskShortcut.saveScreenshotAs(payload);
}

export function pinScreenshot(payload?: ScreenshotCaptureResult) {
  if (!window.tooldeskShortcut?.pinScreenshot) {
    return Promise.reject(new Error('截图 API 不可用'));
  }

  return window.tooldeskShortcut.pinScreenshot(payload);
}

export function onScreenshotCaptured(callback: (result: ScreenshotCaptureResult | null) => void) {
  return window.tooldeskShortcut?.onScreenshotCaptured(callback) ?? (() => undefined);
}

export function getDefaultScreenshotSettings(): ScreenshotSettings {
  return {
    autoCopy: true,
    enabled: true,
    ocrEnabled: true,
    saveToFile: true
  };
}

export async function recognizeScreenshotText(options: import('../types/screenshot').ScreenshotOcrOptions) {
  const recognize = window.tooldeskShortcut?.recognizeScreenshotText;

  if (!recognize) {
    throw new Error('OCR 仅在桌面客户端可用');
  }

  return recognize({
    imageBase64: options.imageBase64,
    imagePath: options.imagePath
  });
}
