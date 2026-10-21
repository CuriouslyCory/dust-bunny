import { describe, expect, it, vi } from 'vitest';
import { EventBus } from './events';

describe('event bus', () => {
  it('delivers typed payloads, supports off and once', () => {
    const bus = new EventBus();
    const seen: number[] = [];
    const off = bus.on('tierUp', (e) => seen.push(e.tier));
    bus.once('tierUp', (e) => seen.push(e.tier * 10));
    bus.emit('tierUp', { tier: 2, previousTier: 1, tierName: 'Fluff' });
    off();
    bus.emit('tierUp', { tier: 3, previousTier: 2, tierName: 'Tumbleweed' });
    expect(seen).toEqual([2, 20]);
  });

  it('isolates throwing handlers', () => {
    const bus = new EventBus();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ok = vi.fn();
    bus.on('paused', () => {
      throw new Error('boom');
    });
    bus.on('paused', ok);
    bus.emit('paused', { reason: 'paused' });
    expect(ok).toHaveBeenCalledOnce();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
