import type { ClipboardMatchConfig } from '../shared/plugin/clipboardMatch.js';

export type ThemeMode = 'dark' | 'light';

export type MainView = 'all' | 'recent' | 'favorites' | 'extensions';

export type CategoryKey = 'all' | 'text' | 'dev' | 'image' | 'finance' | 'life' | 'document';

export type ToolKey = string;

export interface CategoryItem {
  key: CategoryKey;
  label: string;
  icon: string;
}

export interface ToolItem {
  capabilities?: string[];
  key: ToolKey;
  category: Exclude<CategoryKey, 'all'>;
  label: string;
  caption: string;
  icon: string;
  accent: string;
  clipboardMatch?: ClipboardMatchConfig[];
  defaultAlias?: string;
  entryUrl?: string;
  installPath?: string;
  keywords: string[];
  manifestVersion?: string;
  minHostVersion?: string;
  permissions?: string[];
  pluginId?: string;
  sdkVersion?: string;
  settings?: PluginSettingsItem;
  shortcut?: {
    accepts: (content: string) => boolean;
  };
  source?: 'builtin' | 'plugin' | 'system';
  sync?: PluginSyncItem;
  windowIcon?: string;
}

export interface PluginSettingsItem {
  accent: string;
  entryUrl: string;
  icon: string;
  label: string;
}

export interface PluginSyncItem {
  localStorageKeys: string[];
}

export interface ToolGroup {
  category: CategoryItem;
  tools: ToolItem[];
}

export interface HiddenChar {
  index: number;
  codePoint: string;
  name: string;
  preview: string;
}

export interface DiffLine {
  type: 'same' | 'add' | 'remove';
  text: string;
  line: number;
}

export type ShortcutContentKind = ToolKey;

export interface ShortcutContentPayload {
  content: string;
  kind: ShortcutContentKind;
  triggeredAt: number;
}

export interface ToolAliasSettings {
  aliasesByTool: Record<ToolKey, string[]>;
}

export interface ExtensionSettings {
  disabledToolKeys: ToolKey[];
}

export interface ExtensionMarketItem {
  accent: string;
  capabilities?: string[];
  caption: string;
  category: Exclude<CategoryKey, 'all'>;
  defaultAlias: string;
  downloadUrl: string;
  icon: string;
  keywords: string[];
  label: string;
  manifestUrl?: string;
  permissions: string[];
  pluginId: string;
  publisher: string;
  sha256: string;
  signature?: string;
  signatureUrl?: string;
  trusted: boolean;
  trustLevel: 'community' | 'official' | 'verified';
  updatedAt: string;
  version: string;
  windowIcon?: string;
}
