import { startDrainScheduler, drainOnce } from './drain';
import { registerNavListener } from './nav-listener';
import { loadConfig, saveConfig } from '../lib/storage';
import { decide } from '../lib/decision-pipeline';
import { domainOf } from '../lib/url-matcher';
import {
  isCandidateMessage,
  isOptInResponseMessage,
  isManualArchiveMessage,
} from '../lib/messaging';
import { enqueue, hasRecentlyQueued } from '../lib/queue';
import { log } from '../lib/logger';

chrome.runtime.onInstalled.addListener(() => log.info('Cham Archiver installed'));

startDrainScheduler();
registerNavListener();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (isCandidateMessage(msg)) {
        const config = await loadConfig();
        if (await hasRecentlyQueued(msg.url)) {
          sendResponse({ action: 'reject', reason: 'recently queued' });
          return;
        }
        const decision = decide({ url: msg.url, isArticle: msg.isArticle }, config);
        if (decision.action === 'archive') {
          await enqueue(msg.url);
          void drainOnce();
        }
        sendResponse(decision);
      } else if (isOptInResponseMessage(msg)) {
        const config = await loadConfig();
        if (msg.choice === 'always') {
          await saveConfig({ optInDomains: [...config.optInDomains, msg.domain] });
        } else if (msg.choice === 'never') {
          await saveConfig({ neverDomains: [...config.neverDomains, msg.domain] });
        }
        if (msg.choice === 'always' || msg.choice === 'once') {
          const tab = sender.tab;
          if (tab?.url && domainOf(tab.url) === msg.domain) {
            await enqueue(tab.url);
            void drainOnce();
          }
        }
        sendResponse({ ok: true });
      } else if (isManualArchiveMessage(msg)) {
        await enqueue(msg.url);
        void drainOnce();
        sendResponse({ ok: true });
      } else {
        sendResponse({ error: 'unknown message' });
      }
    } catch (err) {
      log.error('service worker message handler failed', err);
      sendResponse({ error: String(err) });
    }
  })();
  return true;
});
