import { describe, expect, it } from 'vitest';
import {
  buildPreview,
  detectCategory,
  shouldStoreAsHtmlClipboard
} from '../shared/superClipboard/categorize';

describe('superClipboard categorize', () => {
  it('detects links and code', () => {
    expect(detectCategory('text', 'https://example.com')).toBe('link');
    expect(detectCategory('text', '{"a":1}')).toBe('json');
    expect(detectCategory('image', '', undefined)).toBe('image');
    expect(detectCategory('text', 'hello', '<p>hello</p>')).toBe('text');
  });

  it('builds preview text', () => {
    expect(buildPreview('text', 'hello world')).toBe('hello world');
    expect(buildPreview('image', '')).toBe('[图片]');
  });

  it('ignores CF_HTML wrapper when plain text matches', () => {
    const text = '我想要的是';
    const html =
      '<html><body><!--StartFragment-->我想要的是<!--EndFragment--></body></html>';

    expect(shouldStoreAsHtmlClipboard(html, text)).toBe(false);
    expect(detectCategory('text', text)).toBe('text');
  });

  it('keeps real rich html copies', () => {
    const text = '标题';
    const html = '<html><body><h1>标题</h1><p>正文</p></body></html>';

    expect(shouldStoreAsHtmlClipboard(html, text)).toBe(true);
    expect(detectCategory('html', text, html)).toBe('html');
  });

  it('classifies HTML source documents as html, not code', () => {
    const source = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>Tooldesk</title></head>
<body></body>
</html>`;

    expect(detectCategory('text', source)).toBe('html');
  });
});
