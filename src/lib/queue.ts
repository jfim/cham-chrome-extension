const KEY = 'queue';
const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type QueueStatus = 'pending' | 'needs_auth';

export interface QueueEntry {
  id: string;
  url: string;
  queuedAt: number;
  attempts: number;
  lastError?: string;
  status: QueueStatus;
}

function randomId(): string {
  return crypto.randomUUID();
}

async function read(): Promise<QueueEntry[]> {
  const out = await chrome.storage.local.get({ [KEY]: [] as QueueEntry[] });
  return out[KEY] as QueueEntry[];
}

async function write(items: QueueEntry[]): Promise<void> {
  await chrome.storage.local.set({ [KEY]: items });
}

export async function enqueue(url: string): Promise<string> {
  const items = await read();
  const id = randomId();
  items.push({ id, url, queuedAt: Date.now(), attempts: 0, status: 'pending' });
  await write(items);
  return id;
}

export async function listQueue(): Promise<QueueEntry[]> {
  return read();
}

export async function markFailed(id: string, reason: string): Promise<void> {
  const items = await read();
  const next = items.map((it) =>
    it.id === id
      ? {
          ...it,
          attempts: it.attempts + 1,
          lastError: reason,
          status: reason === 'auth-wall' ? ('needs_auth' as const) : it.status,
        }
      : it,
  );
  await write(next);
}

export async function removeFromQueue(id: string): Promise<void> {
  const items = await read();
  await write(items.filter((it) => it.id !== id));
}

export async function hasRecentlyQueued(url: string): Promise<boolean> {
  const items = await read();
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  return items.some((it) => it.url === url && it.queuedAt >= cutoff);
}
