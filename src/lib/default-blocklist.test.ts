import { describe, it, expect } from 'vitest';
import { DEFAULT_DOMAIN_BLOCKLIST, DEFAULT_URL_PATTERN_BLOCKLIST } from './default-blocklist';

describe('default blocklist', () => {
  it('blocks common webmail domains', () => {
    expect(DEFAULT_DOMAIN_BLOCKLIST).toContain('mail.google.com');
    expect(DEFAULT_DOMAIN_BLOCKLIST).toContain('outlook.live.com');
    expect(DEFAULT_DOMAIN_BLOCKLIST).toContain('outlook.office.com');
  });

  // Localhost-style hosts are handled by isLocalHost in url-matcher,
  // not by the domain blocklist, so that a user-configured Cham instance
  // on a local host can still be reached.

  it('URL pattern blocklist covers admin/auth surfaces', () => {
    expect(DEFAULT_URL_PATTERN_BLOCKLIST).toContain('/admin');
    expect(DEFAULT_URL_PATTERN_BLOCKLIST).toContain('/login');
    expect(DEFAULT_URL_PATTERN_BLOCKLIST).toContain('/signin');
  });
});
