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

export const SUPER_CLIPBOARD_CATEGORIES: Array<{ key: SuperClipboardCategoryFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'text', label: '文本' },
  { key: 'link', label: '链接' },
  { key: 'json', label: 'JSON' },
  { key: 'code', label: '代码' },
  { key: 'path', label: '路径' },
  { key: 'html', label: 'HTML' },
  { key: 'image', label: '图片' }
];

export const CATEGORY_LABELS: Record<SuperClipboardCategory, string> = {
  code: '代码',
  html: 'HTML',
  image: '图片',
  json: 'JSON',
  link: '链接',
  path: '路径',
  text: '文本'
};
