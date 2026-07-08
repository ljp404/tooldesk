export interface ScreenshotCaptureResult {
  capturedAt: number;
  canceled?: boolean;
  dataUrl: string;
  filePath?: string;
  height: number;
  width: number;
}

export interface ScreenshotSettings {
  autoCopy: boolean;
  enabled: boolean;
  ocrEnabled: boolean;
  saveToFile: boolean;
}

export interface ScreenshotOcrWord {
  height: number;
  text: string;
  width: number;
  x: number;
  y: number;
}

export interface ScreenshotOcrOptions {
  imageBase64?: string;
  imagePath?: string;
  language?: 'auto' | 'en' | 'zh';
}

export interface ScreenshotOcrResult {
  imageHeight: number;
  imageWidth: number;
  lines: string[];
  rawText: string;
  words: ScreenshotOcrWord[];
}
