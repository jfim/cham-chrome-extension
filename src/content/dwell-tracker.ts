export interface DwellTrackerOptions {
  dwellMs: number;
  scrollPct: number;
  onTrigger: () => void;
  getScrollPct: () => number;
}

export class DwellTracker {
  private accumulatedMs = 0;
  private lastResumeAt: number | null = null;
  private visible = true;
  private fired = false;

  constructor(private readonly opts: DwellTrackerOptions) {}

  start(): void {
    this.lastResumeAt = Date.now();
  }

  setVisible(visible: boolean): void {
    if (visible === this.visible) return;
    if (visible) {
      this.lastResumeAt = Date.now();
    } else {
      if (this.lastResumeAt !== null) {
        this.accumulatedMs += Date.now() - this.lastResumeAt;
        this.lastResumeAt = null;
      }
    }
    this.visible = visible;
  }

  tick(): void {
    if (this.fired) return;
    const now = Date.now();
    const total = this.accumulatedMs + (this.lastResumeAt !== null ? now - this.lastResumeAt : 0);
    if (total >= this.opts.dwellMs && this.opts.getScrollPct() >= this.opts.scrollPct) {
      this.fired = true;
      this.opts.onTrigger();
    }
  }
}
