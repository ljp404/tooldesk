import type { ToolItem, ToolKey } from '../types/toolbox';
import { categories, getCategoryLabel, type ToolDefinition, type ToolModule, type ToolViewRegistration } from './types';

function normalizeToolModule(module: ToolModule) {
  return 'default' in module ? module.default : module;
}

const modules = import.meta.glob<ToolModule>('./*/index.ts', {
  eager: true,
  import: 'default'
});

export const toolDefinitions = Object.values(modules)
  .map(normalizeToolModule)
  .sort((current, next) => (current.order ?? 0) - (next.order ?? 0));

export const tools: ToolItem[] = toolDefinitions.map((tool) => ({
  accent: tool.accent,
  caption: tool.caption,
  category: tool.category,
  defaultAlias: tool.defaultAlias ?? tool.key,
  icon: tool.icon,
  key: tool.key,
  keywords: tool.keywords,
  label: tool.label,
  shortcut: tool.shortcut,
  source: tool.source ?? 'builtin',
  windowIcon: tool.windowIcon
}));

export const toolViewRegistry = toolDefinitions.reduce(
  (registry, tool) => {
    registry[tool.key] = {
      acceptsShortcutContent: Boolean(tool.shortcut),
      component: tool.component
    };

    return registry;
  },
  {} as Record<ToolKey, ToolViewRegistration>
);

export const quickTools: ToolDefinition[] = toolDefinitions.filter((tool) => Boolean(tool.shortcut));

export { categories, getCategoryLabel };
export type { ToolDefinition, ToolViewRegistration };
