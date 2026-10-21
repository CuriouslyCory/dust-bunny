/**
 * Subscriptions to events that other modules may add later (e.g. `bossSpawned` from Hazards).
 * They are subscribed by name without declaring them in GameEvents, so the owning module can
 * declare its own payload type without a conflicting interface merge. Payloads are read
 * defensively.
 */
import type { EventBus } from '../core/events';
import { getDebrisType } from '../data/debris';
import { hazardRegistry } from '../hazards';

/** Events the UI/audio react to that core does not emit (yet). */
export type LooseEventName = 'bossSpawned' | 'bossDefeated' | 'victory' | 'hazardAbsorbed' | 'perkChosen' | 'dash';

export function onLoose(events: EventBus, name: LooseEventName | string, fn: (payload: Record<string, unknown>) => void): () => void {
  const bus = events as unknown as EventBus<Record<string, Record<string, unknown> | undefined>>;
  return bus.on(name, (p) => fn(p && typeof p === 'object' ? p : {}));
}

/** Heuristic for "this Hazard is the boss" when only a def id is known. */
export function isBossHazard(defId: string): boolean {
  const def = hazardRegistry.get(defId) as ({ boss?: boolean } & object) | undefined;
  return !!def?.boss || /boss|robo_?vac|9000/i.test(defId);
}

/** Display name for an absorbed thing (Debris type or Hazard def id). */
export function absorbedName(typeId: string): string {
  return (
    getDebrisType(typeId)?.name ??
    hazardRegistry.get(typeId)?.name ??
    typeId.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
