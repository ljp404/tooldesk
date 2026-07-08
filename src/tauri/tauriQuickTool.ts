import { invoke } from '@tauri-apps/api/core';

export async function getLastContent() {
  return invoke<import('../types/toolbox').ShortcutContentPayload | null>('get_last_content');
}

export async function openQuickToolWindow(kind: string, content?: string, forceNew?: boolean) {
  await invoke('open_quick_tool', {
    payload: {
      anchorRect: null,
      compact: false,
      content: content ?? '',
      forceNew: Boolean(forceNew),
      kind
    }
  });
}
