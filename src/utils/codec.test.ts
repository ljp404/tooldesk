import { describe, expect, it } from 'vitest';
import { decodeBase64Text, decodeJwt, encodeBase64Text, encodeUrlText } from './codec';

describe('codec', () => {
  it('encodes and decodes base64 text', () => {
    const source = '你好 tooldesk';
    const encoded = encodeBase64Text(source);
    expect(decodeBase64Text(encoded)).toBe(source);
  });

  it('decodes jwt payload', () => {
    const token =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const decoded = decodeJwt(token);

    expect(decoded.payload.object).toMatchObject({
      name: 'John Doe',
      sub: '1234567890'
    });
  });

  it('encodes url text', () => {
    expect(encodeUrlText('a b&c=1')).toBe('a%20b%26c%3D1');
  });
});
