import type { Component } from 'vue';
import type { CategoryItem, CategoryKey, ToolItem } from '../types/toolbox';

export interface ToolShortcutConfig {
  accepts: (content: string) => boolean;
}

export interface ToolDefinition extends ToolItem {
  component: Component;
  defaultAlias?: string;
  order?: number;
  shortcut?: ToolShortcutConfig;
}

export interface ToolViewRegistration {
  acceptsShortcutContent: boolean;
  component: Component;
}

export type ToolModule = ToolDefinition | { default: ToolDefinition };

export const categories: CategoryItem[] = [
  { key: 'all', label: '全部工具', icon: 'all' },
  { key: 'text', label: '文本工具', icon: 'text' },
  { key: 'dev', label: '开发工具', icon: 'code' },
  { key: 'image', label: '图片工具', icon: 'image' },
  { key: 'document', label: '文档工具', icon: 'document' },
  { key: 'finance', label: '财务工具', icon: 'calculator' },
  { key: 'life', label: '日常工具', icon: 'calendar' }
];

export function defineTool<T extends ToolDefinition>(definition: T) {
  return definition;
}

export function getCategoryLabel(category: Exclude<CategoryKey, 'all'>) {
  return categories.find((item) => item.key === category)?.label ?? '工具';
}
