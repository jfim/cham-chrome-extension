import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drainOnce } from './drain';
import { enqueue, listQueue } from '../lib/queue';
import { saveConfig } from '../lib/storage';

describe('drainOnce', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
    await chrome.storage.sync.clear();
    await saveConfig({ baseUrl: 'http://cham.local' });
    vi.restoreAllMocks();
  });

  it('removes entry on successful submit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: 'x' }), {
          status: 202,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    await enqueue('https://example.com/a');
    await drainOnce();
    expect(await listQueue()).toEqual([]);
  });

  it('marks entry needs_auth on auth-wall', async () => {
    const cf = new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    Object.defineProperty(cf, 'redirected', { value: true });
    Object.defineProperty(cf, 'url', { value: 'https://x.cloudflareaccess.com/login' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cf));
    await enqueue('https://example.com/a');
    await drainOnce();
    const [entry] = await listQueue();
    expect(entry.status).toBe('needs_auth');
  });

  it('skips when baseUrl unconfigured', async () => {
    await chrome.storage.sync.clear();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await enqueue('https://example.com/a');
    await drainOnce();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('increments attempts on network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await enqueue('https://example.com/a');
    await drainOnce();
    const [entry] = await listQueue();
    expect(entry.attempts).toBe(1);
    expect(entry.lastError).toMatch(/network/);
  });
});
