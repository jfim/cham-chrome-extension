import { describe, it, expect, vi } from 'vitest';
import { isChamOriginUrl } from './nav-listener';

describe('isChamOriginUrl', () => {
  it('matches when origin matches the configured baseUrl', () => {
    expect(isChamOriginUrl('https://cham.example.com/dashboard', 'https://cham.example.com')).toBe(
      true,
    );
  });

  it('rejects different origins', () => {
    expect(isChamOriginUrl('https://nytimes.com/x', 'https://cham.example.com')).toBe(false);
  });

  it('returns false on empty/invalid baseUrl', () => {
    expect(isChamOriginUrl('https://x.test', '')).toBe(false);
    expect(isChamOriginUrl('https://x.test', 'not a url')).toBe(false);
  });

  it('returns false on chrome:// URLs', () => {
    expect(isChamOriginUrl('chrome://extensions', 'https://cham.example.com')).toBe(false);
  });

  it('registerNavListener attaches once', async () => {
    const { registerNavListener } = await import('./nav-listener');
    const addListener = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome.webNavigation = { onCompleted: { addListener } };
    registerNavListener();
    expect(addListener).toHaveBeenCalledOnce();
  });
});
