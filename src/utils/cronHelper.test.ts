import { describe, expect, it } from 'vitest';
import { isCronExpression } from '../shared/toolContentRules';
import { parseCronExpression } from './cronHelper';

describe('parseCronExpression', () => {
  it('returns next runs for valid expression', () => {
    const result = parseCronExpression('0 0 * * *', 3);

    expect(result.valid).toBe(true);
    expect(result.nextRuns).toHaveLength(3);
  });

  it('rejects invalid expression', () => {
    const result = parseCronExpression('invalid cron');

    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

describe('isCronExpression', () => {
  it('accepts five-field cron', () => {
    expect(isCronExpression('0 0 * * *')).toBe(true);
  });

  it('rejects non-cron text', () => {
    expect(isCronExpression('hello world')).toBe(false);
  });
});
