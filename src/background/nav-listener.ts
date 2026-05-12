import { loadConfig } from '../lib/storage';
import { drainNeedsAuth } from './drain';
import { log } from '../lib/logger';

export function isChamOriginUrl(url: string, baseUrl: string): boolean {
  if (!baseUrl) return false;
  try {
    return new URL(url).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

export function registerNavListener(): void {
  chrome.webNavigation.onCompleted.addListener(
    async (details: { url: string; frameId: number }) => {
      if (details.frameId !== 0) return;
      const config = await loadConfig();
      if (isChamOriginUrl(details.url, config.baseUrl)) {
        log.info('Cham origin visited; draining needs_auth queue');
        await drainNeedsAuth();
      }
    },
  );
}
