import { listQueue, removeFromQueue, markFailed } from '../lib/queue';
import { loadConfig } from '../lib/storage';
import { isValidBaseUrl } from '../lib/config';
import { submitUrl, SubmitError } from '../lib/cham-client';
import { log } from '../lib/logger';

export async function drainOnce(): Promise<void> {
  const config = await loadConfig();
  if (!isValidBaseUrl(config.baseUrl)) {
    log.debug('drain skipped: no valid baseUrl');
    return;
  }
  const items = await listQueue();
  for (const item of items) {
    if (item.status === 'needs_auth') continue;
    try {
      const result = await submitUrl({ baseUrl: config.baseUrl }, item.url);
      if (result.ok || result.status === 409) {
        await removeFromQueue(item.id);
      } else {
        await markFailed(item.id, `http ${result.status}`);
      }
    } catch (err) {
      const kind = err instanceof SubmitError ? err.kind : 'unknown';
      await markFailed(item.id, kind);
    }
  }
}

export function startDrainScheduler(): void {
  void chrome.alarms.create('cham-drain', { periodInMinutes: 5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'cham-drain') void drainOnce();
  });
  globalThis.addEventListener?.('online', () => void drainOnce());
}

export async function drainNeedsAuth(): Promise<void> {
  const items = await listQueue();
  await chrome.storage.local.set({
    queue: items.map((it) =>
      it.status === 'needs_auth' ? { ...it, status: 'pending' as const } : it,
    ),
  });
  await drainOnce();
}
