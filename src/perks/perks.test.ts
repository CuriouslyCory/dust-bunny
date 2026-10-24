import { describe, expect, it } from 'vitest';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import { TUNING } from '../data/tuning';
import { createRun, registerGameplayContent } from '../game/assembly';
import { upgradeModifiers } from '../meta/upgrades';
import { pickupRegistry } from '../pickups';
import { availablePerks, perkRegistry } from './index';
import { draftablePerks, draftPerks, perkCapped } from './draft';

registerGameplayContent();

const makeRun = (upgrades: Record<string, number> = {}, characterId = 'lint') => {
  const events = new EventBus();
  const run = createRun(events, { seed: 'perks', characterId, modifiers: upgradeModifiers(upgrades) });
  return { run, events };
};

describe('Perk draft', () => {
  it('registers the 12 shared Perks and five Character Perks per Character', () => {
    const all = perkRegistry.all();
    expect(all.filter((p) => !p.character)).toHaveLength(12);
    for (const c of ['lint', 'tumble', 'zap']) {
      const mine = all.filter((p) => p.character === c);
      expect(mine).toHaveLength(5);
      // Every non-unique Character Perk has three stacks.
      for (const p of mine) expect(p.unique ? 1 : p.maxStacks).toBe(p.unique ? 1 : 3);
    }
  });

  it("only offers a Run its own Character's Perks", () => {
    for (const c of ['lint', 'tumble', 'zap']) {
      const run = createRun(new EventBus(), { seed: `own-${c}`, characterId: c });
      const own = availablePerks(run).filter((p) => p.character);
      expect(own).toHaveLength(5);
      expect(own.every((p) => p.character === c)).toBe(true);
      run.perkDraft.queue(40);
      while (run.perkDraft.active) {
        const offer = run.perkDraft.offer.perks;
        expect(offer.every((p) => !p.character || p.character === c)).toBe(true);
        run.perkDraft.choose(offer[0]!.id);
      }
    }
  });

  it('offers 3 distinct Perks, or 4 with Wide Choice', () => {
    for (let i = 0; i < 20; i++) {
      const run = createRun(new EventBus(), { seed: `perks-${i}`, characterId: 'lint' });
      run.perkDraft.queue();
      const a = run.perkDraft.offer.perks;
      expect(a).toHaveLength(3);
      expect(new Set(a.map((p) => p.id)).size).toBe(3);
    }
    const { run } = makeRun({ wide_choice: 1 });
    run.perkDraft.queue();
    expect(run.perkDraft.offer.perks).toHaveLength(4);
  });

  it('never offers an owned unique or a maxed Perk', () => {
    const { run } = makeRun();
    run.applyPerk('second_wind');
    run.applyPerk('spiky_dash');
    for (let i = 0; i < 3; i++) run.applyPerk('quick_dash');
    const ids = availablePerks(run).map((p) => p.id);
    expect(ids).not.toContain('second_wind');
    expect(ids).not.toContain('spiky_dash');
    expect(ids).not.toContain('quick_dash');
    const rng = new Rng('never');
    for (let i = 0; i < 50; i++) {
      const offer = draftPerks(availablePerks(run), 3, rng).map((p) => p.id);
      expect(offer).not.toContain('second_wind');
      expect(offer).not.toContain('quick_dash');
    }
    run.perkDraft.queue(20);
    while (run.perkDraft.active) {
      const offer = run.perkDraft.offer.perks.map((p) => p.id);
      expect(offer).not.toContain('second_wind');
      expect(offer).not.toContain('quick_dash');
      run.perkDraft.choose(offer[0]!);
    }
  });

  it('returns fewer cards when the pool is small', () => {
    const pool = perkRegistry.all().slice(0, 2);
    expect(draftPerks(pool, 4, new Rng(1))).toHaveLength(2);
    expect(draftPerks([], 3, new Rng(1))).toEqual([]);
  });

  it('rerolls only when the Reroll Upgrade is owned, avoiding the current offer', () => {
    const plain = makeRun().run;
    plain.perkDraft.queue();
    expect(plain.perkDraft.reroll()).toBe(false);

    const { run } = makeRun({ reroll: 1 });
    const draft = run.perkDraft;
    expect(draft.rerollsLeft).toBe(1);
    expect(draft.reroll()).toBe(false); // nothing on offer yet
    draft.queue();
    const first = draft.offer;
    expect(draft.reroll()).toBe(true);
    const second = draft.offer;
    expect(second.perks).toHaveLength(3);
    expect(second.serial).not.toBe(first.serial);
    for (const p of second.perks) expect(first.perks.map((f) => f.id)).not.toContain(p.id);
    expect(draft.rerollsLeft).toBe(0);
    expect(draft.pending).toBe(1); // a reroll is not a pick
    expect(draft.reroll()).toBe(false);
    expect(draft.offer).toBe(second);
  });
});

describe('Perk draft workflow', () => {
  const perkCount = (run: ReturnType<typeof makeRun>['run']) => run.getStats().perks.length;

  it('queues one draft per Tier crossed, including several in one update', () => {
    const { run, events } = makeRun();
    const seen: number[] = [];
    // Listeners see the draft already queued for the Tier they are told about.
    events.on('tierUp', () => seen.push(run.perkDraft.pending));
    run.bunny.setRadius(25);
    run.update(1 / 60);
    expect(run.tier).toBe(4);
    expect(seen).toEqual([1, 2, 3]);
    expect(run.perkDraft.pending).toBe(3);
    expect(run.perkDraft.active).toBe(true);
    expect(run.perkDraft.offer.perks).toHaveLength(3);
  });

  it('picks sequentially: each valid choice applies once and prepares the next offer', () => {
    const { run, events } = makeRun();
    const applied: string[] = [];
    events.on('perkApplied', (e) => applied.push(e.perkId));
    run.bunny.setRadius(25);
    run.update(1 / 60);
    const draft = run.perkDraft;
    const serials = new Set<number>();
    for (let left = 3; left > 0; left--) {
      expect(draft.pending).toBe(left);
      const { serial, perks } = draft.offer;
      expect(serials.has(serial)).toBe(false);
      serials.add(serial);
      expect(draft.choose(perks[1]!.id, serial)).toBe(true);
      expect(applied.at(-1)).toBe(perks[1]!.id);
    }
    expect(applied).toHaveLength(3);
    expect(draft.pending).toBe(0);
    expect(draft.active).toBe(false);
    expect(draft.offer.perks).toEqual([]);
  });

  it('rejects stale, invalid and already-consumed choices', () => {
    const { run } = makeRun();
    const draft = run.perkDraft;
    expect(draft.choose('quick_dash')).toBe(false); // nothing pending
    draft.queue(2);
    const first = draft.offer;
    const notOffered = perkRegistry.all().find((p) => !first.perks.includes(p))!;
    expect(draft.choose(notOffered.id)).toBe(false);
    expect(draft.choose('no_such_perk')).toBe(false);
    expect(draft.choose(first.perks[0]!.id, first.serial + 1)).toBe(false);
    expect(draft.pending).toBe(2);
    expect(perkCount(run)).toBe(0);

    expect(draft.choose(first.perks[0]!.id, first.serial)).toBe(true);
    // A second click on the old card (same Perk, old offer) does nothing.
    expect(draft.choose(first.perks[0]!.id, first.serial)).toBe(false);
    expect(draft.pending).toBe(1);
    expect(perkCount(run)).toBe(1);

    const last = draft.offer;
    expect(draft.choose(last.perks[0]!.id, last.serial)).toBe(true);
    expect(draft.choose(last.perks[0]!.id, last.serial)).toBe(false);
    expect(draft.pending).toBe(0);
    expect(perkCount(run)).toBe(2);
  });

  it('rejects choices once the Run has ended', () => {
    const { run } = makeRun();
    run.perkDraft.queue();
    const { perks } = run.perkDraft.offer;
    run.end('quit');
    expect(run.perkDraft.active).toBe(false);
    expect(run.perkDraft.choose(perks[0]!.id)).toBe(false);
    expect(perkCount(run)).toBe(0);
    run.perkDraft.queue();
    expect(run.perkDraft.pending).toBe(1);
  });

  it('drops the remaining drafts once every Perk is owned or maxed', () => {
    const { run } = makeRun({ wide_choice: 1 });
    const draft = run.perkDraft;
    draft.queue(100);
    let picks = 0;
    while (draft.active) {
      expect(draft.choose(draft.offer.perks[0]!.id)).toBe(true);
      picks++;
    }
    expect(draftablePerks(run)).toEqual([]);
    expect(draft.pending).toBe(0);
    expect(picks).toBe(perkCount(run));
    expect(picks).toBeLessThan(100);
    draft.queue();
    expect(draft.pending).toBe(0);
    expect(draft.active).toBe(false);
  });

  it('offers the last Perks left when the pool is smaller than the card count', () => {
    const { run } = makeRun();
    const keep = ['second_wind', 'spiky_dash'];
    for (const p of perkRegistry.all()) {
      if (keep.includes(p.id)) continue;
      for (let i = 0; i < (p.maxStacks ?? 1); i++) run.applyPerk(p.id);
    }
    expect(availablePerks(run).map((p) => p.id).sort()).toEqual(keep);
    run.perkDraft.queue(3);
    expect(run.perkDraft.offer.perks.map((p) => p.id).sort()).toEqual(keep);
    expect(run.perkDraft.choose('second_wind')).toBe(true);
    expect(run.perkDraft.offer.perks.map((p) => p.id)).toEqual(['spiky_dash']);
    expect(run.perkDraft.choose('spiky_dash')).toBe(true);
    expect(run.perkDraft.pending).toBe(0); // the third draft had nothing left to offer
  });

  it('is seeded: the same seed drafts the same offers', () => {
    const offers = () => {
      const { run } = makeRun({ reroll: 1 });
      run.perkDraft.queue(3);
      const out: string[][] = [];
      run.perkDraft.reroll();
      while (run.perkDraft.active) {
        out.push(run.perkDraft.offer.perks.map((p) => p.id));
        run.perkDraft.choose(run.perkDraft.offer.perks[0]!.id);
      }
      return out;
    };
    expect(offers()).toEqual(offers());
  });

  it('belongs to its Run: a fresh Run on the same events inherits no picks', () => {
    const events = new EventBus();
    const old = createRun(events, { seed: 'replace', characterId: 'lint', modifiers: upgradeModifiers({ reroll: 1 }) });
    old.bunny.setRadius(25);
    old.update(1 / 60);
    old.perkDraft.reroll();
    expect(old.perkDraft.pending).toBe(3);
    old.dispose();

    const run = createRun(events, { seed: 'replace', characterId: 'lint', modifiers: upgradeModifiers({ reroll: 1 }) });
    expect(run.perkDraft.pending).toBe(0);
    expect(run.perkDraft.active).toBe(false);
    expect(run.perkDraft.rerollsLeft).toBe(1);
    // Tier-ups of the new Run do not touch the old one.
    run.bunny.setRadius(25);
    run.update(1 / 60);
    expect(run.perkDraft.pending).toBe(3);
    expect(old.perkDraft.pending).toBe(3);
  });
});

describe('cap-aware draft', () => {
  it('hides a stat Perk once its stat is at the Character cap', () => {
    const { run } = makeRun({}, 'tumble');
    const aero = perkRegistry.require('aerodynamic');
    expect(perkCapped(run, aero)).toBe(false);
    // Tumble 0.8 × 1.1³ = 1.065 ≥ its 1.05 speed cap.
    for (let i = 0; i < 3; i++) run.applyPerk('aerodynamic');
    expect(run.bunny.stats.get('speed')).toBeCloseTo(1.05);
    expect(perkCapped(run, aero)).toBe(true);
    expect(availablePerks(run).map((p) => p.id)).toContain('aerodynamic');
    expect(draftablePerks(run).map((p) => p.id)).not.toContain('aerodynamic');
    for (let i = 0; i < 10; i++) {
      run.perkDraft.queue();
      expect(run.perkDraft.offer.perks.map((p) => p.id)).not.toContain('aerodynamic');
      run.perkDraft.choose(run.perkDraft.offer.perks.find((p) => p.capStats)?.id ?? run.perkDraft.offer.perks[0]!.id);
    }
  });

  it('hides a floor Perk at the floor (Quick Dash on Tumble)', () => {
    const { run } = makeRun({}, 'tumble');
    const quick = perkRegistry.require('quick_dash');
    run.applyPerk('quick_dash'); // 4 × 0.7 = 2.8 > 2.5
    expect(perkCapped(run, quick)).toBe(false);
    run.applyPerk('quick_dash'); // 1.96 → floored at 2.5
    expect(run.bunny.stats.get('dashCooldown')).toBe(2.5);
    expect(perkCapped(run, quick)).toBe(true);
  });

  it('keeps Thick Fur on offer at the heart cap because it heals', () => {
    const { run } = makeRun({ extra_heart: 2 }, 'zap');
    expect(run.bunny.stats.atCap('maxHealth')).toBe(true);
    const fur = perkRegistry.require('thick_fur');
    expect(perkCapped(run, fur)).toBe(false);
    expect(draftablePerks(run).map((p) => p.id)).toContain('thick_fur');
    run.applyPerk('thick_fur');
    expect(run.bunny.maxHealth).toBe(4);
  });
});

describe('combat hooks', () => {
  it('Bubble Wrap blocks exactly one hit', () => {
    const { run, events } = makeRun();
    let blocked = 0;
    events.on('shieldBlocked', () => blocked++);
    run.pickups.activate(pickupRegistry.require('bubble_wrap'));
    expect(run.bunny.damage(1, 'roomba')).toBe(false);
    expect(blocked).toBe(1);
    expect(run.bunny.health).toBe(3);
    run.bunny.invulnerable = 0;
    expect(run.bunny.damage(1, 'roomba')).toBe(true);
    expect(run.bunny.health).toBe(2);
  });

  it('Bubble Wrap stacks up to 3 charges', () => {
    const { run } = makeRun();
    const wrap = pickupRegistry.require('bubble_wrap');
    for (let i = 0; i < 5; i++) run.pickups.activate(wrap);
    expect(run.bunny.shield).toBe(3);
    for (let i = 0; i < 3; i++) {
      run.bunny.invulnerable = 0;
      expect(run.bunny.damage(1, 'roomba')).toBe(false);
    }
    run.bunny.invulnerable = 0;
    expect(run.bunny.damage(1, 'roomba')).toBe(true);
    expect(run.bunny.shield).toBe(0);
  });

  it('Dust Cloud hides the Bunny until it expires', () => {
    const { run } = makeRun();
    run.pickups.activate(pickupRegistry.require('dust_cloud'));
    expect(run.bunny.hiddenFromHazards).toBe(true);
    expect(run.bunny.damage(1, 'roomba')).toBe(false);
    for (let t = 0; t < 6.1 * 60; t++) run.update(1 / 60);
    expect(run.bunny.hiddenFromHazards).toBe(false);
  });

  it('Second Wind turns one lethal hit into a full heal', () => {
    const { run, events } = makeRun({}, 'zap');
    let revived = 0;
    events.on('bunnyRevived', () => revived++);
    run.applyPerk('second_wind');
    run.bunny.damage(1, 'x');
    run.bunny.invulnerable = 0;
    expect(run.bunny.damage(1, 'x')).toBe(false);
    expect(revived).toBe(1);
    expect(run.bunny.health).toBe(2);
    expect(run.ended).toBe(false);
    run.bunny.invulnerable = 0;
    run.bunny.damage(5, 'x');
    expect(run.ended).toBe(true);
  });

  it('Regrowth heals over time', () => {
    const { run } = makeRun();
    run.applyPerk('regrowth');
    run.bunny.damage(1, 'x');
    expect(run.bunny.health).toBe(2);
    for (let t = 0; t < 45.1 * 60; t++) run.update(1 / 60);
    expect(run.bunny.health).toBe(3);
  });

  it('Spiky Dash cancels damage while dashing', () => {
    const { run } = makeRun();
    run.applyPerk('spiky_dash');
    run.bunny.dashTime = 0.2;
    expect(run.bunny.damage(1, 'roomba')).toBe(false);
    run.bunny.dashTime = 0;
    run.bunny.invulnerable = 0;
    expect(run.bunny.damage(1, 'roomba')).toBe(true);
  });
});

describe('Pickups', () => {
  it('timed Pickups refresh instead of stacking, scaled by Hoarder', () => {
    const { run } = makeRun();
    const sugar = pickupRegistry.require('sugar_rush');
    run.pickups.activate(sugar);
    run.pickups.activate(sugar);
    expect(run.bunny.stats.get('speed')).toBeCloseTo(1.5);
    expect(run.pickups.active).toHaveLength(1);
    run.applyPerk('hoarder');
    run.pickups.activate(sugar);
    expect(run.pickups.active[0]!.duration).toBeCloseTo(8 * 1.4);
    for (let t = 0; t < 11.3 * 60; t++) run.update(1 / 60);
    expect(run.pickups.active).toHaveLength(0);
    expect(run.bunny.stats.get('speed')).toBeCloseTo(1);
  });

  it('Crumb Cake heals; the director spawns floor Pickups over time', () => {
    const { run } = makeRun({ pickup_luck: 2 });
    run.bunny.damage(1, 'x');
    run.pickups.activate(pickupRegistry.require('crumb_cake'));
    expect(run.bunny.health).toBe(3);
    let spawned = 0;
    run.events.on('pickupSpawned', () => spawned++);
    run.bunny.invulnerable = TUNING.invulnerability;
    for (let t = 0; t < 40 * 60; t++) run.update(1 / 60);
    expect(spawned).toBeGreaterThan(0);
  });
});
