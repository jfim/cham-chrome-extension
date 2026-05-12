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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'bad' }, { status: 422 })));
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
