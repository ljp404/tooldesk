import type { ScreenRecordingSavePayload, ScreenRecordingSaveResult } from '../types/screenRecorder';

export function isScreenRecorderSupported() {
  return Boolean(
    navigator.mediaDevices &&
      typeof navigator.mediaDevices.getDisplayMedia === 'function' &&
      window.tooldeskShortcut?.saveScreenRecording
  );
}

export function saveScreenRecording(payload: ScreenRecordingSavePayload): Promise<ScreenRecordingSaveResult> {
  const save = window.tooldeskShortcut?.saveScreenRecording;

  if (!save) {
    return Promise.reject(new Error('录屏保存仅在桌面客户端可用'));
  }

  return save(payload);
}
