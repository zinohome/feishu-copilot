import { describe, expect, it } from 'vitest';
import { verifySignature } from '../archive/src/feishu/signature';

describe('verifySignature', () => {
  it('returns false for mismatched signature', () => {
    expect(
      verifySignature({
        timestamp: '1',
        nonce: 'n',
        body: '{}',
        signature: 'x',
        encryptKey: 'k',
      }),
    ).toBe(false);
  });
});
