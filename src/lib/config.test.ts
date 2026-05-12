import { describe, it, expect } from 'vitest';
import { defaultConfig, normalizeBaseUrl, isValidBaseUrl } from './config';

describe('config', () => {
  it('defaultConfig has empty baseUrl and empty opt-in lists', () => {
    expect(defaultConfig).toEqual({
      baseUrl: '',
      optInDomains: [],
      neverDomains: [],
      dwellMs: 30_000,
      scrollPct: 0.4,
    });
  });

  it('normalizeBaseUrl strips trailing slash', () => {
    expect(normalizeBaseUrl('http://cham.local/')).toBe('http://cham.local');
    expect(normalizeBaseUrl('http://cham.local')).toBe('http://cham.local');
  });

  it('isValidBaseUrl accepts http/https origins, rejects others', () => {
    expect(isValidBaseUrl('http://cham.local')).toBe(true);
    expect(isValidBaseUrl('https://cham.example.com')).toBe(true);
    expect(isValidBaseUrl('ftp://cham.local')).toBe(false);
    expect(isValidBaseUrl('not a url')).toBe(false);
    expect(isValidBaseUrl('')).toBe(false);
  });
});
