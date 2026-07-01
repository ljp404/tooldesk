import { describe, expect, it } from 'vitest';
import { composeFormattedMixedText, extractJsonFromText, locateJsonInText } from './jsonExtract';

describe('extractJsonFromText', () => {
  it('returns pure JSON as-is', () => {
    const json = '{"a":1,"b":[2,3]}';

    expect(extractJsonFromText(json)).toBe(json);
  });

  it('extracts JSON after Chinese log prefix', () => {
    const prefix = '调用【微信支付宝认证申请状态查询】响应参数：';
    const body = {
      rspHeader: { rspCode: '000000', rspInfo: 'SUCCESS' },
      rspBody: { retCode: '000000', applyStatus: 'PASSED' }
    };
    const source = `${prefix}${JSON.stringify(body)}`;
    const extracted = extractJsonFromText(source);

    expect(extracted).toBe(JSON.stringify(body));
    expect(JSON.parse(extracted!)).toEqual(body);
  });

  it('skips invalid brace segments and extracts the next JSON object', () => {
    const source = 'invalid { not json } ok: {"x":1}';

    expect(extractJsonFromText(source)).toBe('{"x":1}');
  });

  it('prefers the outermost JSON object over nested ones', () => {
    const source = '响应：{"outer":{"inner":1},"tail":2}';

    expect(extractJsonFromText(source)).toBe('{"outer":{"inner":1},"tail":2}');
  });

  it('returns null when no JSON is present', () => {
    expect(extractJsonFromText('只有中文说明，没有 JSON')).toBeNull();
  });

  it('escapes real newlines inside string values instead of dropping content', () => {
    const extracted = extractJsonFromText('{"name":"run\ntime","data":{"id":"1"}}');

    expect(extracted).toBe('{"name":"run\\ntime","data":{"id":"1"}}');
    expect(JSON.parse(extracted!).name).toBe('run\ntime');
  });
});

describe('locateJsonInText', () => {
  it('marks pure JSON and keeps surrounding whitespace', () => {
    const located = locateJsonInText('  {"a":1}  ');

    expect(located).toEqual({
      isPure: true,
      json: '{"a":1}',
      prefix: '  ',
      suffix: '  '
    });
  });

  it('splits mixed log text into prefix, json and suffix', () => {
    const source = '调用【查询】响应参数：{"rspCode":"000000"}';
    const located = locateJsonInText(source);

    expect(located?.isPure).toBe(false);
    expect(located?.prefix).toBe('调用【查询】响应参数：');
    expect(located?.json).toBe('{"rspCode":"000000"}');
    expect(located?.suffix).toBe('');
  });
});

describe('composeFormattedMixedText', () => {
  it('inserts formatted JSON on a new line after the prefix', () => {
    const result = composeFormattedMixedText('响应参数：', '{\n    "a": 1\n}', '');

    expect(result).toBe('响应参数：\n{\n    "a": 1\n}');
  });
});
