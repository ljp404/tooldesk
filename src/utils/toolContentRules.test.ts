import { describe, expect, it } from 'vitest';
import { isUrlEncodedContent, resolveContentToolKeys } from '../shared/toolContentRules';

describe('toolContentRules', () => {
  it('matches encoded urls as codec content', () => {
    expect(isUrlEncodedContent('https%3A%2F%2Fexample.com%2Fpay%3Fid%3D1')).toBe(true);
  });

  it('returns qr and codec for urls with encoded parameters', () => {
    const url =
      'https://open.weixin.qq.com/connect/oauth2/authorize?redirect_uri=https%3A%2F%2Fpaycashier.yunfastpay.com%2Fgateway%2Fcashier%3ForderNo%3D1';

    expect(
      resolveContentToolKeys(url, [
        {
          key: 'plugin:tooldesk-qr-generator',
          clipboardMatch: [{ type: 'http-url', priority: 84 }]
        },
        {
          key: 'plugin:tooldesk-codec',
          clipboardMatch: [
            { type: 'jwt', priority: 88 },
            { type: 'base64', priority: 87 },
            { type: 'url-encoded', priority: 83 }
          ]
        }
      ])
    ).toEqual(['plugin:tooldesk-qr-generator', 'plugin:tooldesk-codec']);
  });

  it('does not rank bank card query ahead of qr for urls containing digits', () => {
    expect(
      resolveContentToolKeys('https://chat.deepseek.com/a/chat/s/56dbabed-dfc5-44cf-ac8c-4d23de0916d2', [
        {
          key: 'plugin:tooldesk-bank-bin-query',
          clipboardMatch: [{ type: 'bank-card', priority: 95 }]
        },
        {
          key: 'plugin:tooldesk-qr-generator',
          clipboardMatch: [{ type: 'http-url', priority: 84 }]
        }
      ])
    ).toEqual(['plugin:tooldesk-qr-generator']);
  });

  it('includes plugin clipboard matches when provided', () => {
    expect(
      resolveContentToolKeys('50%+50%', [
        {
          key: 'plugin:tooldesk-expression-calculator',
          clipboardMatch: [{ type: 'calculator-expression', priority: 97 }]
        }
      ])
    ).toEqual(['plugin:tooldesk-expression-calculator']);
  });

  it('matches calculator expressions with thousands separators', () => {
    expect(
      resolveContentToolKeys('9859.68+4,886=', [
        {
          key: 'plugin:tooldesk-expression-calculator',
          clipboardMatch: [{ type: 'calculator-expression', priority: 97 }]
        }
      ])
    ).toEqual(['plugin:tooldesk-expression-calculator']);
  });

  it('does not match calculator expressions with loose commas', () => {
    expect(
      resolveContentToolKeys('9859,68+4,88=', [
        {
          key: 'plugin:tooldesk-expression-calculator',
          clipboardMatch: [{ type: 'calculator-expression', priority: 97 }]
        }
      ])
    ).toEqual([]);
  });

  it('does not rank expression calculator ahead of qr for http urls', () => {
    expect(
      resolveContentToolKeys('https://hub.ccttt99.com/', [
        {
          key: 'plugin:tooldesk-expression-calculator',
          clipboardMatch: [{ type: 'calculator-expression', priority: 97 }]
        }
      ])
    ).toEqual([]);
  });

  it('ranks json formatter ahead of expression calculator for JSON text', () => {
    expect(
      resolveContentToolKeys('{"biz_code":"JS100035","sign":"a/b/c","sign_type":"2"}', [
        {
          key: 'plugin:tooldesk-expression-calculator',
          clipboardMatch: [{ type: 'calculator-expression', priority: 97 }]
        },
        {
          key: 'plugin:tooldesk-json-formatter',
          clipboardMatch: [{ type: 'json', priority: 90 }]
        }
      ])
    ).toEqual(['plugin:tooldesk-json-formatter']);
  });

  it('matches JSON text that contains hidden newlines inside string values', () => {
    expect(
      resolveContentToolKeys('{"name":"run\ntime","data":{"id":"1"}}', [
        {
          key: 'plugin:tooldesk-json-formatter',
          clipboardMatch: [{ type: 'json', priority: 90 }]
        }
      ])
    ).toEqual(['plugin:tooldesk-json-formatter']);
  });

  it('matches Java six-field cron expressions', () => {
    expect(
      resolveContentToolKeys('0 0 3 * * ?', [
        {
          key: 'plugin:tooldesk-cron-parser',
          clipboardMatch: [{ type: 'cron', priority: 86 }]
        }
      ])
    ).toEqual(['plugin:tooldesk-cron-parser']);
  });

  it('matches standalone IP addresses to IP query', () => {
    expect(
      resolveContentToolKeys('8.8.8.8', [
        {
          key: 'plugin:tooldesk-ip-query',
          clipboardMatch: [{ type: 'ip', priority: 89 }]
        }
      ])
    ).toEqual(['plugin:tooldesk-ip-query']);
  });

  it('does not match invalid or URL-wrapped IP content as IP query', () => {
    const tools = [
      {
        key: 'plugin:tooldesk-ip-query' as const,
        clipboardMatch: [{ type: 'ip' as const, priority: 89 }]
      },
      {
        key: 'plugin:tooldesk-qr-generator' as const,
        clipboardMatch: [{ type: 'http-url' as const, priority: 84 }]
      }
    ];

    expect(resolveContentToolKeys('999.1.1.1', tools)).toEqual([]);
    expect(resolveContentToolKeys('https://192.168.1.1', tools)).toEqual(['plugin:tooldesk-qr-generator']);
  });
});
