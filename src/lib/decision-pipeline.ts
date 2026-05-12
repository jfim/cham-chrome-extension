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
    try {
      const chamHost = config.baseUrl ? new URL(config.baseUrl).hostname : '';
      if (!(chamHost && domainOf(url) === chamHost)) {
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
