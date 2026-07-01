import { invoke } from '@tauri-apps/api/core';
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog';

type OpenDialogResult = {
  canceled: boolean;
  filePaths: string[];
};

type TextExportResult = {
  exportId: string;
  filePath: string;
};

type TextExportPathResult = {
  filePath: string;
};

function normalizeDialogSelection(selection: string | string[] | null): OpenDialogResult {
  if (selection === null) {
    return { canceled: true, filePaths: [] };
  }

  return {
    canceled: false,
    filePaths: Array.isArray(selection) ? selection : [selection]
  };
}

function normalizeOpenDialogOptions(options: Record<string, unknown>): Record<string, unknown> {
  const properties = Array.isArray(options.properties) ? options.properties : [];

  if (properties.length === 0) {
    return options;
  }

  const nextOptions = { ...options };
  delete nextOptions.properties;

  if (properties.includes('openDirectory')) {
    nextOptions.directory = true;
  }

  if (properties.includes('multiSelections')) {
    nextOptions.multiple = true;
  }

  return nextOptions;
}

export async function showOpenDialog(options: Record<string, unknown> = {}): Promise<OpenDialogResult> {
  const selection = await openDialog(normalizeOpenDialogOptions(options));
  return normalizeDialogSelection(selection);
}

export async function showSaveDialog(options: Record<string, unknown> = {}): Promise<{ canceled: boolean; filePath?: string }> {
  const filePath = await saveDialog(options);

  if (!filePath) {
    return { canceled: true };
  }

  return { canceled: false, filePath };
}

export function readTextFile(filePath: string): Promise<string> {
  return invoke<string>('read_text_file', { filePath });
}

export function readBinaryFile(filePath: string): Promise<Uint8Array> {
  return invoke<number[]>('read_binary_file', { filePath }).then((bytes) => new Uint8Array(bytes));
}

export function writeBinaryFile(filePath: string, content: Uint8Array): Promise<string> {
  return invoke<string>('write_binary_file', { content: Array.from(content), filePath });
}

export function writeTextFile(filePath: string, content: string): Promise<string> {
  return invoke<string>('write_text_file', { content, filePath });
}

export function removeFile(filePath: string): Promise<boolean> {
  return invoke<boolean>('remove_file', { filePath });
}

export function createTextExport(suggestedName?: string): Promise<TextExportResult> {
  return invoke<TextExportResult>('create_text_export', { suggestedName });
}

export function appendTextExport(exportId: string, chunk: string): Promise<TextExportPathResult> {
  return invoke<TextExportPathResult>('append_text_export', { chunk, exportId });
}

export async function finishTextExport(
  openPath: (targetPath: string) => Promise<string>,
  exportId: string,
  openFile = true
): Promise<TextExportPathResult> {
  const result = await invoke<TextExportPathResult>('finish_text_export', { exportId });

  if (openFile) {
    const error = await openPath(result.filePath);

    if (error) {
      throw new Error(error);
    }
  }

  return result;
}

export async function openHostsFolder(openPath: (targetPath: string) => Promise<string>) {
  const folder = await invoke<string>('get_hosts_folder');
  const error = await openPath(folder);

  if (error) {
    throw new Error(error);
  }

  return folder;
}

export function readHostsFile(): Promise<{ content: string; path: string }> {
  return invoke('read_hosts_file');
}

export function writeHostsFile(content: string): Promise<{ path: string; savedAt: string }> {
  return invoke('write_hosts_file', { content });
}

export function updateHostsEntry(payload: { domain?: string; ip?: string }): Promise<{
  backupPath: string;
  domain: string;
  ip: string;
  path: string;
  savedAt: string;
  updated: boolean;
}> {
  return invoke('update_hosts_entry', {
    domain: payload.domain ?? '',
    ip: payload.ip ?? ''
  });
}
