import { submitUrl, type ChamConfig } from '../lib/cham-client.js';

async function getConfig(): Promise<ChamConfig | null> {
  const { chamConfig } = await chrome.storage.sync.get('chamConfig');
  const baseUrl = (chamConfig as { baseUrl?: string } | undefined)?.baseUrl;
  return baseUrl ? { baseUrl } : null;
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function sameHost(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

function render(message: string, action?: { label: string; onClick: () => void }): void {
  const body = document.body;
  body.innerHTML = '';
  const h1 = document.createElement('h1');
  h1.textContent = 'Cham';
  body.append(h1);
  const p = document.createElement('p');
  p.textContent = message;
  body.append(p);
  if (action) {
    const button = document.createElement('button');
    button.textContent = action.label;
    button.addEventListener('click', action.onClick);
    body.append(button);
  }
}

async function init(): Promise<void> {
  const config = await getConfig();
  if (!config) {
    render('Cham is not configured.', {
      label: 'Open options',
      onClick: () => chrome.runtime.openOptionsPage(),
    });
    return;
  }
  const tab = await getActiveTab();
  if (!tab?.url) {
    render('No active tab to archive.');
    return;
  }
  if (sameHost(tab.url, config.baseUrl)) {
    render('This page is your Cham instance — nothing to archive.');
    return;
  }
  const url = tab.url;
  render(`Archive: ${url}`, {
    label: 'Archive to Cham',
    onClick: () => {
      void submitUrl(config, url);
    },
  });
}

void init();
