import { describe, it, expect, vi, beforeEach } from 'vitest';
import { submitUrl } from './cham-client';

describe('submitUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs url and tags as JSON to /api/v1/items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: 'abc' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await submitUrl(
      { baseUrl: 'http://localhost:4000' },
      'https://example.com/article',
      ['news'],
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:4000/api/v1/items');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({
      url: 'https://example.com/article',
      tags: ['news'],
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(202);
  });

  it('returns ok=false on server error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{"error":"bad"}', { status: 422 })),
    );
    const result = await submitUrl({ baseUrl: 'http://localhost:4000' }, 'https://x.test');
    expect(result.ok).toBe(false);
    expect(result.status).toBe(422);
  });
});
