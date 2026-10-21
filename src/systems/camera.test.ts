import { describe, expect, it } from 'vitest';
import { TUNING } from '../data/tuning';
import { FRAMING, floorPointVisible, framingForAspect } from './camera';

describe('framingForAspect', () => {
  it('leaves landscape desktop framing unchanged', () => {
    for (const a of [16 / 9, 2.2, FRAMING.refAspect]) {
      expect(framingForAspect(a)).toEqual({ fov: TUNING.camera.fov, pitchDeg: TUNING.camera.pitchDeg, distanceScale: 1 });
    }
  });

  it('widens and pulls back monotonically as the viewport narrows', () => {
    let prev = framingForAspect(FRAMING.refAspect);
    for (const a of [1.4, 1.0, 0.7, 0.46, 0.4]) {
      const f = framingForAspect(a);
      const reach = Math.tan((f.fov * Math.PI) / 360) * f.distanceScale;
      const prevReach = Math.tan((prev.fov * Math.PI) / 360) * prev.distanceScale;
      expect(reach).toBeGreaterThan(prevReach);
      expect(f.fov).toBeLessThanOrEqual(FRAMING.maxFov + 1e-9);
      expect(f.pitchDeg).toBeGreaterThanOrEqual(prev.pitchDeg);
      prev = f;
    }
    expect(framingForAspect(0.4).pitchDeg).toBeCloseTo(FRAMING.portraitPitchDeg);
  });
});

describe('floorPointVisible', () => {
  const view = { distance: 100, aspect: 16 / 9, fovDeg: TUNING.camera.fov };
  it('sees the floor around the target, more of it away from the camera than towards it', () => {
    expect(floorPointVisible(0, 0, view)).toBe(true);
    expect(floorPointVisible(0, -80, view)).toBe(true); // up the screen
    expect(floorPointVisible(0, 35, view)).toBe(true); // just above the bottom edge
    expect(floorPointVisible(0, 55, view)).toBe(false); // behind the bottom edge
    expect(floorPointVisible(0, -100, view)).toBe(false); // past the top edge
  });

  it('is a trapezoid: wide at the top, narrow at the bottom', () => {
    expect(floorPointVisible(110, -75, view)).toBe(true);
    expect(floorPointVisible(80, 38, view)).toBe(false);
    expect(floorPointVisible(140, 0, view)).toBe(false);
  });

  it('grows with the margin, narrows on portrait and steepens with pitch', () => {
    expect(floorPointVisible(0, 50, view, 10)).toBe(true);
    expect(floorPointVisible(70, 0, { ...view, aspect: 0.5 })).toBe(false);
    expect(floorPointVisible(0, -80, { ...view, pitchDeg: 80 })).toBe(false);
  });
});
