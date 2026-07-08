import { describe, expect, it } from 'vitest';
import {
  buildClipboardMatchRules,
  isAmountLines,
  isCalculatorExpression,
  isDecimalAmount,
  isHtmlContent,
  isIpAddress,
  isIsoDate,
  normalizeClipboardMatchConfig,
  resolveMatchedToolKeys
} from '../shared/plugin/clipboardMatch';

describe('clipboardMatch', () => {
  it('normalizes single and array clipboard match configs', () => {
    expect(normalizeClipboardMatchConfig({ type: 'id-card', priority: 96 })).toEqual([
      { type: 'id-card', priority: 96 }
    ]);
    expect(normalizeClipboardMatchConfig([{ type: 'json' }, { type: 'invalid' }])).toEqual([{ type: 'json', priority: 90 }]);
  });

  it('builds plugin rules from manifest config', () => {
    const rules = buildClipboardMatchRules('plugin:tooldesk-id-card-query', { type: 'id-card', priority: 96 });

    expect(resolveMatchedToolKeys('11010119900307888X', rules)).toEqual(['plugin:tooldesk-id-card-query']);
  });

  it('does not extract bank card numbers from URLs or mixed text', () => {
    const rules = buildClipboardMatchRules('plugin:tooldesk-bank-bin-query', { type: 'bank-card', priority: 95 });

    expect(resolveMatchedToolKeys('6222 0200 1234 5678', rules)).toEqual(['plugin:tooldesk-bank-bin-query']);
    expect(resolveMatchedToolKeys('6222-0200-1234-5678', rules)).toEqual(['plugin:tooldesk-bank-bin-query']);
    expect(resolveMatchedToolKeys('https://chat.deepseek.com/a/chat/s/56dbabed-dfc5-44cf-ac8c-4d23de0916d2', rules)).toEqual([]);
    expect(resolveMatchedToolKeys('card: 6222020012345678', rules)).toEqual([]);
  });

  it('matches decimal amounts and amount lines', () => {
    expect(isDecimalAmount('¥1,234.56')).toBe(true);
    expect(isAmountLines('1000.50\n2300\n450.25')).toBe(true);
    expect(isIsoDate('2024-06-04')).toBe(true);
  });

  it('does not treat http urls as calculator expressions', () => {
    expect(isCalculatorExpression('https://hub.ccttt99.com/')).toBe(false);
    expect(isCalculatorExpression('12 / 3 + 4')).toBe(true);
  });

  it('does not treat JSON content as calculator expressions', () => {
    expect(isCalculatorExpression('{"biz_code":"JS100035","sign":"a/b/c","sign_type":"2"}')).toBe(false);
    expect(isCalculatorExpression('2024-06-04')).toBe(false);
  });

  it('matches html content', () => {
    expect(isHtmlContent('<!DOCTYPE html><html><body>Hello</body></html>')).toBe(true);
    expect(isHtmlContent('<div><span>Hello</span></div>')).toBe(true);
    expect(isHtmlContent('普通文本 < 10 and > 2')).toBe(false);
    expect(normalizeClipboardMatchConfig({ type: 'html' })).toEqual([{ type: 'html', priority: 91 }]);
  });

  it('matches only valid standalone IPv4 addresses', () => {
    expect(isIpAddress('8.8.8.8')).toBe(true);
    expect(isIpAddress('192.168.1.1')).toBe(true);
    expect(isIpAddress('255.255.255.255')).toBe(true);
    expect(isIpAddress('256.1.1.1')).toBe(false);
    expect(isIpAddress('192.168.001.001')).toBe(false);
    expect(isIpAddress('https://192.168.1.1')).toBe(false);
  });
});
