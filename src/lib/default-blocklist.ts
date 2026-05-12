export const DEFAULT_DOMAIN_BLOCKLIST: readonly string[] = [
  'mail.google.com',
  'outlook.live.com',
  'outlook.office.com',
  'outlook.office365.com',
  'mail.yahoo.com',
  'mail.proton.me',
  'protonmail.com',
  'web.whatsapp.com',
  'messages.google.com',
  'discord.com',
  'app.slack.com',
  'chrome.google.com',
];
// Localhost/RFC1918/.local hosts are handled by isLocalHost in url-matcher,
// which the decision pipeline applies after the domain blocklist so that the
// user's Cham instance can still be reached when it runs on a local host.

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
