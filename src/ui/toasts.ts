/**
 * Toast batching and rate limiting, DOM-free so it can be unit tested.
 * Repeated toasts with the same key merge into one (count ×N) while it is still fresh;
 * new toasts are spaced by `minInterval` (extra ones wait in a small queue, oldest dropped);
 * at most `maxVisible` are shown (the oldest is retired early).
 */
export interface ToastItem {
  id: number;
  key: string;
  text: string;
  count: number;
  tone: string;
  /** Time (s) when it expires. */
  expiresAt: number;
}

export interface ToastSink {
  show(t: ToastItem): void;
  update(t: ToastItem): void;
  hide(t: ToastItem): void;
}

export interface ToastBatcherOptions {
  /** Same-key toasts merge while the existing one was bumped within this window (s). */
  mergeWindow?: number;
  /** Minimum spacing between new toasts (s). */
  minInterval?: number;
  maxVisible?: number;
  /** Lifetime of a toast (s); a merge extends it. */
  lifetime?: number;
  /** Max queued toasts waiting for the rate limit. */
  maxQueued?: number;
}

export class ToastBatcher {
  private visible: Array<ToastItem & { bumpedAt: number }> = [];
  private queue: Array<{ key: string; text: string; tone: string; count: number }> = [];
  private lastShownAt = -Infinity;
  private nextId = 1;
  private readonly o: Required<ToastBatcherOptions>;

  constructor(
    private readonly sink: ToastSink,
    opts: ToastBatcherOptions = {},
  ) {
    this.o = { mergeWindow: 1.2, minInterval: 0.28, maxVisible: 4, lifetime: 1.8, maxQueued: 3, ...opts };
  }

  push(key: string, text: string, now: number, tone = 'absorb'): void {
    const live = this.visible.find((t) => t.key === key && now - t.bumpedAt <= this.o.mergeWindow);
    if (live) {
      live.count++;
      live.bumpedAt = now;
      live.expiresAt = now + this.o.lifetime;
      this.sink.update(live);
      return;
    }
    const queued = this.queue.find((q) => q.key === key);
    if (queued) {
      queued.count++;
      return;
    }
    this.queue.push({ key, text, tone, count: 1 });
    if (this.queue.length > this.o.maxQueued) this.queue.shift();
    this.tick(now);
  }

  /** Expires old toasts and releases queued ones. Call every frame. */
  tick(now: number): void {
    for (let i = this.visible.length - 1; i >= 0; i--) {
      const t = this.visible[i]!;
      if (now >= t.expiresAt) {
        this.visible.splice(i, 1);
        this.sink.hide(t);
      }
    }
    while (this.queue.length > 0 && now - this.lastShownAt >= this.o.minInterval) {
      const q = this.queue.shift()!;
      if (this.visible.length >= this.o.maxVisible) this.sink.hide(this.visible.shift()!);
      const t = { id: this.nextId++, key: q.key, text: q.text, tone: q.tone, count: q.count, expiresAt: now + this.o.lifetime, bumpedAt: now };
      this.visible.push(t);
      this.lastShownAt = now;
      this.sink.show(t);
    }
  }

  clear(): void {
    for (const t of this.visible) this.sink.hide(t);
    this.visible = [];
    this.queue = [];
  }

  get visibleCount(): number {
    return this.visible.length;
  }
}
