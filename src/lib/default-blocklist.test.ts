import { describe, it, expect } from 'vitest';
import { DEFAULT_DOMAIN_BLOCKLIST, DEFAULT_URL_PATTERN_BLOCKLIST } from './default-blocklist';

describe('default blocklist', () => {
  it('blocks common webmail domains', () => {
    expect(DEFAULT_DOMAIN_BLOCKLIST).toContain('mail.google.com');
    expect(DEFAULT_DOMAIN_BLOCKLIST).toContain('outlook.live.com');
    expect(DEFAULT_DOMAIN_BLOCKLIST).toContain('outlook.office.com');
  });

  it('blocks localhost-style hosts', () => {
    expect(DEFAULT_DOMAIN_BLOCKLIST).toContain('localhost');
    expect(DEFAULT_DOMAIN_BLOCKLIST).toContain('127.0.0.1');
  });

  it('URL pattern blocklist covers admin/auth surfaces', () => {
    expect(DEFAULT_URL_PATTERN_BLOCKLIST).toContain('/admin');
    expect(DEFAULT_URL_PATTERN_BLOCKLIST).toContain('/login');
    expect(DEFAULT_URL_PATTERN_BLOCKLIST).toContain('/signin');
  });
});
