import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showOptInBanner } from './opt-in-banner';

describe('showOptInBanner', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('appends a banner element to the body', () => {
    showOptInBanner({ domain: 'nytimes.com', onChoice: vi.fn() });
    expect(document.querySelector('[data-cham-banner]')).not.toBeNull();
  });

  it('clicking Always calls onChoice with always and removes banner', () => {
    const onChoice = vi.fn();
    showOptInBanner({ domain: 'nytimes.com', onChoice });
    const alwaysBtn = document.querySelector<HTMLButtonElement>('[data-cham-choice="always"]')!;
    alwaysBtn.click();
    expect(onChoice).toHaveBeenCalledWith('always');
    expect(document.querySelector('[data-cham-banner]')).toBeNull();
  });

  it('clicking Never calls onChoice with never', () => {
    const onChoice = vi.fn();
    showOptInBanner({ domain: 'nytimes.com', onChoice });
    document.querySelector<HTMLButtonElement>('[data-cham-choice="never"]')!.click();
    expect(onChoice).toHaveBeenCalledWith('never');
  });

  it('clicking Once calls onChoice with once', () => {
    const onChoice = vi.fn();
    showOptInBanner({ domain: 'nytimes.com', onChoice });
    document.querySelector<HTMLButtonElement>('[data-cham-choice="once"]')!.click();
    expect(onChoice).toHaveBeenCalledWith('once');
  });

  it('does not show twice for the same domain in the same page', () => {
    showOptInBanner({ domain: 'x.com', onChoice: vi.fn() });
    showOptInBanner({ domain: 'x.com', onChoice: vi.fn() });
    expect(document.querySelectorAll('[data-cham-banner]')).toHaveLength(1);
  });
});
