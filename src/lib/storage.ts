import { ChamConfig, defaultConfig } from './config';

const CONFIG_KEY = 'config';

export async function loadConfig(): Promise<ChamConfig> {
  const out = await chrome.storage.sync.get({ [CONFIG_KEY]: defaultConfig });
  return { ...defaultConfig, ...(out[CONFIG_KEY] as Partial<ChamConfig>) };
}

export async function saveConfig(patch: Partial<ChamConfig>): Promise<void> {
  const current = await loadConfig();
  const next: ChamConfig = { ...current, ...patch };
  await chrome.storage.sync.set({ [CONFIG_KEY]: next });
}
