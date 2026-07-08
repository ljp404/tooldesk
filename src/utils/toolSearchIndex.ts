import { getCategoryLabel } from '../tools/types';
import type { ToolAliasSettings, ToolItem } from '../types/toolbox';

export function getDefaultToolAliasSettings(): ToolAliasSettings {
  return { aliasesByTool: {} };
}

export function normalizeToolAlias(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeToolAliases(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }

  const seen = new Set<string>();
  const aliases: string[] = [];

  for (const value of values) {
    const alias = normalizeToolAlias(String(value ?? ''));

    if (!alias || seen.has(alias)) {
      continue;
    }

    seen.add(alias);
    aliases.push(alias);
  }

  return aliases;
}

export function normalizeToolAliasSettings(settings?: Partial<ToolAliasSettings> | null): ToolAliasSettings {
  const aliasesByTool: Record<string, string[]> = {};
  const raw = settings?.aliasesByTool;

  if (raw && typeof raw === 'object') {
    for (const [toolKey, aliases] of Object.entries(raw)) {
      const normalized = normalizeToolAliases(aliases);

      if (normalized.length > 0) {
        aliasesByTool[toolKey] = normalized;
      }
    }
  }

  return { aliasesByTool };
}

export function getToolUserAliases(tool: ToolItem, settings?: ToolAliasSettings | null) {
  return settings?.aliasesByTool?.[tool.key] ?? [];
}

export function getToolSearchTokens(tool: ToolItem, settings?: ToolAliasSettings | null) {
  return [
    tool.defaultAlias,
    ...getToolUserAliases(tool, settings),
    tool.label,
    tool.caption,
    tool.category,
    getCategoryLabel(tool.category),
    ...tool.keywords
  ].filter((value): value is string => Boolean(value?.trim()));
}

function scoreToken(token: string, query: string, baseScore: number) {
  const normalized = token.toLowerCase();

  if (normalized === query) {
    return baseScore + 300;
  }

  if (normalized.startsWith(query)) {
    return baseScore + 120;
  }

  if (normalized.includes(query)) {
    return baseScore + 20;
  }

  return 0;
}

export function scoreToolSearchMatch(tool: ToolItem, query: string, settings?: ToolAliasSettings | null) {
  const normalizedQuery = normalizeToolAlias(query);

  if (!normalizedQuery) {
    return 1;
  }

  let score = 0;
  const defaultAlias = tool.defaultAlias ?? tool.key;
  const userAliases = getToolUserAliases(tool, settings);

  for (const alias of userAliases) {
    score = Math.max(score, scoreToken(alias, normalizedQuery, 500));
  }

  score = Math.max(score, scoreToken(defaultAlias, normalizedQuery, 400));
  score = Math.max(score, scoreToken(tool.label, normalizedQuery, 300));

  for (const keyword of tool.keywords) {
    score = Math.max(score, scoreToken(keyword, normalizedQuery, 200));
  }

  score = Math.max(score, scoreToken(tool.caption, normalizedQuery, 100));
  score = Math.max(score, scoreToken(tool.category, normalizedQuery, 80));
  score = Math.max(score, scoreToken(getCategoryLabel(tool.category), normalizedQuery, 80));

  return score;
}

export function filterToolsBySearchQuery(
  tools: ToolItem[],
  query: string,
  settings?: ToolAliasSettings | null
) {
  const normalizedQuery = normalizeToolAlias(query);

  if (!normalizedQuery) {
    return [...tools];
  }

  return tools
    .map((tool, index) => ({
      index,
      score: scoreToolSearchMatch(tool, normalizedQuery, settings),
      tool
    }))
    .filter((item) => item.score > 0)
    .sort((current, next) => next.score - current.score || current.index - next.index)
    .map((item) => item.tool);
}
