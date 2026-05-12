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
