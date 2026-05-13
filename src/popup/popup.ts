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

interface QueueItem {
  url: string;
  title?: string;
  ts: number;
}

async function getQueue(): Promise<QueueItem[]> {
  const { queue } = await chrome.storage.local.get('queue');
  return Array.isArray(queue) ? (queue as QueueItem[]) : [];
}

function renderQueueSection(container: HTMLElement, queue: QueueItem[]): void {
  const section = document.createElement('section');
  section.className = 'queue';
  const summary = document.createElement('button');
  summary.type = 'button';
  summary.className = 'queue-summary';
  summary.textContent = `${queue.length} item${queue.length === 1 ? '' : 's'} queued`;
  section.append(summary);

  const list = document.createElement('ul');
  list.className = 'queue-list';
  list.hidden = true;
  if (queue.length === 0) {
    const li = document.createElement('li');
    li.className = 'queue-empty';
    li.textContent = 'Queue is empty.';
    list.append(li);
  } else {
    for (const item of queue) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = item.url;
      a.target = '_blank';
      a.rel = 'noreferrer noopener';
      a.textContent = item.title?.trim() || item.url;
      a.title = item.url;
      li.append(a);
      list.append(li);
    }
  }
  section.append(list);
  summary.addEventListener('click', () => {
    list.hidden = !list.hidden;
  });
  container.append(section);
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
  const queue = await getQueue();
  renderQueueSection(document.body, queue);
}

void init();
