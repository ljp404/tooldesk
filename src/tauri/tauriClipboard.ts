import {
  readText as readTauriText,
  writeHtml as writeTauriHtml,
  writeImage as writeTauriImage,
  writeText as writeTauriText
} from '@tauri-apps/plugin-clipboard-manager';

function dataUrlToBytes(dataUrl: string) {
  const [, base64 = ''] = String(dataUrl).split(',', 2);
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

export async function copyImage(dataUrl: string) {
  try {
    await writeTauriImage(dataUrlToBytes(dataUrl));
    return true;
  } catch (error) {
    console.warn('[tauri] Failed to copy image.', error);
    return false;
  }
}

export async function copyText(text: string) {
  await writeTauriText(text);
  return true;
}

export async function copyHtml(html: string, altText?: string) {
  await writeTauriHtml(html, altText);
  return true;
}

export async function readText() {
  try {
    return await readTauriText();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');

    if (!/clipboard.*(empty|format)|requested format|not available/i.test(message)) {
      console.warn('[tauri] Failed to read clipboard text.', error);
    }

    return '';
  }
}
