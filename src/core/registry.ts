/** Minimal id-keyed registry used for Hazards, Pickups, Perks, screens, models. */
export class Registry<T extends { id: string }> {
  private items = new Map<string, T>();

  constructor(readonly kind: string) {}

  /** Registers (or replaces) an entry. Returns it for convenience. */
  register(item: T): T {
    this.items.set(item.id, item);
    return item;
  }

  get(id: string): T | undefined {
    return this.items.get(id);
  }

  require(id: string): T {
    const it = this.items.get(id);
    if (!it) throw new Error(`Unknown ${this.kind} "${id}"`);
    return it;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  all(): T[] {
    return [...this.items.values()];
  }
}
