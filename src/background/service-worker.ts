async function openOptionsIfUnconfigured(): Promise<void> {
  const { chamConfig } = await chrome.storage.sync.get('chamConfig');
  const baseUrl = (chamConfig as { baseUrl?: string } | undefined)?.baseUrl;
  if (!baseUrl) {
    chrome.runtime.openOptionsPage();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('Cham Archiver installed');
  void openOptionsIfUnconfigured();
});

chrome.runtime.onStartup.addListener(() => {
  void openOptionsIfUnconfigured();
});
