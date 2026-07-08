import { describe, expect, it } from 'vitest';
import { formatJsonWithInlineValues } from './jsonFormatter';

describe('formatJsonWithInlineValues', () => {
  it('formats each top-level key on its own line', () => {
    const result = formatJsonWithInlineValues('{"name":"tooldesk","config":{"theme":"light"},"items":[1,2]}', 4);

    expect(result).toBe(
      [
        '{',
        '    "name": "tooldesk",',
        '    "config": {',
        '        "theme": "light"',
        '    },',
        '    "items": [',
        '        1,',
        '        2',
        '    ]',
        '}'
      ].join('\n')
    );
  });

  it('formats nested object values', () => {
    const source = JSON.stringify({
      timeStamp: 1745133857,
      data: { applicationId: 'fe7fd3654edc82b3be28e407', queryType: 'MER' },
      randStr: 'HdHQkTI38wjlTtuv'
    });
    const result = formatJsonWithInlineValues(source, 4);

    expect(result).toContain('"data": {');
    expect(result).toContain('"applicationId": "fe7fd3654edc82b3be28e407"');
    expect(result).toContain('"queryType": "MER"');
    expect(result).not.toMatch(/"data": \{[^\n]+\}/);
  });
});
