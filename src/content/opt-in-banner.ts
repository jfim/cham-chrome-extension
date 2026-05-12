import type { OptInChoice } from '../lib/messaging';

export interface OptInBannerOpts {
  domain: string;
  onChoice: (choice: OptInChoice) => void;
}

export function showOptInBanner({ domain, onChoice }: OptInBannerOpts): void {
  if (document.querySelector('[data-cham-banner]')) return;

  const root = document.createElement('div');
  root.setAttribute('data-cham-banner', '');
  Object.assign(root.style, {
    position: 'fixed',
    bottom: '16px',
    right: '16px',
    zIndex: '2147483647',
    background: '#1f1f1f',
    color: '#fff',
    padding: '12px 14px',
    borderRadius: '8px',
    boxShadow: '0 6px 24px rgba(0,0,0,0.3)',
    font: '14px system-ui, sans-serif',
    maxWidth: '320px',
  });

  const msg = document.createElement('div');
  msg.textContent = `Auto-archive articles from ${domain} to Cham?`;
  msg.style.marginBottom = '10px';
  root.appendChild(msg);

  const row = document.createElement('div');
  row.style.display = 'flex';
  row.style.gap = '6px';

  function btn(label: string, choice: OptInChoice): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    b.setAttribute('data-cham-choice', choice);
    Object.assign(b.style, {
      padding: '6px 10px',
      borderRadius: '4px',
      border: '1px solid #555',
      background: '#333',
      color: '#fff',
      cursor: 'pointer',
      font: 'inherit',
    });
    b.addEventListener('click', () => {
      root.remove();
      onChoice(choice);
    });
    return b;
  }

  row.appendChild(btn('Always', 'always'));
  row.appendChild(btn('Just this one', 'once'));
  row.appendChild(btn('Never', 'never'));
  root.appendChild(row);

  document.body.appendChild(root);
}
