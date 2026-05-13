function isValidBaseUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

async function hydrate(): Promise<void> {
  const { chamConfig } = await chrome.storage.sync.get('chamConfig');
  const baseUrl = (chamConfig as { baseUrl?: string } | undefined)?.baseUrl ?? '';
  (document.getElementById('baseUrl') as HTMLInputElement).value = baseUrl;
}

async function onSave(): Promise<void> {
  const input = document.getElementById('baseUrl') as HTMLInputElement;
  const status = document.getElementById('status') as HTMLParagraphElement;
  const baseUrl = input.value.trim().replace(/\/$/, '');
  if (!baseUrl || !isValidBaseUrl(baseUrl)) {
    status.textContent = 'Enter a valid http(s) URL.';
    status.className = 'status err';
    return;
  }
  await chrome.storage.sync.set({ chamConfig: { baseUrl } });
  status.textContent = 'Saved.';
  status.className = 'status ok';
}

void hydrate();
document.getElementById('save')!.addEventListener('click', () => void onSave());
