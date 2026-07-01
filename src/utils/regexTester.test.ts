import { describe, expect, it } from 'vitest';
import { testRegex } from './regexTester';

describe('testRegex', () => {
  it('finds global matches', () => {
    const result = testRegex({
      flags: 'g',
      pattern: '\\d+',
      text: 'a1 b22 c333'
    });

    expect(result.valid).toBe(true);
    expect(result.matches.map((item) => item.text)).toEqual(['1', '22', '333']);
  });

  it('returns regex error', () => {
    const result = testRegex({
      flags: '',
      pattern: '(',
      text: 'abc'
    });

    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
