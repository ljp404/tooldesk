import { dirname, homeDir, join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener';
import type { ScreenshotCaptureResult } from '../types/screenshot';
import type { ScreenRecordingSavePayload, ScreenRecordingSaveResult } from '../types/screenRecorder';
import { showSaveDialog } from './tauriFile';
import { writeBinaryFile } from './tauriFile';

function pad(value: number) {
  return String(value).padStart(2, '0');
}

function timestamp() {
  const date = new Date();
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

function dataUrlToBytes(dataUrl: string) {
  const match = String(dataUrl).match(/^data:[^;]+;base64,(.+)$/i);

  if (!match) {
    throw new Error('截图数据格式无效');
  }

  const binary = window.atob(match[1]);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function arrayBufferToBytes(value: ArrayBuffer) {
  return new Uint8Array(value);
}

export async function saveScreenshotAs(payload?: ScreenshotCaptureResult): Promise<string | null> {
  if (!payload?.dataUrl) {
    return null;
  }

  const screenshotDir = await join(await homeDir(), 'Pictures', 'tooldesk-screenshots');
  const result = await showSaveDialog({
    defaultPath: await join(screenshotDir, `screenshot-${timestamp()}.png`),
    filters: [{ extensions: ['png'], name: 'PNG 图片' }]
  });

  if (result.canceled || !result.filePath) {
    return null;
  }

  return writeBinaryFile(result.filePath, dataUrlToBytes(payload.dataUrl));
}

export async function saveScreenRecording(payload: ScreenRecordingSavePayload): Promise<ScreenRecordingSaveResult> {
  const extension = payload.format;
  const filterName = payload.format === 'mp4' ? 'MP4 视频' : payload.format === 'gif' ? 'GIF 动图' : 'WebM 视频';
  const recordingDir = await join(await homeDir(), 'Videos', 'tooldesk-recordings');
  const result = await showSaveDialog({
    defaultPath: await join(recordingDir, `recording-${timestamp()}.${extension}`),
    filters: [{ extensions: [extension], name: filterName }]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  return invoke<ScreenRecordingSaveResult>('save_screen_recording', {
    payload: {
      ...payload,
      buffer: Array.from(arrayBufferToBytes(payload.buffer)),
      filePath: result.filePath
    }
  });
}

export async function showRegionRecordingPlayback(payload: {
  buffer: ArrayBuffer;
  cropRect: { height: number; width: number; x: number; y: number };
  durationMs?: number;
  sourceHeight: number;
  sourceWidth: number;
}) {
  return invoke<boolean>('open_region_recording_playback', {
    payload: {
      ...payload,
      buffer: Array.from(arrayBufferToBytes(payload.buffer))
    }
  });
}

export async function showInFolder(targetPath: string) {
  const normalizedPath = String(targetPath ?? '').trim();

  if (!normalizedPath) {
    return false;
  }

  try {
    await revealItemInDir(normalizedPath);
    return true;
  } catch {
    try {
      await openPath(await dirname(normalizedPath));
      return true;
    } catch {
      return false;
    }
  }
}

export async function openScreenshotSaveDir() {
  const directory = await join(await homeDir(), 'Pictures', 'tooldesk-screenshots');

  try {
    await openPath(directory);
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : '打开截图目录失败';
  }
}
