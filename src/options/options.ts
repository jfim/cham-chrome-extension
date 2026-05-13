interface ChamConfig {
  baseUrl: string;
  includedDomains: string[];
  excludedDomains: string[];
}

function isValidBaseUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseDomains(value: string): string[] {
  return value
    .split('\n')
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l.length > 0);
}

async function hydrate(): Promise<void> {
  const { chamConfig } = await chrome.storage.sync.get('chamConfig');
  const cfg = (chamConfig ?? {}) as Partial<ChamConfig>;
  (document.getElementById('baseUrl') as HTMLInputElement).value = cfg.baseUrl ?? '';
  (document.getElementById('included') as HTMLTextAreaElement).value = (
    cfg.includedDomains ?? []
  ).join('\n');
  (document.getElementById('excluded') as HTMLTextAreaElement).value = (
    cfg.excludedDomains ?? []
  ).join('\n');
}

async function onSave(): Promise<void> {
  const status = document.getElementById('status') as HTMLParagraphElement;
  const baseUrl = (document.getElementById('baseUrl') as HTMLInputElement).value
    .trim()
    .replace(/\/$/, '');
  if (!baseUrl || !isValidBaseUrl(baseUrl)) {
    status.textContent = 'Enter a valid http(s) base URL.';
    status.className = 'status err';
    return;
  }
  const includedDomains = parseDomains(
    (document.getElementById('included') as HTMLTextAreaElement).value,
  );
  const excludedDomains = parseDomains(
    (document.getElementById('excluded') as HTMLTextAreaElement).value,
  );
  await chrome.storage.sync.set({
    chamConfig: { baseUrl, includedDomains, excludedDomains },
  });
  status.textContent = 'Saved.';
  status.className = 'status ok';
}

void hydrate();
document.getElementById('save')!.addEventListener('click', () => void onSave());
