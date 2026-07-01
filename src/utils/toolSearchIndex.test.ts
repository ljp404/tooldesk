import { describe, expect, it } from 'vitest';
import type { ToolItem } from '../types/toolbox';
import { filterToolsBySearchQuery } from './toolSearchIndex';

function tool(partial: Partial<ToolItem>): ToolItem {
  return {
    accent: 'blue',
    caption: '',
    category: 'dev',
    defaultAlias: partial.key ?? 'tool',
    icon: '',
    key: partial.key ?? 'tool',
    keywords: [],
    label: partial.key ?? 'tool',
    source: 'builtin',
    ...partial
  };
}

describe('filterToolsBySearchQuery', () => {
  it('ranks exact keyword matches ahead of weaker fuzzy matches', () => {
    const result = filterToolsBySearchQuery(
      [
        tool({
          category: 'text',
          defaultAlias: 'fy',
          key: 'translator',
          keywords: ['translate', 'translation'],
          label: '翻译'
        }),
        tool({
          defaultAlias: 'ds',
          key: 'plugin:tooldesk-cron-parser',
          keywords: ['cron', 'schedule'],
          label: 'Cron 解析'
        })
      ],
      'cron'
    );

    expect(result.map((item) => item.key)).toEqual(['plugin:tooldesk-cron-parser']);
  });

  it('keeps cron parser first when cron is an exact plugin keyword', () => {
    const result = filterToolsBySearchQuery(
      [
        tool({
          category: 'text',
          defaultAlias: 'fy',
          key: 'translator',
          keywords: ['translate', 'translation'],
          label: '翻译'
        }),
        tool({
          defaultAlias: 'ds',
          key: 'plugin:tooldesk-cron-parser',
          keywords: ['cron', 'schedule'],
          label: 'Cron 解析'
        })
      ],
      'cron'
    );

    expect(result[0]?.key).toBe('plugin:tooldesk-cron-parser');
  });
});
