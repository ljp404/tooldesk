import { describe, expect, it } from 'vitest';
import { resolveTranslateDirection, splitTranslateText } from './translateClient';

describe('splitTranslateText', () => {
  it('returns single chunk for short text', () => {
    expect(splitTranslateText('hello')).toEqual(['hello']);
  });

  it('splits long text by newline when possible', () => {
    const line = 'a'.repeat(300);
    const text = `${line}\n${line}`;

    expect(splitTranslateText(text)).toEqual([`${line}\n`, line]);
  });
});

describe('resolveTranslateDirection', () => {
  it('keeps latin text targeting Chinese', () => {
    expect(resolveTranslateDirection({ from: 'auto', text: 'hello', to: 'zh-CN' })).toEqual({
      from: 'auto',
      to: 'zh-CN'
    });
  });

  it('routes Chinese-only text to English', () => {
    expect(resolveTranslateDirection({ from: 'auto', text: '你好', to: 'zh-CN' })).toEqual({
      from: 'zh-CN',
      to: 'en'
    });
  });

  it('routes mostly Chinese mixed text to English', () => {
    expect(resolveTranslateDirection({ from: 'auto', text: '你好 test 世界啊', to: 'zh-CN' })).toEqual({
      from: 'auto',
      to: 'en'
    });
  });

  it('does not override an explicit target language', () => {
    expect(resolveTranslateDirection({ from: 'auto', text: '你好', to: 'ja' })).toEqual({
      from: 'auto',
      to: 'ja'
    });
  });
});
