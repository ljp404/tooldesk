import { describe, expect, it } from 'vitest';
import { resolveContentToolKeys } from '../shared/toolContentRules';

const pluginTools = [
  {
    clipboardMatch: [{ type: 'http-url' as const, priority: 84 }],
    key: 'plugin:tooldesk-qr-generator' as const
  },
  {
    clipboardMatch: [
      { type: 'jwt' as const, priority: 88 },
      { type: 'base64' as const, priority: 87 },
      { type: 'url-encoded' as const, priority: 83 }
    ],
    key: 'plugin:tooldesk-codec' as const
  }
];

describe('clipboardRouter', () => {
  it('routes http urls to qr generator', () => {
    expect(resolveContentToolKeys('https://example.com/path', pluginTools)[0]).toBe('plugin:tooldesk-qr-generator');
  });

  it('routes encoded content to codec', () => {
    expect(resolveContentToolKeys('https%3A%2F%2Fexample.com%2Fpay%3Fid%3D1', pluginTools)[0]).toBe('plugin:tooldesk-codec');
  });
});
