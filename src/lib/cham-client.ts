export interface ChamConfig {
  baseUrl: string;
}

export interface SubmitResult {
  ok: boolean;
  status: number;
  body: unknown;
}

export async function submitUrl(
  config: ChamConfig,
  url: string,
  tags: string[] = [],
): Promise<SubmitResult> {
  const endpoint = new URL('/api/v1/items', config.baseUrl).toString();
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, tags }),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}
