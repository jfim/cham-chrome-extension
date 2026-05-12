import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DwellTracker } from './dwell-tracker';

describe('DwellTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('fires onTrigger after dwell threshold + scroll threshold met', () => {
    const onTrigger = vi.fn();
    const tracker = new DwellTracker({
      dwellMs: 1000,
      scrollPct: 0.3,
      onTrigger,
      getScrollPct: () => 0.5,
    });
    tracker.start();
    vi.advanceTimersByTime(1100);
    tracker.tick();
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it('does not fire if scroll threshold not met', () => {
    const onTrigger = vi.fn();
    const tracker = new DwellTracker({
      dwellMs: 1000,
      scrollPct: 0.5,
      onTrigger,
      getScrollPct: () => 0.1,
    });
    tracker.start();
    vi.advanceTimersByTime(2000);
    tracker.tick();
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('does not fire twice', () => {
    const onTrigger = vi.fn();
    const tracker = new DwellTracker({
      dwellMs: 100,
      scrollPct: 0,
      onTrigger,
      getScrollPct: () => 1,
    });
    tracker.start();
    vi.advanceTimersByTime(200);
    tracker.tick();
    tracker.tick();
    expect(onTrigger).toHaveBeenCalledOnce();
  });

  it('pauses dwell accumulation when hidden', () => {
    const onTrigger = vi.fn();
    const tracker = new DwellTracker({
      dwellMs: 1000,
      scrollPct: 0,
      onTrigger,
      getScrollPct: () => 1,
    });
    tracker.start();
    vi.advanceTimersByTime(500);
    tracker.setVisible(false);
    vi.advanceTimersByTime(2000);
    tracker.setVisible(true);
    vi.advanceTimersByTime(400);
    tracker.tick();
    expect(onTrigger).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    tracker.tick();
    expect(onTrigger).toHaveBeenCalledOnce();
  });
});
