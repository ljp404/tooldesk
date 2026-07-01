export type SuperClipboardContentType = 'html' | 'image' | 'text';

export type SuperClipboardCategory = 'code' | 'html' | 'image' | 'json' | 'link' | 'path' | 'text';

export type SuperClipboardCategoryFilter = 'all' | SuperClipboardCategory;

export interface SuperClipboardSettings {
  enabled: boolean;
  ignoreDuplicates: boolean;
  maxImageBytes: number;
  maxItems: number;
  pollIntervalMs: number;
}

export const DEFAULT_SUPER_CLIPBOARD_SETTINGS: SuperClipboardSettings = {
  enabled: true,
  ignoreDuplicates: true,
  maxImageBytes: 2 * 1024 * 1024,
  maxItems: 500,
  pollIntervalMs: 800
};

export interface SuperClipboardEntryMeta {
  category: SuperClipboardCategory;
  charCount: number;
  contentHash: string;
  createdAt: number;
  id: string;
  preview: string;
  thumbnailDataUrl?: string;
  type: SuperClipboardContentType;
}

export interface SuperClipboardEntryDetail extends SuperClipboardEntryMeta {
  html?: string;
  imagePreviewDataUrl?: string;
  text?: string;
}

export interface SuperClipboardQuery {
  category?: SuperClipboardCategoryFilter;
  limit?: number;
  offset?: number;
  search?: string;
}

export interface SuperClipboardQueryResult {
  items: SuperClipboardEntryMeta[];
  total: number;
}

export interface SuperClipboardStats {
  byCategory: Record<SuperClipboardCategory, number>;
  enabled: boolean;
  storageBytes: number;
  total: number;
}

export interface SuperClipboardPayload {
  html?: string;
  imagePng?: Buffer;
  text?: string;
  type: SuperClipboardContentType;
}
