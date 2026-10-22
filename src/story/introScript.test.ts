import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { rectContains } from '../core/math';
import { generateHouse } from '../world/house';
import type { HouseLayout } from '../world/types';
import { eyesOpen } from './intro';
import { aimUnderCouch, INTRO, introStage, SHOT, shotCamera, type CameraPose, type IntroStage } from './introScript';

const SEEDS = Array.from({ length: 40 }, (_, i) => `intro-${i}`);

function stageFor(seed: string): { house: HouseLayout; stage: IntroStage } {
  const house = generateHouse(seed);
  const stage = introStage(house);
  if (!stage) throw new Error(`no intro stage for ${seed}`);
  return { house, stage };
}

/** Normalised device coordinates of a world point seen from a pose (16:9). */
function project(pose: CameraPose, fov: number, x: number, y: number, z: number): Vector3 {
  const cam = new PerspectiveCamera(fov, 16 / 9, 1, 5000);
  cam.position.set(pose.position.x, pose.position.y, pose.position.z);
  cam.lookAt(pose.look.x, pose.look.y, pose.look.z);
  cam.updateMatrixWorld();
  return new Vector3(x, y, z).project(cam);
}

const living = (house: HouseLayout) => house.rooms.find((r) => r.id === house.spawn.roomId)!;

describe('intro stage', () => {
  it('stands the camera in the living room at eye height, with the couch on the left of the frame', () => {
    for (const seed of SEEDS) {
      const { house, stage } = stageFor(seed);
      const room = living(house).rect;
      const p = stage.standing.position;
      expect(rectContains(room, p.x, p.z), seed).toBe(true);
      expect(p.y).toBe(INTRO.eyeHeight);
      const couch = house.furniture.find((f) => f.defId === 'couch' && rectContains(f.rect, house.spawn.x, house.spawn.z))!;
      expect(project(stage.standing, INTRO.standingFov, couch.x, 40, couch.z).x, seed).toBeLessThan(0);
    }
  });

  it('drops four things on free floor, in frame above the captions once the lens has pushed in', () => {
    for (const seed of SEEDS) {
      const { house, stage } = stageFor(seed);
      const room = living(house).rect;
      expect(stage.drops.map((d) => d.typeId)).toEqual(['crumb', 'staple', 'coin', 'sock']);
      for (const d of stage.drops) {
        for (const [x, z] of [
          [d.x, d.z],
          [d.toX, d.toZ],
        ] as const) {
          expect(rectContains(room, x, z, -10), `${seed} ${d.typeId}`).toBe(true);
          for (const f of house.furniture) expect(rectContains(f.rect, x, z), `${seed} ${d.typeId} in ${f.defId}`).toBe(false);
          const ndc = project(stage.standing, INTRO.closeFov, x, 0, z);
          expect(Math.abs(ndc.x), `${seed} ${d.typeId}`).toBeLessThan(0.85);
          expect(ndc.y, `${seed} ${d.typeId}`).toBeGreaterThan(-0.3);
          expect(ndc.y, `${seed} ${d.typeId}`).toBeLessThan(0.9);
        }
      }
      // Dropped in turn, all within the shot's authored length.
      const times = stage.drops.map((d) => d.at);
      expect([...times].sort((a, b) => a - b)).toEqual(times);
      expect(times[times.length - 1]!).toBeLessThan(4 - 0.5);
    }
  });

  it('walks the slippers across the frame on free floor, in from and out of the edges', () => {
    for (const seed of SEEDS) {
      const { house, stage } = stageFor(seed);
      const room = living(house).rect;
      const path = stage.walk.path;
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1]!;
        const b = path[i]!;
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const tx = (b.x - a.x) / (len || 1);
        const tz = (b.z - a.z) / (len || 1);
        for (let s = 0; s <= len; s += 4) {
          for (const side of [-1, 1]) {
            const x = a.x + tx * s - tz * side * (stage.walk.gauge / 2);
            const z = a.z + tz * s + tx * side * (stage.walk.gauge / 2);
            expect(rectContains(room, x, z), seed).toBe(true);
            for (const f of house.furniture) expect(rectContains(f.rect, x, z), `${seed} slipper in ${f.defId}`).toBe(false);
          }
        }
      }
      const seen = (p: { x: number; z: number }) => {
        const ndc = project(stage.standing, INTRO.closeFov, p.x, 0, p.z);
        return Math.abs(ndc.x) < 1 && Math.abs(ndc.y) < 1 && ndc.z < 1;
      };
      expect(seen(path[0]!), seed).toBe(false);
      expect(seen(path[path.length - 1]!), seed).toBe(false);
      expect(path.some(seen), seed).toBe(true);
    }
  });

  it('ends under the couch looking at the Bunny', () => {
    for (const seed of SEEDS) {
      const { house, stage } = stageFor(seed);
      for (const pose of [stage.gap, stage.lint]) {
        expect(pose.look.x).toBe(house.spawn.x);
        expect(pose.look.z).toBe(house.spawn.z);
        // Down in the gap under the couch skirt (6 cm).
        expect(pose.position.y).toBeLessThan(6);
      }
    }
  });

  it('has no stage without a couch over the spawn', () => {
    const house = generateHouse('intro-0');
    expect(introStage({ ...house, furniture: house.furniture.filter((f) => f.defId !== 'couch') })).toBeNull();
  });
});

describe('shotCamera', () => {
  const { stage } = stageFor('intro-1');
  const same = (a: CameraPose, b: CameraPose) => {
    for (const k of ['x', 'y', 'z'] as const) {
      expect(a.position[k]).toBeCloseTo(b.position[k], 6);
      expect(a.look[k]).toBeCloseTo(b.look[k], 6);
    }
  };

  it('chains the shots without a jump: each starts where the last ended', () => {
    const hold = 8;
    same(shotCamera(stage, SHOT.floor, 2, 3, 0), stage.standing);
    expect(shotCamera(stage, SHOT.drops, 0, 4, 0).fov).toBeCloseTo(INTRO.standingFov, 6);
    expect(shotCamera(stage, SHOT.drops, INTRO.push, 4, 0).fov).toBeCloseTo(INTRO.closeFov, 6);
    const diveStart = shotCamera(stage, SHOT.dive, 0, hold, 0);
    same(diveStart, stage.standing);
    expect(diveStart.fov).toBeCloseTo(INTRO.closeFov, 6);
    same(shotCamera(stage, SHOT.dive, hold, hold, 0), stage.gap);
    same(shotCamera(stage, SHOT.eyes, 0, hold, 5), stage.gap);
    same(shotCamera(stage, SHOT.eyes, hold, hold, 5), stage.lint);
    expect(shotCamera(stage, SHOT.grow, 0, 4, 3).weight).toBe(0);
    expect(shotCamera(stage, SHOT.grow, 3, 4, 3).weight).toBe(1);
    for (const shot of [SHOT.floor, SHOT.drops, SHOT.slippers, SHOT.dive, SHOT.eyes, SHOT.grow]) expect(shotCamera(stage, shot, 1, 4, 2).dip).toBe(0);
  });

  it('with reduced motion, holds still and cuts through black instead', () => {
    const a = shotCamera(stage, SHOT.dive, 0, 8, 0, true);
    same(a, stage.lint);
    expect(a.dip).toBe(1);
    expect(shotCamera(stage, SHOT.dive, 2 * INTRO.dip, 8, 0, true).dip).toBe(0);
    same(shotCamera(stage, SHOT.dive, 5, 8, 0, true), stage.lint);
    same(shotCamera(stage, SHOT.eyes, 3, 8, 5, true), stage.lint);
    expect(shotCamera(stage, SHOT.drops, 0, 4, 0, true).fov).toBe(INTRO.closeFov);
    const grow = shotCamera(stage, SHOT.grow, 0, 4, 3, true);
    expect(grow.weight).toBe(1);
    expect(grow.dip).toBe(1);
  });
});

describe('aimUnderCouch', () => {
  it('moves the camera under the couch aside when something big stands between it and the Bunny', () => {
    const { stage } = stageFor('intro-2');
    const mid = { x: (stage.gap.position.x + stage.spawn.x) / 2, z: (stage.gap.position.z + stage.spawn.z) / 2, size: 3 };
    const aimed = aimUnderCouch(stage, [mid]);
    expect(aimed.gap.position).not.toEqual(stage.gap.position);
    expect(aimed.gap.look).toEqual(stage.gap.look);
    // Specks round the Bunny and things off the line change nothing.
    expect(aimUnderCouch(stage, [{ x: stage.spawn.x + 0.5, z: stage.spawn.z, size: 0.3 }])).toBe(stage);
  });
});

describe('eyesOpen', () => {
  it('opens, blinks once and stays open', () => {
    expect(eyesOpen(0)).toBe(0);
    expect(eyesOpen(0.3)).toBe(1);
    expect(eyesOpen(0.6)).toBeLessThan(0.2);
    expect(eyesOpen(2)).toBe(1);
  });
});
