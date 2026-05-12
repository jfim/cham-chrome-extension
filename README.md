# cham-chrome-extension

Chrome extension that archives articles you read to your self-hosted [Cham](https://github.com/jfim/cham) instance.

## Development

```bash
npm install
npm run dev      # Vite dev build with HMR (load dist/ as unpacked extension)
npm run build    # Production build to dist/
npm run lint     # ESLint + Prettier check
npm run test     # Vitest
```

Load the extension by visiting `chrome://extensions`, enabling Developer Mode, and choosing "Load unpacked" pointing at `dist/`.

## Status

Early scaffolding. See open discussion in commit history for the capture strategy.
