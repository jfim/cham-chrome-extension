import { DwellTracker } from './dwell-tracker';
import { showOptInBanner } from './opt-in-banner';
import { classifyDocument } from '../lib/readability-classifier';
import type { CandidateMessage, OptInResponseMessage } from '../lib/messaging';
import type { Decision } from '../lib/decision-pipeline';
import { loadConfig } from '../lib/storage';
import { log } from '../lib/logger';

function getScrollPct(): number {
  const doc = document.documentElement;
  const max = doc.scrollHeight - window.innerHeight;
  if (max <= 0) return 1;
  return Math.min(1, Math.max(0, window.scrollY / max));
}

async function main() {
  if (window.top !== window) return;
  const config = await loadConfig();

  const tracker = new DwellTracker({
    dwellMs: config.dwellMs,
    scrollPct: config.scrollPct,
    getScrollPct,
    onTrigger: () => void considerCurrentPage(),
  });
  tracker.start();

  document.addEventListener('visibilitychange', () => tracker.setVisible(!document.hidden));
  setInterval(() => tracker.tick(), 1000);
}

async function considerCurrentPage(): Promise<void> {
  const { isArticle, title } = classifyDocument(document);
  const msg: CandidateMessage = {
    type: 'candidate',
    url: location.href,
    isArticle,
    title,
  };
  let decision: Decision | undefined;
  try {
    decision = (await chrome.runtime.sendMessage(msg)) as Decision;
  } catch (err) {
    log.warn('candidate send failed', err);
    return;
  }
  if (!decision) return;
  if (decision.action === 'prompt') {
    const promptDomain = decision.domain;
    showOptInBanner({
      domain: promptDomain,
      onChoice: async (choice) => {
        const response: OptInResponseMessage = {
          type: 'opt-in-response',
          domain: promptDomain,
          choice,
        };
        await chrome.runtime.sendMessage(response);
      },
    });
  }
}

void main();
