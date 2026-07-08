export type ScreenRecordingFormat = 'gif' | 'mp4' | 'webm';

export interface ScreenRecordingCropRect {
  displayHeight?: number;
  displayWidth?: number;
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface ScreenRecordingSavePayload {
  buffer: ArrayBuffer;
  cropRect?: ScreenRecordingCropRect;
  durationMs: number;
  format: ScreenRecordingFormat;
}

export interface ScreenRecordingSaveResult {
  canceled: boolean;
  filePath?: string;
}
