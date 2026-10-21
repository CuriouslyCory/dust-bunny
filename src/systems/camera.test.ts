import { describe, expect, it } from 'vitest';
import { TUNING } from '../data/tuning';
import { FRAMING, framingForAspect } from './camera';

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
