import { describe, it, expect } from 'vitest';
import { decide, type Candidate } from './decision-pipeline';
import { defaultConfig } from './config';

const baseCandidate: Candidate = {
  url: 'https://nytimes.com/2026/05/article',
  isArticle: true,
};

describe('decide', () => {
  it('rejects URLs on the user blocklist', () => {
    const result = decide(
      { ...baseCandidate, url: 'https://mail.google.com/inbox' },
      { ...defaultConfig, neverDomains: [] },
    );
    expect(result.action).toBe('reject');
    expect(result.reason).toMatch(/blocklist/);
  });

  it('rejects URLs matching default pattern blocklist', () => {
    const result = decide(
      { ...baseCandidate, url: 'https://x.test/admin/users' },
      defaultConfig,
    );
    expect(result.action).toBe('reject');
    expect(result.reason).toMatch(/pattern/);
  });

  it('rejects non-articles', () => {
    const result = decide({ ...baseCandidate, isArticle: false }, defaultConfig);
    expect(result.action).toBe('reject');
    expect(result.reason).toMatch(/article/);
  });

  it('rejects local hosts (not the Cham base) outright', () => {
    const result = decide(
      { ...baseCandidate, url: 'http://192.168.1.10/something' },
      { ...defaultConfig, baseUrl: 'http://cham.example.com' },
    );
    expect(result.action).toBe('reject');
    expect(result.reason).toMatch(/local/);
  });

  it('rejects URLs on the user neverDomains list', () => {
    const result = decide(baseCandidate, { ...defaultConfig, neverDomains: ['nytimes.com'] });
    expect(result.action).toBe('reject');
  });

  it('archives URLs on the user optInDomains list', () => {
    const result = decide(baseCandidate, { ...defaultConfig, optInDomains: ['nytimes.com'] });
    expect(result.action).toBe('archive');
  });

  it('prompts otherwise', () => {
    const result = decide(baseCandidate, defaultConfig);
    expect(result.action).toBe('prompt');
  });
});
