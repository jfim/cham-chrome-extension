import { describe, it, expect, beforeEach } from 'vitest';
import { installChromeFake, resetChromeFake } from './chrome';

describe('chrome fake', () => {
  beforeEach(() => {
    installChromeFake();
    resetChromeFake();
  });

  it('storage.sync.set / get round-trips values', async () => {
    await chrome.storage.sync.set({ baseUrl: 'http://cham.local' });
    const out = await chrome.storage.sync.get('baseUrl');
    expect(out).toEqual({ baseUrl: 'http://cham.local' });
  });

  it('storage.local is independent from storage.sync', async () => {
    await chrome.storage.sync.set({ a: 1 });
    await chrome.storage.local.set({ a: 2 });
    expect((await chrome.storage.sync.get('a')).a).toBe(1);
    expect((await chrome.storage.local.get('a')).a).toBe(2);
  });

  it('alarms.create + alarms.getAll', async () => {
    await chrome.alarms.create('drain', { periodInMinutes: 5 });
    const all = await chrome.alarms.getAll();
    expect(all.map((a) => a.name)).toEqual(['drain']);
  });
});
