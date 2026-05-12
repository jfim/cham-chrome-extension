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
    public override readonly cause?: unknown,
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

  const contentType = response.headers.get('Content-Type');
  if (contentType && !/json/i.test(contentType)) return true;

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
