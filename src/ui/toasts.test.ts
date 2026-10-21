import { describe, expect, it } from 'vitest';
import { ToastBatcher, type ToastItem } from './toasts';

function harness(opts = {}) {
  const log: string[] = [];
  const b = new ToastBatcher(
    {
      show: (t: ToastItem) => log.push(`show ${t.key}×${t.count}`),
      update: (t: ToastItem) => log.push(`update ${t.key}×${t.count}`),
      hide: (t: ToastItem) => log.push(`hide ${t.key}`),
    },
    { minInterval: 0.3, mergeWindow: 1, lifetime: 2, maxVisible: 2, ...opts },
  );
  return { b, log };
}

describe('ToastBatcher', () => {
  it('merges same-key toasts while fresh', () => {
    const { b, log } = harness();
    b.push('sock', '+ Sock!', 0);
    b.push('sock', '+ Sock!', 0.5);
    b.push('sock', '+ Sock!', 1.4);
    expect(log).toEqual(['show sock×1', 'update sock×2', 'update sock×3']);
  });

  it('rate-limits new toasts and batches queued repeats', () => {
    const { b, log } = harness();
    b.push('a', 'A', 0);
    b.push('b', 'B', 0.1);
    b.push('b', 'B', 0.15);
    expect(log).toEqual(['show a×1']);
    b.tick(0.31);
    expect(log).toEqual(['show a×1', 'show b×2']);
  });

  it('caps visible toasts and expires them', () => {
    const { b, log } = harness();
    b.push('a', 'A', 0);
    b.push('b', 'B', 0.3);
    b.push('c', 'C', 0.6);
    expect(log).toContain('hide a');
    expect(b.visibleCount).toBe(2);
    b.tick(10);
    expect(b.visibleCount).toBe(0);
  });

  it('drops the oldest queued toast when the queue overflows', () => {
    const { b, log } = harness({ maxQueued: 2, minInterval: 1 });
    b.push('a', 'A', 0);
    b.push('b', 'B', 0.1);
    b.push('c', 'C', 0.1);
    b.push('d', 'D', 0.1);
    b.tick(1);
    b.tick(2);
    b.tick(3);
    expect(log.filter((l) => l.startsWith('show'))).toEqual(['show a×1', 'show c×1', 'show d×1']);
  });
});
