import { describe, it, expect } from 'vitest';
import { loadConfig, saveConfig } from './storage';
import { defaultConfig } from './config';

describe('storage', () => {
  it('loadConfig returns defaults when nothing saved', async () => {
    expect(await loadConfig()).toEqual(defaultConfig);
  });

  it('saveConfig then loadConfig round-trips values', async () => {
    await saveConfig({ baseUrl: 'http://cham.local', optInDomains: ['nytimes.com'] });
    const loaded = await loadConfig();
    expect(loaded.baseUrl).toBe('http://cham.local');
    expect(loaded.optInDomains).toEqual(['nytimes.com']);
    expect(loaded.neverDomains).toEqual([]);
  });

  it('saveConfig merges, does not overwrite', async () => {
    await saveConfig({ baseUrl: 'http://a.local' });
    await saveConfig({ optInDomains: ['x.com'] });
    const loaded = await loadConfig();
    expect(loaded.baseUrl).toBe('http://a.local');
    expect(loaded.optInDomains).toEqual(['x.com']);
  });
});
