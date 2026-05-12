import { describe, it, expect, beforeEach } from 'vitest';
import { enqueue, listQueue, markFailed, removeFromQueue, hasRecentlyQueued } from './queue';

describe('queue', () => {
  beforeEach(async () => {
    await chrome.storage.local.clear();
  });

  it('enqueue then list returns the entry', async () => {
    const id = await enqueue('https://example.com/article');
    const items = await listQueue();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id, url: 'https://example.com/article', attempts: 0 });
  });

  it('dedupes URLs queued within the recent window', async () => {
    await enqueue('https://example.com/x');
    expect(await hasRecentlyQueued('https://example.com/x')).toBe(true);
    expect(await hasRecentlyQueued('https://example.com/y')).toBe(false);
  });

  it('markFailed increments attempts and stores lastError', async () => {
    const id = await enqueue('https://x.test/');
    await markFailed(id, 'auth-wall');
    const [entry] = await listQueue();
    expect(entry.attempts).toBe(1);
    expect(entry.lastError).toBe('auth-wall');
  });

  it('markFailed with kind=auth-wall sets status to needs_auth', async () => {
    const id = await enqueue('https://x.test/');
    await markFailed(id, 'auth-wall');
    const [entry] = await listQueue();
    expect(entry.status).toBe('needs_auth');
  });

  it('removeFromQueue removes by id', async () => {
    const id = await enqueue('https://x.test/');
    await removeFromQueue(id);
    expect(await listQueue()).toEqual([]);
  });
});
