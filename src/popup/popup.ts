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
