import { Fog, PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { TUNING } from '../data/tuning';
import { CameraRig, FRAMING, floorPointVisible, framingForAspect } from './camera';

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

describe('CameraRig script', () => {
  const rigAt = (): CameraRig => {
    const rig = new CameraRig(new PerspectiveCamera(TUNING.camera.fov, 16 / 9, 0.1, 1000), new Fog('#000', 1, 2), 1, 1);
    rig.setAspect(16 / 9);
    rig.snap(100, 100, 1, 1);
    return rig;
  };
  const chase = (): { position: Vector3; look: Vector3 } => {
    const rig = rigAt();
    return { position: rig.camera.position.clone(), look: rig.viewTarget.clone() };
  };

  it('shows the script alone at weight 0, the chase camera at 1, and swings continuously between', () => {
    const rig = rigAt();
    const script = { position: new Vector3(50, 150, 300), look: new Vector3(80, 0, 120), weight: 0, fov: 20 };
    rig.script = script;
    rig.update(0, 100, 100, 1, 1);
    expect(rig.camera.position.distanceTo(script.position)).toBeLessThan(1e-6);
    expect(rig.viewTarget.distanceTo(script.look)).toBeLessThan(1e-6);
    expect(rig.camera.fov).toBeCloseTo(20, 6);
    expect(rig.viewDistance).toBeCloseTo(script.position.distanceTo(script.look), 6);
    // Fog follows what is actually framed (eye height, not the Tier 1 chase distance).
    expect(rig.fog.far).toBeCloseTo(rig.viewDistance * TUNING.camera.fogFar, 6);
    let prev = rig.camera.position.clone();
    for (let i = 1; i <= 50; i++) {
      script.weight = i / 50;
      rig.update(0, 100, 100, 1, 1);
      expect(rig.camera.position.distanceTo(prev)).toBeLessThan(15);
      prev = rig.camera.position.clone();
    }
    const end = chase();
    expect(rig.camera.position.distanceTo(end.position)).toBeLessThan(1e-6);
    expect(rig.camera.fov).toBeCloseTo(TUNING.camera.fov, 6);
  });

  it('hands back over the release time, then drops the script', () => {
    const rig = rigAt();
    rig.script = { position: new Vector3(50, 150, 300), look: new Vector3(80, 0, 120), weight: 0.2 };
    rig.releaseScript(1);
    rig.update(0.5, 100, 100, 1, 1);
    expect(rig.script?.weight).toBeGreaterThan(0.2);
    expect(rig.script?.weight).toBeLessThan(1);
    rig.update(0.6, 100, 100, 1, 1);
    expect(rig.script).toBeNull();
    expect(rig.camera.position.distanceTo(chase().position)).toBeLessThan(1e-6);
  });

  it('releases at once with no time, and snap drops a script', () => {
    const rig = rigAt();
    rig.script = { position: new Vector3(0, 150, 0), look: new Vector3(), weight: 0 };
    rig.releaseScript(0);
    expect(rig.script).toBeNull();
    rig.script = { position: new Vector3(0, 150, 0), look: new Vector3(), weight: 0 };
    rig.snap(100, 100, 1, 1);
    expect(rig.script).toBeNull();
  });
});
