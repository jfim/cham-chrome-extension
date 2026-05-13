# Auto-Archive with Opt-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chrome extension that auto-archives articles to a self-hosted Cham instance, gated by a per-domain opt-in prompt and a persistent submission queue that survives offline periods and Cloudflare Access auth walls.

**Architecture:** A content script tracks dwell time and scroll on each page and reports candidates to the MV3 service worker. The service worker runs candidates through a decision pipeline (URL blocklist → Readability classifier → per-domain opt-in list → one-time opt-in prompt) and on accept enqueues a submission. A persistent queue drains via `chrome.alarms`, `navigator.onLine` events, and a `chrome.webNavigation` listener on the configured Cham origin (which lets us drain immediately after the user reauthenticates with Cloudflare Access). All state lives in `chrome.storage` (sync for config, local for transient queue/dwell).

**Tech Stack:** TypeScript, Vite + @crxjs/vite-plugin (Manifest V3), `@mozilla/readability`, Vitest (jsdom) for unit tests, ESLint + Prettier, GitHub Actions CI.

---

## File Structure

**Core library (`src/lib/`):**

- `config.ts` — `ChamConfig` type + defaults + validation
- `storage.ts` — typed wrapper around `chrome.storage.sync`/`local` with an in-memory fake for tests
- `default-blocklist.ts` — bundled domain + URL-pattern defaults (gmail, outlook, banking, localhost, etc.)
- `url-matcher.ts` — match a URL against a list of domain rules + URL substring patterns
- `cham-client.ts` — `submitUrl` + `pingCham`; recognizes Cloudflare Access auth-wall as a distinct error
- `queue.ts` — persistent FIFO with attempts, backoff, and `needs_auth` state
- `readability-classifier.ts` — wraps `@mozilla/readability` to return `{isArticle, score}`
- `decision-pipeline.ts` — runs filters in order, returns `{action: 'archive'|'prompt'|'reject', reason}`
- `messaging.ts` — typed message protocol between content scripts and the service worker
- `logger.ts` — thin wrapper around `console` (so tests can assert / silence)

**Content scripts (`src/content/`):**

- `dwell-tracker.ts` — dwell + scroll detector, emits candidate when thresholds cross
- `opt-in-banner.ts` — injected banner UI (Always / Just this one / Never)
- `index.ts` — content script entrypoint, wires the two together

**Background (`src/background/`):**

- `service-worker.ts` — entry: registers listeners, owns the pipeline
- `nav-listener.ts` — `chrome.webNavigation` listener that triggers a queue drain when the user visits the Cham origin
- `drain.ts` — queue drain loop driven by alarms + online events

**UI:**

- `src/options/options.ts` + `index.html` — Cham URL, blocklist/allowlist editors, connection test
- `src/popup/popup.ts` + `index.html` — current-tab status, manual actions, recent submissions + undo

**Tests:** colocated `*.test.ts` next to source for every `src/lib/` module. Content-script and service-worker modules tested via their pure helpers; messaging boundary tested with a chrome-API fake (see `src/lib/storage.ts` companion `src/lib/__fakes__/chrome.ts`).

---

## Task 1: Test infrastructure — Chrome API fake

**Files:**

- Create: `src/lib/__fakes__/chrome.ts`
- Create: `src/lib/__fakes__/chrome.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/__fakes__/chrome.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__fakes__/chrome.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the fake**

```ts
// src/lib/__fakes__/chrome.ts
type StoreArea = Record<string, unknown>;

function makeStorageArea() {
  let store: StoreArea = {};
  return {
    async get(keys?: string | string[] | StoreArea | null): Promise<StoreArea> {
      if (keys == null) return { ...store };
      if (typeof keys === 'string') return { [keys]: store[keys] };
      if (Array.isArray(keys)) {
        return Object.fromEntries(keys.map((k) => [k, store[k]]));
      }
      const out: StoreArea = {};
      for (const [k, fallback] of Object.entries(keys)) {
        out[k] = k in store ? store[k] : fallback;
      }
      return out;
    },
    async set(items: StoreArea): Promise<void> {
      store = { ...store, ...items };
    },
    async remove(keys: string | string[]): Promise<void> {
      const list = Array.isArray(keys) ? keys : [keys];
      for (const k of list) delete store[k];
    },
    async clear(): Promise<void> {
      store = {};
    },
    _reset(): void {
      store = {};
    },
  };
}

const alarms = new Map<string, { name: string; periodInMinutes?: number; when?: number }>();

function makeAlarms() {
  return {
    async create(name: string, info: { periodInMinutes?: number; when?: number }) {
      alarms.set(name, { name, ...info });
    },
    async getAll() {
      return Array.from(alarms.values());
    },
    async clear(name: string) {
      return alarms.delete(name);
    },
    onAlarm: { addListener: (_fn: unknown) => {} },
    _reset() {
      alarms.clear();
    },
  };
}

const sync = makeStorageArea();
const local = makeStorageArea();
const alarmsApi = makeAlarms();

export function installChromeFake(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).chrome = {
    storage: { sync, local },
    alarms: alarmsApi,
    runtime: {
      onInstalled: { addListener: (_fn: unknown) => {} },
      sendMessage: async (_msg: unknown) => undefined,
      onMessage: { addListener: (_fn: unknown) => {} },
    },
    notifications: {
      create: async (_id: string, _opts: unknown) => 'noop',
    },
    webNavigation: {
      onCompleted: { addListener: (_fn: unknown) => {} },
    },
  };
}

export function resetChromeFake(): void {
  sync._reset();
  local._reset();
  alarmsApi._reset();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__fakes__/chrome.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Wire the fake into Vitest setup**

Create `vitest.setup.ts`:

```ts
import { installChromeFake, resetChromeFake } from './src/lib/__fakes__/chrome';
import { beforeEach } from 'vitest';

installChromeFake();
beforeEach(() => {
  resetChromeFake();
});
```

Edit `vite.config.ts` — replace the `test` block:

```ts
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
```

Run: `npm test`
Expected: existing tests + new fake tests all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/__fakes__ vitest.setup.ts vite.config.ts
git commit -m "test: add chrome API fake and vitest setup"
```

---

## Task 2: Config module

**Files:**

- Create: `src/lib/config.ts`
- Create: `src/lib/config.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/config.test.ts
import { describe, it, expect } from 'vitest';
import { defaultConfig, normalizeBaseUrl, isValidBaseUrl } from './config';

describe('config', () => {
  it('defaultConfig has empty baseUrl and empty opt-in lists', () => {
    expect(defaultConfig).toEqual({
      baseUrl: '',
      optInDomains: [],
      neverDomains: [],
      dwellMs: 30_000,
      scrollPct: 0.4,
    });
  });

  it('normalizeBaseUrl strips trailing slash', () => {
    expect(normalizeBaseUrl('http://cham.local/')).toBe('http://cham.local');
    expect(normalizeBaseUrl('http://cham.local')).toBe('http://cham.local');
  });

  it('isValidBaseUrl accepts http/https origins, rejects others', () => {
    expect(isValidBaseUrl('http://cham.local')).toBe(true);
    expect(isValidBaseUrl('https://cham.example.com')).toBe(true);
    expect(isValidBaseUrl('ftp://cham.local')).toBe(false);
    expect(isValidBaseUrl('not a url')).toBe(false);
    expect(isValidBaseUrl('')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/config.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/config.ts
export interface ChamConfig {
  baseUrl: string;
  optInDomains: string[];
  neverDomains: string[];
  dwellMs: number;
  scrollPct: number;
}

export const defaultConfig: ChamConfig = {
  baseUrl: '',
  optInDomains: [],
  neverDomains: [],
  dwellMs: 30_000,
  scrollPct: 0.4,
};

export function normalizeBaseUrl(input: string): string {
  return input.replace(/\/+$/, '');
}

export function isValidBaseUrl(input: string): boolean {
  if (!input) return false;
  try {
    const u = new URL(input);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/config.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/config.ts src/lib/config.test.ts
git commit -m "feat: add config types and validation helpers"
```

---

## Task 3: Storage wrapper

**Files:**

- Create: `src/lib/storage.ts`
- Create: `src/lib/storage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/storage.test.ts
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
    expect(loaded.neverDomains).toEqual([]); // default preserved
  });

  it('saveConfig merges, does not overwrite', async () => {
    await saveConfig({ baseUrl: 'http://a.local' });
    await saveConfig({ optInDomains: ['x.com'] });
    const loaded = await loadConfig();
    expect(loaded.baseUrl).toBe('http://a.local');
    expect(loaded.optInDomains).toEqual(['x.com']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/storage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/storage.ts
import { ChamConfig, defaultConfig } from './config';

const CONFIG_KEY = 'config';

export async function loadConfig(): Promise<ChamConfig> {
  const out = await chrome.storage.sync.get({ [CONFIG_KEY]: defaultConfig });
  return { ...defaultConfig, ...(out[CONFIG_KEY] as Partial<ChamConfig>) };
}

export async function saveConfig(patch: Partial<ChamConfig>): Promise<void> {
  const current = await loadConfig();
  const next: ChamConfig = { ...current, ...patch };
  await chrome.storage.sync.set({ [CONFIG_KEY]: next });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/storage.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage.ts src/lib/storage.test.ts
git commit -m "feat: add typed wrapper for chrome.storage config"
```

---

## Task 4: Default blocklist

**Files:**

- Create: `src/lib/default-blocklist.ts`
- Create: `src/lib/default-blocklist.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/default-blocklist.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/default-blocklist.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/default-blocklist.ts
// Sensible defaults. User can edit via the options page; we never override their list.

export const DEFAULT_DOMAIN_BLOCKLIST: readonly string[] = [
  // Webmail
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'mail.yahoo.com',
  'mail.proton.me',
  'protonmail.com',
  // Chat / messaging
  'web.whatsapp.com',
  'messages.google.com',
  'discord.com',
  'app.slack.com',
  // Internal / local
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  // Browser internals
  'chrome.google.com', // chrome web store
];

export const DEFAULT_URL_PATTERN_BLOCKLIST: readonly string[] = [
  '/admin',
  '/login',
  '/signin',
  '/signup',
  '/logout',
  '/account',
  '/settings',
  '/inbox',
  '/checkout',
  '/cart',
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/default-blocklist.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/default-blocklist.ts src/lib/default-blocklist.test.ts
git commit -m "feat: add default domain and URL-pattern blocklists"
```

---

## Task 5: URL matcher

**Files:**

- Create: `src/lib/url-matcher.ts`
- Create: `src/lib/url-matcher.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/url-matcher.test.ts
import { describe, it, expect } from 'vitest';
import { domainOf, matchesDomain, matchesAnyPattern, isLocalHost } from './url-matcher';

describe('url-matcher', () => {
  it('domainOf returns hostname', () => {
    expect(domainOf('https://www.nytimes.com/article')).toBe('www.nytimes.com');
    expect(domainOf('http://localhost:4000/x')).toBe('localhost');
  });

  it('matchesDomain treats list entries as suffix-matched on dot boundary', () => {
    expect(matchesDomain('https://www.nytimes.com/x', ['nytimes.com'])).toBe(true);
    expect(matchesDomain('https://nytimes.com/x', ['nytimes.com'])).toBe(true);
    expect(matchesDomain('https://evilnytimes.com/x', ['nytimes.com'])).toBe(false);
    expect(matchesDomain('https://example.com/x', ['nytimes.com'])).toBe(false);
  });

  it('matchesDomain matches localhost literally', () => {
    expect(matchesDomain('http://localhost:4000/x', ['localhost'])).toBe(true);
    expect(matchesDomain('http://127.0.0.1/x', ['127.0.0.1'])).toBe(true);
  });

  it('matchesAnyPattern checks URL substring', () => {
    expect(matchesAnyPattern('https://x.com/admin/users', ['/admin'])).toBe(true);
    expect(matchesAnyPattern('https://x.com/articles', ['/admin'])).toBe(false);
  });

  it('isLocalHost detects RFC1918 + .local + localhost', () => {
    expect(isLocalHost('http://localhost:4000/')).toBe(true);
    expect(isLocalHost('http://192.168.1.10/')).toBe(true);
    expect(isLocalHost('http://10.0.0.5/')).toBe(true);
    expect(isLocalHost('http://172.16.0.1/')).toBe(true);
    expect(isLocalHost('https://nas.local/')).toBe(true);
    expect(isLocalHost('https://nytimes.com/')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/url-matcher.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/url-matcher.ts
export function domainOf(urlStr: string): string {
  return new URL(urlStr).hostname;
}

export function matchesDomain(urlStr: string, domains: readonly string[]): boolean {
  const host = domainOf(urlStr);
  return domains.some((d) => host === d || host.endsWith('.' + d));
}

export function matchesAnyPattern(urlStr: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => urlStr.includes(p));
}

const RFC1918 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];

export function isLocalHost(urlStr: string): boolean {
  const host = domainOf(urlStr);
  if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return true;
  if (host.endsWith('.local')) return true;
  return RFC1918.some((re) => re.test(host));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/url-matcher.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/url-matcher.ts src/lib/url-matcher.test.ts
git commit -m "feat: add URL matcher with domain suffix + pattern + RFC1918 checks"
```

---

## Task 6: Cham client — auth-wall detection and error types

**Files:**

- Modify: `src/lib/cham-client.ts` (full rewrite)
- Modify: `src/lib/cham-client.test.ts` (extend)

- [ ] **Step 1: Extend the failing test**

Replace `src/lib/cham-client.test.ts` with:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitUrl, pingCham, SubmitError } from './cham-client';

const baseUrl = 'http://cham.local';

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });
}

describe('submitUrl', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('POSTs url and empty tags as JSON to /api/v1/items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'abc' }, { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitUrl({ baseUrl }, 'https://example.com/article');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://cham.local/api/v1/items');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ url: 'https://example.com/article', tags: [] });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(202);
  });

  it('detects Cloudflare Access redirect to cloudflareaccess.com', async () => {
    const cfResponse = new Response('<html>login</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
    Object.defineProperty(cfResponse, 'redirected', { value: true });
    Object.defineProperty(cfResponse, 'url', {
      value: 'https://example.cloudflareaccess.com/cdn-cgi/access/login',
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cfResponse));

    await expect(submitUrl({ baseUrl }, 'https://x.test')).rejects.toMatchObject({
      kind: 'auth-wall',
    } satisfies Partial<SubmitError>);
  });

  it('detects Www-Authenticate: Cloudflare-Access header', async () => {
    const r = new Response('{}', {
      status: 401,
      headers: { 'Www-Authenticate': 'Cloudflare-Access resource_metadata="..."' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(r));
    await expect(submitUrl({ baseUrl }, 'https://x.test')).rejects.toMatchObject({
      kind: 'auth-wall',
    });
  });

  it('treats non-JSON response as auth-wall (proxy injected a page)', async () => {
    const r = new Response('<html>login form</html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(r));
    await expect(submitUrl({ baseUrl }, 'https://x.test')).rejects.toMatchObject({
      kind: 'auth-wall',
    });
  });

  it('returns ok=false on Cham-side validation error (422)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, { status: 422 })),
    );
    const result = await submitUrl({ baseUrl }, 'https://x.test');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
  });

  it('throws network kind when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(submitUrl({ baseUrl }, 'https://x.test')).rejects.toMatchObject({
      kind: 'network',
    });
  });
});

describe('pingCham', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('returns ok on /health 200', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ status: 'ok' })));
    const r = await pingCham({ baseUrl });
    expect(r).toEqual({ status: 'ok' });
  });

  it('returns auth-wall when /health redirects off-origin', async () => {
    const cf = new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
    Object.defineProperty(cf, 'redirected', { value: true });
    Object.defineProperty(cf, 'url', { value: 'https://x.cloudflareaccess.com/login' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(cf));
    const r = await pingCham({ baseUrl });
    expect(r).toEqual({ status: 'auth-wall' });
  });

  it('returns unreachable when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const r = await pingCham({ baseUrl });
    expect(r).toEqual({ status: 'unreachable' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/cham-client.test.ts`
Expected: FAIL — `pingCham`, `SubmitError`, auth-wall detection don't exist yet.

- [ ] **Step 3: Implement**

Replace `src/lib/cham-client.ts`:

```ts
export interface ChamConfig {
  baseUrl: string;
}

export interface SubmitResult {
  ok: boolean;
  status: number;
  body: unknown;
}

export type SubmitErrorKind = 'network' | 'auth-wall' | 'bad-response';

export class SubmitError extends Error {
  constructor(
    public readonly kind: SubmitErrorKind,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
  }
}

export type PingResult =
  | { status: 'ok' }
  | { status: 'auth-wall' }
  | { status: 'unreachable' }
  | { status: 'error'; code: number };

function isCloudflareAuthWall(response: Response, baseUrl: string): boolean {
  const wwwAuth = response.headers.get('Www-Authenticate') ?? '';
  if (/Cloudflare-Access/i.test(wwwAuth)) return true;

  if (response.redirected) {
    try {
      const finalOrigin = new URL(response.url).origin;
      const expectedOrigin = new URL(baseUrl).origin;
      if (finalOrigin !== expectedOrigin) return true;
      if (/cloudflareaccess\.com$/i.test(new URL(response.url).hostname)) return true;
    } catch {
      // fall through
    }
  }

  const contentType = response.headers.get('Content-Type') ?? '';
  if (!/json/i.test(contentType)) return true;

  return false;
}

export async function submitUrl(
  config: ChamConfig,
  url: string,
  tags: string[] = [],
): Promise<SubmitResult> {
  const endpoint = new URL('/api/v1/items', config.baseUrl).toString();
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, tags }),
    });
  } catch (cause) {
    throw new SubmitError('network', `fetch failed: ${String(cause)}`, cause);
  }

  if (isCloudflareAuthWall(response, config.baseUrl)) {
    throw new SubmitError('auth-wall', 'Cham request hit an auth wall (likely Cloudflare Access)');
  }

  let body: unknown = null;
  try {
    body = await response.json();
  } catch (cause) {
    throw new SubmitError('bad-response', 'response not JSON', cause);
  }
  return { ok: response.ok, status: response.status, body };
}

export async function pingCham(config: ChamConfig): Promise<PingResult> {
  const endpoint = new URL('/health', config.baseUrl).toString();
  let response: Response;
  try {
    response = await fetch(endpoint, { method: 'GET' });
  } catch {
    return { status: 'unreachable' };
  }
  if (isCloudflareAuthWall(response, config.baseUrl)) return { status: 'auth-wall' };
  if (response.ok) return { status: 'ok' };
  return { status: 'error', code: response.status };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/cham-client.test.ts`
Expected: PASS, all 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cham-client.ts src/lib/cham-client.test.ts
git commit -m "feat(client): detect Cloudflare Access auth-wall, add pingCham + error types"
```

---

## Task 7: Persistent submission queue

**Files:**

- Create: `src/lib/queue.ts`
- Create: `src/lib/queue.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/queue.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/queue.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/queue.ts
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/queue.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/queue.ts src/lib/queue.test.ts
git commit -m "feat: add persistent submission queue with auth-wall awareness"
```

---

## Task 8: Readability classifier

**Files:**

- Modify: `package.json` (add `@mozilla/readability`)
- Create: `src/lib/readability-classifier.ts`
- Create: `src/lib/readability-classifier.test.ts`

- [ ] **Step 1: Install Readability**

Run: `npm install @mozilla/readability`
Expected: package installed, lockfile updated.

- [ ] **Step 2: Write the failing test**

```ts
// src/lib/readability-classifier.test.ts
import { describe, it, expect } from 'vitest';
import { classifyDocument } from './readability-classifier';

function makeArticleDoc(): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><head><title>Test Article</title></head>
     <body>
       <article>
         <h1>A Lengthy Article About Goldfish</h1>
         ${Array.from(
           { length: 30 },
           () =>
             '<p>Goldfish are remarkable creatures, and their memory is far better than commonly assumed. Researchers have documented complex behaviors that suggest substantial cognitive ability.</p>',
         ).join('')}
       </article>
     </body></html>`,
    'text/html',
  );
}

function makeInboxDoc(): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body>
       <ul>
         <li>From: alice — subject A</li>
         <li>From: bob — subject B</li>
       </ul>
     </body></html>`,
    'text/html',
  );
}

describe('classifyDocument', () => {
  it('returns isArticle=true for an article-like document', () => {
    const result = classifyDocument(makeArticleDoc());
    expect(result.isArticle).toBe(true);
  });

  it('returns isArticle=false for a short list-of-links document', () => {
    const result = classifyDocument(makeInboxDoc());
    expect(result.isArticle).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/readability-classifier.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

```ts
// src/lib/readability-classifier.ts
import { Readability, isProbablyReaderable } from '@mozilla/readability';

export interface ClassificationResult {
  isArticle: boolean;
  title?: string;
  excerpt?: string;
}

export function classifyDocument(doc: Document): ClassificationResult {
  if (!isProbablyReaderable(doc)) return { isArticle: false };

  const cloned = doc.cloneNode(true) as Document;
  const parsed = new Readability(cloned).parse();
  if (!parsed || !parsed.textContent || parsed.textContent.trim().length < 500) {
    return { isArticle: false };
  }
  return {
    isArticle: true,
    title: parsed.title ?? undefined,
    excerpt: parsed.excerpt ?? undefined,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/readability-classifier.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/readability-classifier.ts src/lib/readability-classifier.test.ts
git commit -m "feat: add Readability-based article classifier"
```

---

## Task 9: Decision pipeline

**Files:**

- Create: `src/lib/decision-pipeline.ts`
- Create: `src/lib/decision-pipeline.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/decision-pipeline.test.ts
import { describe, it, expect } from 'vitest';
import { decide, type Candidate } from './decision-pipeline';
import { defaultConfig } from './config';

const baseCandidate: Candidate = {
  url: 'https://nytimes.com/2026/05/article',
  isArticle: true,
};

describe('decide', () => {
  it('rejects URLs on the user blocklist', () => {
    const result = decide(
      { ...baseCandidate, url: 'https://mail.google.com/inbox' },
      { ...defaultConfig, neverDomains: [] },
    );
    expect(result.action).toBe('reject');
    expect(result.reason).toMatch(/blocklist/);
  });

  it('rejects URLs matching default pattern blocklist', () => {
    const result = decide({ ...baseCandidate, url: 'https://x.test/admin/users' }, defaultConfig);
    expect(result.action).toBe('reject');
    expect(result.reason).toMatch(/pattern/);
  });

  it('rejects non-articles', () => {
    const result = decide({ ...baseCandidate, isArticle: false }, defaultConfig);
    expect(result.action).toBe('reject');
    expect(result.reason).toMatch(/article/);
  });

  it('rejects local hosts (not the Cham base) outright', () => {
    const result = decide(
      { ...baseCandidate, url: 'http://192.168.1.10/something' },
      { ...defaultConfig, baseUrl: 'http://cham.example.com' },
    );
    expect(result.action).toBe('reject');
    expect(result.reason).toMatch(/local/);
  });

  it('rejects URLs on the user neverDomains list', () => {
    const result = decide(baseCandidate, { ...defaultConfig, neverDomains: ['nytimes.com'] });
    expect(result.action).toBe('reject');
  });

  it('archives URLs on the user optInDomains list', () => {
    const result = decide(baseCandidate, { ...defaultConfig, optInDomains: ['nytimes.com'] });
    expect(result.action).toBe('archive');
  });

  it('prompts otherwise', () => {
    const result = decide(baseCandidate, defaultConfig);
    expect(result.action).toBe('prompt');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/decision-pipeline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/decision-pipeline.ts
import { ChamConfig } from './config';
import { DEFAULT_DOMAIN_BLOCKLIST, DEFAULT_URL_PATTERN_BLOCKLIST } from './default-blocklist';
import { domainOf, matchesAnyPattern, matchesDomain, isLocalHost } from './url-matcher';

export interface Candidate {
  url: string;
  isArticle: boolean;
}

export type Decision =
  | { action: 'archive'; reason: string }
  | { action: 'prompt'; reason: string; domain: string }
  | { action: 'reject'; reason: string };

export function decide(candidate: Candidate, config: ChamConfig): Decision {
  const { url, isArticle } = candidate;

  if (matchesDomain(url, DEFAULT_DOMAIN_BLOCKLIST)) {
    return { action: 'reject', reason: `default domain blocklist (${domainOf(url)})` };
  }
  if (matchesAnyPattern(url, DEFAULT_URL_PATTERN_BLOCKLIST)) {
    return { action: 'reject', reason: 'default URL pattern blocklist' };
  }
  if (matchesDomain(url, config.neverDomains)) {
    return { action: 'reject', reason: `user neverDomains (${domainOf(url)})` };
  }
  if (isLocalHost(url)) {
    // Allow the configured Cham origin even if local
    try {
      const chamHost = config.baseUrl ? new URL(config.baseUrl).hostname : '';
      if (chamHost && domainOf(url) === chamHost) {
        // fall through — Cham itself never auto-archives but isn't blocked here either
      } else {
        return { action: 'reject', reason: 'local host' };
      }
    } catch {
      return { action: 'reject', reason: 'local host' };
    }
  }
  if (!isArticle) {
    return { action: 'reject', reason: 'not an article (Readability)' };
  }
  if (matchesDomain(url, config.optInDomains)) {
    return { action: 'archive', reason: 'user opt-in' };
  }
  return { action: 'prompt', reason: 'new domain', domain: domainOf(url) };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/decision-pipeline.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/decision-pipeline.ts src/lib/decision-pipeline.test.ts
git commit -m "feat: add decision pipeline composing blocklist + Readability + opt-in"
```

---

## Task 10: Message protocol

**Files:**

- Create: `src/lib/messaging.ts`
- Create: `src/lib/messaging.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/messaging.test.ts
import { describe, it, expect } from 'vitest';
import { isCandidateMessage, isOptInResponseMessage } from './messaging';

describe('messaging guards', () => {
  it('isCandidateMessage accepts valid candidate', () => {
    expect(
      isCandidateMessage({
        type: 'candidate',
        url: 'https://x/y',
        isArticle: true,
        title: 'X',
      }),
    ).toBe(true);
  });

  it('isCandidateMessage rejects unrelated shape', () => {
    expect(isCandidateMessage({ type: 'other' })).toBe(false);
    expect(isCandidateMessage(null)).toBe(false);
  });

  it('isOptInResponseMessage accepts all three choices', () => {
    for (const choice of ['always', 'once', 'never'] as const) {
      expect(isOptInResponseMessage({ type: 'opt-in-response', domain: 'x.com', choice })).toBe(
        true,
      );
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/messaging.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/messaging.ts
export type OptInChoice = 'always' | 'once' | 'never';

export interface CandidateMessage {
  type: 'candidate';
  url: string;
  isArticle: boolean;
  title?: string;
}

export interface OptInResponseMessage {
  type: 'opt-in-response';
  domain: string;
  choice: OptInChoice;
}

export interface ManualArchiveMessage {
  type: 'manual-archive';
  url: string;
}

export type Message = CandidateMessage | OptInResponseMessage | ManualArchiveMessage;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export function isCandidateMessage(v: unknown): v is CandidateMessage {
  return (
    isRecord(v) &&
    v.type === 'candidate' &&
    typeof v.url === 'string' &&
    typeof v.isArticle === 'boolean'
  );
}

export function isOptInResponseMessage(v: unknown): v is OptInResponseMessage {
  return (
    isRecord(v) &&
    v.type === 'opt-in-response' &&
    typeof v.domain === 'string' &&
    (v.choice === 'always' || v.choice === 'once' || v.choice === 'never')
  );
}

export function isManualArchiveMessage(v: unknown): v is ManualArchiveMessage {
  return isRecord(v) && v.type === 'manual-archive' && typeof v.url === 'string';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/messaging.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/messaging.ts src/lib/messaging.test.ts
git commit -m "feat: add typed messaging protocol with runtime guards"
```

---

## Task 11: Logger

**Files:**

- Create: `src/lib/logger.ts`

- [ ] **Step 1: Implement (no tests; trivial)**

```ts
// src/lib/logger.ts
const PREFIX = '[cham]';

export const log = {
  info: (...args: unknown[]) => console.info(PREFIX, ...args),
  warn: (...args: unknown[]) => console.warn(PREFIX, ...args),
  error: (...args: unknown[]) => console.error(PREFIX, ...args),
  debug: (...args: unknown[]) => console.debug(PREFIX, ...args),
};
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/logger.ts
git commit -m "feat: add prefixed logger"
```

---

## Task 12: Drain loop

**Files:**

- Create: `src/background/drain.ts`
- Create: `src/background/drain.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/background/drain.test.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/background/drain.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/background/drain.ts
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
    if (item.status === 'needs_auth') continue; // wait for nav-listener trigger
    try {
      const result = await submitUrl({ baseUrl: config.baseUrl }, item.url);
      if (result.ok || result.status === 409) {
        // 409 = already exists, treat as done
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
  // Reset needs_auth → pending so drainOnce will retry them
  for (const item of items) {
    if (item.status === 'needs_auth') {
      await markFailed(item.id, ''); // bump attempts; status reset handled below
    }
  }
  // Direct write: clear needs_auth status
  const refreshed = await listQueue();
  await chrome.storage.local.set({
    queue: refreshed.map((it) => (it.status === 'needs_auth' ? { ...it, status: 'pending' } : it)),
  });
  await drainOnce();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/background/drain.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/background/drain.ts src/background/drain.test.ts
git commit -m "feat: add drain loop driven by alarms and online events"
```

---

## Task 13: Nav listener (drain on Cham origin visit)

**Files:**

- Create: `src/background/nav-listener.ts`
- Create: `src/background/nav-listener.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/background/nav-listener.test.ts
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

  // Smoke test: listener registers without throwing
  it('registerNavListener attaches once', async () => {
    const { registerNavListener } = await import('./nav-listener');
    const addListener = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).chrome.webNavigation = { onCompleted: { addListener } };
    registerNavListener();
    expect(addListener).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/background/nav-listener.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/background/nav-listener.ts
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
      if (details.frameId !== 0) return; // main frame only
      const config = await loadConfig();
      if (isChamOriginUrl(details.url, config.baseUrl)) {
        log.info('Cham origin visited; draining needs_auth queue');
        await drainNeedsAuth();
      }
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/background/nav-listener.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/background/nav-listener.ts src/background/nav-listener.test.ts
git commit -m "feat: drain needs_auth queue when user visits Cham origin"
```

---

## Task 14: Service worker — wire everything

**Files:**

- Modify: `src/background/service-worker.ts` (full rewrite)

- [ ] **Step 1: Implement**

```ts
// src/background/service-worker.ts
import { startDrainScheduler, drainOnce } from './drain';
import { registerNavListener } from './nav-listener';
import { loadConfig, saveConfig } from '../lib/storage';
import { decide } from '../lib/decision-pipeline';
import { domainOf } from '../lib/url-matcher';
import {
  isCandidateMessage,
  isOptInResponseMessage,
  isManualArchiveMessage,
} from '../lib/messaging';
import { enqueue, hasRecentlyQueued } from '../lib/queue';
import { log } from '../lib/logger';

chrome.runtime.onInstalled.addListener(() => log.info('Cham Archiver installed'));

startDrainScheduler();
registerNavListener();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (isCandidateMessage(msg)) {
        const config = await loadConfig();
        if (await hasRecentlyQueued(msg.url)) {
          sendResponse({ action: 'reject', reason: 'recently queued' });
          return;
        }
        const decision = decide({ url: msg.url, isArticle: msg.isArticle }, config);
        if (decision.action === 'archive') {
          await enqueue(msg.url);
          void drainOnce();
        }
        sendResponse(decision);
      } else if (isOptInResponseMessage(msg)) {
        const config = await loadConfig();
        if (msg.choice === 'always') {
          await saveConfig({ optInDomains: [...config.optInDomains, msg.domain] });
        } else if (msg.choice === 'never') {
          await saveConfig({ neverDomains: [...config.neverDomains, msg.domain] });
        }
        if (msg.choice === 'always' || msg.choice === 'once') {
          const tab = sender.tab;
          if (tab?.url && domainOf(tab.url) === msg.domain) {
            await enqueue(tab.url);
            void drainOnce();
          }
        }
        sendResponse({ ok: true });
      } else if (isManualArchiveMessage(msg)) {
        await enqueue(msg.url);
        void drainOnce();
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: 'unknown message' });
      }
    } catch (err) {
      log.error('service worker message handler failed', err);
      sendResponse({ error: String(err) });
    }
  })();
  return true; // async response
});
```

- [ ] **Step 2: Build to verify type-check**

Run: `npm run build`
Expected: build succeeds, no type errors.

- [ ] **Step 3: Commit**

```bash
git add src/background/service-worker.ts
git commit -m "feat: wire service worker pipeline + messaging"
```

---

## Task 15: Dwell tracker (content script)

**Files:**

- Create: `src/content/dwell-tracker.ts`
- Create: `src/content/dwell-tracker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/content/dwell-tracker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DwellTracker } from './dwell-tracker';

describe('DwellTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('fires onTrigger after dwell threshold + scroll threshold met', () => {
    const onTrigger = vi.fn();
    const tracker = new DwellTracker({
      dwellMs: 1000,
      scrollPct: 0.3,
      onTrigger,
      getScrollPct: () => 0.5,
    });
    tracker.start();
    vi.advanceTimersByTime(1100);
    tracker.tick(); // poll
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it('does not fire if scroll threshold not met', () => {
    const onTrigger = vi.fn();
    const tracker = new DwellTracker({
      dwellMs: 1000,
      scrollPct: 0.5,
      onTrigger,
      getScrollPct: () => 0.1,
    });
    tracker.start();
    vi.advanceTimersByTime(2000);
    tracker.tick();
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('does not fire twice', () => {
    const onTrigger = vi.fn();
    const tracker = new DwellTracker({
      dwellMs: 100,
      scrollPct: 0,
      onTrigger,
      getScrollPct: () => 1,
    });
    tracker.start();
    vi.advanceTimersByTime(200);
    tracker.tick();
    tracker.tick();
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it('pauses dwell accumulation when hidden', () => {
    const onTrigger = vi.fn();
    const tracker = new DwellTracker({
      dwellMs: 1000,
      scrollPct: 0,
      onTrigger,
      getScrollPct: () => 1,
    });
    tracker.start();
    vi.advanceTimersByTime(500);
    tracker.setVisible(false);
    vi.advanceTimersByTime(2000); // these ms don't count
    tracker.setVisible(true);
    vi.advanceTimersByTime(400);
    tracker.tick();
    expect(onTrigger).not.toHaveBeenCalled(); // only 900ms accumulated
    vi.advanceTimersByTime(200);
    tracker.tick();
    expect(onTrigger).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/content/dwell-tracker.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/content/dwell-tracker.ts
export interface DwellTrackerOptions {
  dwellMs: number;
  scrollPct: number;
  onTrigger: () => void;
  getScrollPct: () => number;
}

export class DwellTracker {
  private accumulatedMs = 0;
  private lastResumeAt: number | null = null;
  private visible = true;
  private fired = false;

  constructor(private readonly opts: DwellTrackerOptions) {}

  start(): void {
    this.lastResumeAt = Date.now();
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    if (visible) {
      this.lastResumeAt = Date.now();
    } else {
      if (this.lastResumeAt !== null) {
        this.accumulatedMs += Date.now() - this.lastResumeAt;
        this.lastResumeAt = null;
      }
    }
    this.visible = visible;
  }

  tick(): void {
    if (this.fired) return;
    const now = Date.now();
    const total = this.accumulatedMs + (this.lastResumeAt !== null ? now - this.lastResumeAt : 0);
    if (total >= this.opts.dwellMs && this.opts.getScrollPct() >= this.opts.scrollPct) {
      this.fired = true;
      this.opts.onTrigger();
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/content/dwell-tracker.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/content/dwell-tracker.ts src/content/dwell-tracker.test.ts
git commit -m "feat: add dwell tracker (visibility-aware + scroll-gated)"
```

---

## Task 16: Opt-in banner

**Files:**

- Create: `src/content/opt-in-banner.ts`
- Create: `src/content/opt-in-banner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/content/opt-in-banner.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showOptInBanner } from './opt-in-banner';

describe('showOptInBanner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('appends a banner element to the body', () => {
    showOptInBanner({ domain: 'nytimes.com', onChoice: vi.fn() });
    expect(document.querySelector('[data-cham-banner]')).not.toBeNull();
  });

  it('clicking Always calls onChoice with always and removes banner', () => {
    const onChoice = vi.fn();
    showOptInBanner({ domain: 'nytimes.com', onChoice });
    const alwaysBtn = document.querySelector<HTMLButtonElement>('[data-cham-choice="always"]')!;
    alwaysBtn.click();
    expect(onChoice).toHaveBeenCalledWith('always');
    expect(document.querySelector('[data-cham-banner]')).toBeNull();
  });

  it('clicking Never calls onChoice with never', () => {
    const onChoice = vi.fn();
    showOptInBanner({ domain: 'nytimes.com', onChoice });
    document.querySelector<HTMLButtonElement>('[data-cham-choice="never"]')!.click();
    expect(onChoice).toHaveBeenCalledWith('never');
  });

  it('clicking Once calls onChoice with once', () => {
    const onChoice = vi.fn();
    showOptInBanner({ domain: 'nytimes.com', onChoice });
    document.querySelector<HTMLButtonElement>('[data-cham-choice="once"]')!.click();
    expect(onChoice).toHaveBeenCalledWith('once');
  });

  it('does not show twice for the same domain in the same page', () => {
    showOptInBanner({ domain: 'x.com', onChoice: vi.fn() });
    showOptInBanner({ domain: 'x.com', onChoice: vi.fn() });
    expect(document.querySelectorAll('[data-cham-banner]')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/content/opt-in-banner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// src/content/opt-in-banner.ts
import type { OptInChoice } from '../lib/messaging';

export interface OptInBannerOpts {
  domain: string;
  onChoice: (choice: OptInChoice) => void;
}

export function showOptInBanner({ domain, onChoice }: OptInBannerOpts): void {
  if (document.querySelector('[data-cham-banner]')) return;

  const root = document.createElement('div');
  root.setAttribute('data-cham-banner', '');
  Object.assign(root.style, {
    position: 'fixed',
    bottom: '16px',
    right: '16px',
    zIndex: '2147483647',
    background: '#1f1f1f',
    color: '#fff',
    padding: '12px 14px',
    borderRadius: '8px',
    boxShadow: '0 6px 24px rgba(0,0,0,0.3)',
    font: '14px system-ui, sans-serif',
    maxWidth: '320px',
  });

  const msg = document.createElement('div');
  msg.textContent = `Auto-archive articles from ${domain} to Cham?`;
  msg.style.marginBottom = '10px';
  root.appendChild(msg);

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '6px';

  function btn(label: string, choice: OptInChoice): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.setAttribute('data-cham-choice', choice);
    Object.assign(b.style, {
      padding: '6px 10px',
      borderRadius: '4px',
      border: '1px solid #555',
      background: '#333',
      color: '#fff',
      cursor: 'pointer',
      font: 'inherit',
    });
    b.addEventListener('click', () => {
      root.remove();
      onChoice(choice);
    });
    return b;
  }

  row.appendChild(btn('Always', 'always'));
  row.appendChild(btn('Just this one', 'once'));
  row.appendChild(btn('Never', 'never'));
  root.appendChild(row);

  document.body.appendChild(root);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/content/opt-in-banner.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/content/opt-in-banner.ts src/content/opt-in-banner.test.ts
git commit -m "feat: add in-page opt-in banner UI"
```

---

## Task 17: Content script entrypoint

**Files:**

- Modify: `src/manifest.json` (register content script)
- Create: `src/content/index.ts`

- [ ] **Step 1: Register the content script**

Replace `src/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Cham Archiver",
  "version": "0.1.0",
  "description": "Archive browsed articles to your Cham instance.",
  "permissions": ["activeTab", "storage", "alarms", "notifications", "webNavigation"],
  "host_permissions": ["http://*/*", "https://*/*"],
  "action": {
    "default_popup": "src/popup/index.html",
    "default_title": "Archive to Cham"
  },
  "background": {
    "service_worker": "src/background/service-worker.ts",
    "type": "module"
  },
  "options_ui": {
    "page": "src/options/index.html",
    "open_in_tab": true
  },
  "content_scripts": [
    {
      "matches": ["http://*/*", "https://*/*"],
      "js": ["src/content/index.ts"],
      "run_at": "document_idle"
    }
  ]
}
```

- [ ] **Step 2: Implement entrypoint**

```ts
// src/content/index.ts
import { DwellTracker } from './dwell-tracker';
import { showOptInBanner } from './opt-in-banner';
import { classifyDocument } from '../lib/readability-classifier';
import type { CandidateMessage, OptInResponseMessage, Decision } from '../lib/messaging';
import { loadConfig } from '../lib/storage';
import { log } from '../lib/logger';

function getScrollPct(): number {
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  if (max <= 0) return 1;
  return Math.min(1, Math.max(0, window.scrollY / max));
}

async function main() {
  if (window.top !== window) return; // skip iframes
  const config = await loadConfig();

  const tracker = new DwellTracker({
    dwellMs: config.dwellMs,
    scrollPct: config.scrollPct,
    getScrollPct,
    onTrigger: () => void considerCurrentPage(),
  });
  tracker.start();

  document.addEventListener('visibilitychange', () => tracker.setVisible(!document.hidden));
  setInterval(() => tracker.tick(), 1000);
}

async function considerCurrentPage(): Promise<void> {
  const { isArticle, title } = classifyDocument(document);
  const msg: CandidateMessage = {
    type: 'candidate',
    url: location.href,
    isArticle,
    title,
  };
  let decision: Decision;
  try {
    decision = (await chrome.runtime.sendMessage(msg)) as Decision;
  } catch (err) {
    log.warn('candidate send failed', err);
    return;
  }
  if (!decision) return;
  if (decision.action === 'prompt') {
    showOptInBanner({
      domain: decision.domain,
      onChoice: async (choice) => {
        const response: OptInResponseMessage = {
          type: 'opt-in-response',
          domain: decision.domain,
          choice,
        };
        await chrome.runtime.sendMessage(response);
      },
    });
  }
}

void main();
```

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/manifest.json src/content/index.ts
git commit -m "feat: content script entrypoint wires dwell + Readability + banner"
```

---

## Task 18: Options page

**Files:**

- Modify: `src/options/index.html`
- Modify: `src/options/options.ts`

- [ ] **Step 1: Implement HTML**

Replace `src/options/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Cham Archiver — Options</title>
    <style>
      body {
        font:
          14px system-ui,
          sans-serif;
        max-width: 640px;
        margin: 32px auto;
        padding: 0 16px;
      }
      h1 {
        font-size: 20px;
      }
      label {
        display: block;
        margin-top: 16px;
        font-weight: 600;
      }
      input[type='text'],
      textarea {
        width: 100%;
        padding: 6px 8px;
        box-sizing: border-box;
        font: inherit;
      }
      textarea {
        min-height: 96px;
        resize: vertical;
      }
      .row {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-top: 12px;
      }
      button {
        padding: 6px 12px;
        cursor: pointer;
      }
      .status {
        margin-left: 8px;
      }
      .ok {
        color: #197d3a;
      }
      .err {
        color: #b00020;
      }
      .warn {
        color: #a86b00;
      }
    </style>
  </head>
  <body>
    <h1>Cham Archiver</h1>

    <label for="baseUrl">Cham base URL</label>
    <input id="baseUrl" type="text" placeholder="https://cham.example.com" />

    <div class="row">
      <button id="test">Test connection</button>
      <span id="status" class="status"></span>
    </div>

    <label for="optIn">Auto-archive domains (one per line)</label>
    <textarea id="optIn"></textarea>

    <label for="never">Never archive these domains (one per line)</label>
    <textarea id="never"></textarea>

    <div class="row">
      <button id="save">Save</button>
      <span id="saveStatus" class="status"></span>
    </div>

    <script type="module" src="./options.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Implement script**

Replace `src/options/options.ts`:

```ts
import { loadConfig, saveConfig } from '../lib/storage';
import { isValidBaseUrl, normalizeBaseUrl } from '../lib/config';
import { pingCham } from '../lib/cham-client';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function linesToList(s: string): string[] {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function hydrate(): Promise<void> {
  const config = await loadConfig();
  $<HTMLInputElement>('baseUrl').value = config.baseUrl;
  $<HTMLTextAreaElement>('optIn').value = config.optInDomains.join('\n');
  $<HTMLTextAreaElement>('never').value = config.neverDomains.join('\n');
}

async function onTest(): Promise<void> {
  const status = $('status');
  const raw = $<HTMLInputElement>('baseUrl').value.trim();
  const baseUrl = normalizeBaseUrl(raw);
  if (!isValidBaseUrl(baseUrl)) {
    status.textContent = 'Invalid URL';
    status.className = 'status err';
    return;
  }
  status.textContent = 'Testing…';
  status.className = 'status';
  const result = await pingCham({ baseUrl });
  switch (result.status) {
    case 'ok':
      status.textContent = 'OK — Cham reachable';
      status.className = 'status ok';
      break;
    case 'auth-wall':
      status.textContent = 'Auth wall (Cloudflare Access?) — open Cham in a tab and try again';
      status.className = 'status warn';
      break;
    case 'unreachable':
      status.textContent = 'Unreachable (network error)';
      status.className = 'status err';
      break;
    case 'error':
      status.textContent = `Server returned HTTP ${result.code}`;
      status.className = 'status err';
      break;
  }
}

async function onSave(): Promise<void> {
  const status = $('saveStatus');
  const baseUrl = normalizeBaseUrl($<HTMLInputElement>('baseUrl').value.trim());
  if (baseUrl && !isValidBaseUrl(baseUrl)) {
    status.textContent = 'Invalid base URL';
    status.className = 'status err';
    return;
  }
  await saveConfig({
    baseUrl,
    optInDomains: linesToList($<HTMLTextAreaElement>('optIn').value),
    neverDomains: linesToList($<HTMLTextAreaElement>('never').value),
  });
  status.textContent = 'Saved';
  status.className = 'status ok';
  setTimeout(() => {
    status.textContent = '';
  }, 2000);
}

void hydrate();
$('test').addEventListener('click', () => void onTest());
$('save').addEventListener('click', () => void onSave());
```

- [ ] **Step 3: Build to verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/options/index.html src/options/options.ts
git commit -m "feat: options page with connection test and list editors"
```

---

## Task 19: Popup

**Files:**

- Modify: `src/popup/index.html`
- Modify: `src/popup/popup.ts`

- [ ] **Step 1: Implement HTML**

Replace `src/popup/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Cham Archiver</title>
    <style>
      body {
        font:
          13px system-ui,
          sans-serif;
        width: 280px;
        padding: 12px;
        margin: 0;
      }
      h1 {
        font-size: 14px;
        margin: 0 0 6px;
      }
      .url {
        color: #666;
        word-break: break-all;
        margin-bottom: 10px;
        font-size: 12px;
      }
      button {
        display: block;
        width: 100%;
        padding: 6px 8px;
        margin-top: 6px;
        cursor: pointer;
        font: inherit;
      }
      .status {
        margin-top: 8px;
        font-size: 12px;
      }
      .ok {
        color: #197d3a;
      }
      .err {
        color: #b00020;
      }
    </style>
  </head>
  <body>
    <h1>Cham Archiver</h1>
    <div class="url" id="url">…</div>
    <button id="archive">Archive this page</button>
    <button id="always">Always archive this domain</button>
    <button id="never">Never archive this domain</button>
    <div class="status" id="status"></div>
    <script type="module" src="./popup.ts"></script>
  </body>
</html>
```

- [ ] **Step 2: Implement script**

Replace `src/popup/popup.ts`:

```ts
import { loadConfig, saveConfig } from '../lib/storage';
import { domainOf } from '../lib/url-matcher';
import type { ManualArchiveMessage } from '../lib/messaging';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setStatus(text: string, cls: 'ok' | 'err' | '' = ''): void {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${cls}`;
}

async function main(): Promise<void> {
  const tab = await getActiveTab();
  const url = tab?.url ?? '';
  $('url').textContent = url || '(no active tab)';

  if (!url || !/^https?:/.test(url)) {
    for (const id of ['archive', 'always', 'never']) {
      ($(id) as HTMLButtonElement).disabled = true;
    }
    setStatus('Only http(s) URLs supported');
    return;
  }
  const domain = domainOf(url);

  $('archive').addEventListener('click', async () => {
    const msg: ManualArchiveMessage = { type: 'manual-archive', url };
    await chrome.runtime.sendMessage(msg);
    setStatus('Queued for archive', 'ok');
  });

  $('always').addEventListener('click', async () => {
    const config = await loadConfig();
    if (!config.optInDomains.includes(domain)) {
      await saveConfig({ optInDomains: [...config.optInDomains, domain] });
    }
    setStatus(`Always archiving ${domain}`, 'ok');
  });

  $('never').addEventListener('click', async () => {
    const config = await loadConfig();
    if (!config.neverDomains.includes(domain)) {
      await saveConfig({ neverDomains: [...config.neverDomains, domain] });
    }
    setStatus(`Never archiving ${domain}`, 'ok');
  });
}

void main();
```

- [ ] **Step 3: Add tabs permission**

Edit `src/manifest.json` to add `"tabs"` to the `permissions` array:

```json
  "permissions": ["activeTab", "tabs", "storage", "alarms", "notifications", "webNavigation"],
```

- [ ] **Step 4: Build to verify**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/popup/index.html src/popup/popup.ts src/manifest.json
git commit -m "feat: popup with manual archive and per-domain quick toggles"
```

---

## Task 20: End-to-end manual verification

**Files:** (no code changes — a checklist commit)

- Modify: `README.md`

- [ ] **Step 1: Run the full quality gate**

Run: `npm run lint && npm test && npm run build`
Expected: all green.

- [ ] **Step 2: Load the unpacked extension**

1. `npm run build` produces `dist/`.
2. Open `chrome://extensions`, enable Developer Mode, click "Load unpacked", select `dist/`.
3. Open the options page from the extensions menu. Set base URL to a running Cham instance (e.g. `http://localhost:4000`). Click "Test connection" — expect "OK".

- [ ] **Step 3: Verify each behavior**

Manually verify:

- [ ] Visit `mail.google.com` for a minute, scroll — no banner, no archive.
- [ ] Visit any URL containing `/admin` — no banner, no archive.
- [ ] Visit a news article on a fresh domain, dwell + scroll past threshold — banner appears with Always / Just this one / Never.
- [ ] Click "Always" — banner dismisses, item appears on Cham dashboard, that domain auto-archives on the next article you visit.
- [ ] Click extension icon on a page → manual "Archive this page" enqueues.
- [ ] Stop Cham. Trigger an archive. Reopen `chrome://extensions` and inspect the service worker console — see queue retain the entry. Start Cham; within 5 minutes the entry drains, or trigger a network "online" event.
- [ ] Put Cham behind Cloudflare Access (or simulate by editing `cham-client.ts` to force `auth-wall`). Trigger an archive — queue marks `needs_auth`. Visit the Cham UI URL in a new tab — queue drains automatically.

- [ ] **Step 4: Update README with verified install/testing instructions**

Append to `README.md` after the existing "Development" section:

```markdown
## Testing the extension manually

After `npm run build`:

1. Visit `chrome://extensions`, enable Developer Mode.
2. "Load unpacked" → select `dist/`.
3. Open the options page; set the Cham base URL and click "Test connection".
4. Browse normally; the extension auto-queues articles on opted-in domains and prompts on new ones.
5. The toolbar icon opens the popup with manual archive and per-domain toggles.

## Architecture

See [`docs/superpowers/plans/2026-05-12-auto-archive-with-opt-in.md`](docs/superpowers/plans/2026-05-12-auto-archive-with-opt-in.md) for the design.
```

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: add manual verification checklist and architecture pointer"
```

- [ ] **Step 6: Push and confirm CI**

```bash
git push
gh run list --limit 1
```

Expected: latest CI run shows `success`.

---

## Notes for the implementer

- The plan is strictly TDD for `src/lib/` and the dwell tracker; UI files (popup, options, banner) are tested at the unit level only where pure logic is involved. The opt-in banner has DOM tests in jsdom; popup/options are verified end-to-end in Chrome.
- Submit URLs as `{url, tags: []}` — Cham auto-derives tags from content. Do not synthesize tags client-side.
- The current version sends URLs only. The `host_permissions` granted here are sufficient for future work where the content script also captures DOM/resources for paywalled pages.
- Backoff: the current `drainOnce` retries every 5 minutes regardless of attempt count. If queue entries pile up with persistent errors, consider adding exponential backoff in a follow-up — but only if it becomes a problem.
- No auth-signal heuristic — explicitly out of scope (would reject legitimate paywalled articles).
