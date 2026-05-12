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
