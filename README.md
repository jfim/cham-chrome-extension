# cham-chrome-extension

Chrome extension that archives articles you read to your self-hosted [Cham](https://github.com/jfim/cham) instance.

## How it works

The extension auto-archives URLs of articles you've actually read (not just glanced at) to Cham, after asking once per new domain. The pipeline:

1. **Dwell + scroll detection** — the content script waits until you've spent >30s actively viewing a page and scrolled past 40% of it.
2. **Filter:** reject if the URL is on a default or user blocklist (gmail, banking patterns, local hosts, etc.), or if Mozilla Readability doesn't think it's an article.
3. **Decide:** auto-archive if you've previously said "always" for this domain; otherwise show a small banner asking Always / Just this one / Never.
4. **Queue:** archive requests go to a persistent `chrome.storage.local` queue and drain via `chrome.alarms` every 5 minutes plus on `online` events — so reading on a laptop at the coffee shop still archives when you get home.
5. **Cloudflare Access aware:** if Cham is behind CF Access and the session expired, queued items are marked `needs_auth` instead of failed. When you visit the Cham UI in a tab (re-authenticating with CF), a `chrome.webNavigation` listener drains them automatically.

Currently only the URL is submitted (so authenticated content like email or banking can't leak). Future work: capture page body for paywalled articles.

## Development

```bash
npm install
npm run dev      # Vite dev build with HMR (load dist/ as unpacked extension)
npm run build    # Production build to dist/
npm run lint     # ESLint + Prettier check
npm test         # Vitest
```

## Testing the extension manually

After `npm run build`:

1. Visit `chrome://extensions`, enable Developer Mode.
2. Click "Load unpacked" and select the `dist/` directory.
3. Open the options page from the extension's menu, set your Cham base URL (e.g. `http://localhost:4000`), and click "Test connection".
4. Browse normally. On a new domain that crosses the dwell + scroll threshold and looks like an article, you'll see the opt-in banner.
5. The toolbar icon opens a popup with manual archive and per-domain quick toggles.

## Architecture

See [`docs/superpowers/plans/2026-05-12-auto-archive-with-opt-in.md`](docs/superpowers/plans/2026-05-12-auto-archive-with-opt-in.md) for the full design and task breakdown.
