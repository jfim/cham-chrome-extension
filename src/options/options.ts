import { loadConfig, saveConfig } from '../lib/storage';
import { isValidBaseUrl, normalizeBaseUrl } from '../lib/config';
import { pingCham } from '../lib/cham-client';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function linesToList(s: string): string[] {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

async function hydrate(): Promise<void> {
  const config = await loadConfig();
  $<HTMLInputElement>('baseUrl').value = config.baseUrl;
  $<HTMLTextAreaElement>('optIn').value = config.optInDomains.join('\n');
  $<HTMLTextAreaElement>('never').value = config.neverDomains.join('\n');
}

async function onTest(): Promise<void> {
  const status = $('status');
  const raw = $<HTMLInputElement>('baseUrl').value.trim();
  const baseUrl = normalizeBaseUrl(raw);
  if (!isValidBaseUrl(baseUrl)) {
    status.textContent = 'Invalid URL';
    status.className = 'status err';
    return;
  }
  status.textContent = 'Testing…';
  status.className = 'status';
  const result = await pingCham({ baseUrl });
  switch (result.status) {
    case 'ok':
      status.textContent = 'OK — Cham reachable';
      status.className = 'status ok';
      break;
    case 'auth-wall':
      status.textContent = 'Auth wall (Cloudflare Access?) — open Cham in a tab and try again';
      status.className = 'status warn';
      break;
    case 'unreachable':
      status.textContent = 'Unreachable (network error)';
      status.className = 'status err';
      break;
    case 'error':
      status.textContent = `Server returned HTTP ${result.code}`;
      status.className = 'status err';
      break;
  }
}

async function onSave(): Promise<void> {
  const status = $('saveStatus');
  const baseUrl = normalizeBaseUrl($<HTMLInputElement>('baseUrl').value.trim());
  if (baseUrl && !isValidBaseUrl(baseUrl)) {
    status.textContent = 'Invalid base URL';
    status.className = 'status err';
    return;
  }
  await saveConfig({
    baseUrl,
    optInDomains: linesToList($<HTMLTextAreaElement>('optIn').value),
    neverDomains: linesToList($<HTMLTextAreaElement>('never').value),
  });
  status.textContent = 'Saved';
  status.className = 'status ok';
  setTimeout(() => {
    status.textContent = '';
  }, 2000);
}

void hydrate();
$('test').addEventListener('click', () => void onTest());
$('save').addEventListener('click', () => void onSave());
