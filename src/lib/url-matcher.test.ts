import { describe, it, expect } from 'vitest';
import { domainOf, matchesDomain, matchesAnyPattern, isLocalHost } from './url-matcher';

describe('url-matcher', () => {
  it('domainOf returns hostname', () => {
    expect(domainOf('https://www.nytimes.com/article')).toBe('www.nytimes.com');
    expect(domainOf('http://localhost:4000/x')).toBe('localhost');
  });

  it('matchesDomain treats list entries as suffix-matched on dot boundary', () => {
    expect(matchesDomain('https://www.nytimes.com/x', ['nytimes.com'])).toBe(true);
    expect(matchesDomain('https://nytimes.com/x', ['nytimes.com'])).toBe(true);
    expect(matchesDomain('https://evilnytimes.com/x', ['nytimes.com'])).toBe(false);
    expect(matchesDomain('https://example.com/x', ['nytimes.com'])).toBe(false);
  });

  it('matchesDomain matches localhost literally', () => {
    expect(matchesDomain('http://localhost:4000/x', ['localhost'])).toBe(true);
    expect(matchesDomain('http://127.0.0.1/x', ['127.0.0.1'])).toBe(true);
  });

  it('matchesAnyPattern checks URL substring', () => {
    expect(matchesAnyPattern('https://x.com/admin/users', ['/admin'])).toBe(true);
    expect(matchesAnyPattern('https://x.com/articles', ['/admin'])).toBe(false);
  });

  it('isLocalHost detects RFC1918 + .local + localhost', () => {
    expect(isLocalHost('http://localhost:4000/')).toBe(true);
    expect(isLocalHost('http://192.168.1.10/')).toBe(true);
    expect(isLocalHost('http://10.0.0.5/')).toBe(true);
    expect(isLocalHost('http://172.16.0.1/')).toBe(true);
    expect(isLocalHost('https://nas.local/')).toBe(true);
    expect(isLocalHost('https://nytimes.com/')).toBe(false);
  });
});
