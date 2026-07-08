import { invoke } from '@tauri-apps/api/core';

export function listBrowserBookmarks(): Promise<TooldeskBrowserBookmarksResult> {
  return invoke('list_browser_bookmarks');
}
