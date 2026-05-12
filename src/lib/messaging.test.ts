import { describe, it, expect } from 'vitest';
import { isCandidateMessage, isOptInResponseMessage } from './messaging';

describe('messaging guards', () => {
  it('isCandidateMessage accepts valid candidate', () => {
    expect(
      isCandidateMessage({
        type: 'candidate',
        url: 'https://x/y',
        isArticle: true,
        title: 'X',
      }),
    ).toBe(true);
  });

  it('isCandidateMessage rejects unrelated shape', () => {
    expect(isCandidateMessage({ type: 'other' })).toBe(false);
    expect(isCandidateMessage(null)).toBe(false);
  });

  it('isOptInResponseMessage accepts all three choices', () => {
    for (const choice of ['always', 'once', 'never'] as const) {
      expect(isOptInResponseMessage({ type: 'opt-in-response', domain: 'x.com', choice })).toBe(
        true,
      );
    }
  });
});
