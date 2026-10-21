import { Color, InstancedMesh, Matrix4, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '../core/events';
import { Rng } from '../core/rng';
import type { DebrisType } from '../data/debris';
import { Run } from '../game/run';
import { DebrisField, type Debris } from './debris';
import { DebrisRenderer } from './debrisRenderer';

const types: DebrisType[] = ['a', 'b'].map((id) => ({
  id: `sync-test-${id}`, name: id, size: 2, mass: 1, colors: ['#ff0000', '#00ff00', '#0000ff'],
  recipe: [{ shape: 'box', size: [1, 1, 1] }], rooms: { any: 1 }, tiers: [1, 1],
}));

function meshFor(view: DebrisRenderer, type: DebrisType): InstancedMesh {
  return view.root.getObjectByName(`debris:${type.id}`) as InstancedMesh;
}

function expectInstance(mesh: InstancedMesh, d: Readonly<Debris>): void {
  const matrix = new Matrix4();
  mesh.getMatrixAt(d.slot, matrix);
  const expected = new Matrix4().makeRotationY(d.rotY)
    .scale(new Vector3(d.size, d.size, d.size)).setPosition(d.x, 0, d.z);
  // Instance buffers use Float32 even at city-scale coordinates; use relative tolerance.
  matrix.elements.forEach((value, i) => {
    const target = expected.elements[i]!;
    expect(Math.abs(value - target)).toBeLessThanOrEqual(Math.max(1, Math.abs(target)) * 1e-6);
  });
  const color = new Color();
  mesh.getColorAt(d.slot, color);
  const expectedColor = new Color(d.type.colors[d.colorIndex]!);
  expect(color.r).toBeCloseTo(expectedColor.r, 5);
  expect(color.g).toBeCloseTo(expectedColor.g, 5);
  expect(color.b).toBeCloseTo(expectedColor.b, 5);
}

function expectCurrentView(field: DebrisField, view: DebrisRenderer): void {
  const counts = field.types.map(() => 0);
  field.forEach((d) => {
    counts[d.typeIndex]!++;
    expectInstance(meshFor(view, d.type), d);
  });
  field.types.forEach((type, i) => {
    const mesh = meshFor(view, type);
    if (!mesh) expect(counts[i]).toBe(0);
    else {
      expect(mesh.count).toBe(counts[i]);
      expect(mesh.visible).toBe(counts[i]! > 0);
    }
  });
}

describe('DebrisRenderer synchronization', () => {
  it('writes only moved instances and leaves unchanged buffers untouched', () => {
    const field = new DebrisField(types);
    const rng = new Rng('incremental');
    const moved = field.spawn(0, 1, 2, rng)!;
    const unchanged = field.spawn(0, 3, 4, rng)!;
    const view = new DebrisRenderer(field);
    const mesh = meshFor(view, types[0]!);
    const writeMatrix = vi.spyOn(mesh, 'setMatrixAt');
    const writeColor = vi.spyOn(mesh, 'setColorAt');
    const matrixVersion = mesh.instanceMatrix.version;
    const colorVersion = mesh.instanceColor!.version;
    view.sync();
    expect(writeMatrix).not.toHaveBeenCalled();
    expect(writeColor).not.toHaveBeenCalled();
    expect(mesh.instanceMatrix.version).toBe(matrixVersion);
    expect(mesh.instanceColor!.version).toBe(colorVersion);
    for (let i = 0; i < 100; i++) field.move(moved, i, -i);
    view.sync();
    expect(writeMatrix).toHaveBeenCalledTimes(1);
    expect(writeColor).toHaveBeenCalledTimes(1);
    expectInstance(mesh, moved);
    expectInstance(mesh, unchanged);
    expect(mesh.instanceMatrix.version).toBe(matrixVersion + 1);
    expect(mesh.instanceColor!.version).toBe(colorVersion + 1);
    view.dispose();
  });

  it('synchronizes swap-removal, tail counts, empty buckets and slot reuse', () => {
    const field = new DebrisField(types);
    const rng = new Rng('removal');
    const a = field.spawn(0, 1, 2, rng)!;
    const b = field.spawn(0, 3, 4, rng)!;
    a.colorIndex = 0;
    b.colorIndex = 1;
    const view = new DebrisRenderer(field);
    const mesh = meshFor(view, types[0]!);
    const transient = field.spawn(0, 5, 6, rng)!;
    transient.colorIndex = 2;
    field.move(transient, 7, 8);
    field.remove(a); // unrendered tail moves into an already rendered slot
    field.remove(b); // count-only tail removal
    view.sync();
    expect(mesh.count).toBe(1);
    expectInstance(mesh, transient);
    const write = vi.spyOn(mesh, 'setMatrixAt');
    field.remove(transient);
    view.sync();
    expect(mesh.count).toBe(0);
    expect(mesh.visible).toBe(false);
    expect(write).not.toHaveBeenCalled();
    const replacement = field.spawn(0, 90, 91, rng)!;
    view.sync();
    expect(meshFor(view, types[0]!)).toBe(mesh);
    expect(mesh.count).toBe(1);
    expect(mesh.visible).toBe(true);
    expectInstance(mesh, replacement);
    view.dispose();
  });

  it('rebuilds all matrices and colors when capacity grows past 32', () => {
    const field = new DebrisField(types);
    const rng = new Rng('growth');
    for (let i = 0; i < 32; i++) field.spawn(0, i, -i, rng);
    const view = new DebrisRenderer(field);
    const old = meshFor(view, types[0]!);
    const dispose = vi.spyOn(old, 'dispose');
    const extra = field.spawn(0, 123, 456, rng)!;
    view.sync();
    const grown = meshFor(view, types[0]!);
    expect(grown).not.toBe(old);
    expect(grown.instanceMatrix.count).toBe(64);
    expect(grown.count).toBe(33);
    expect(dispose).toHaveBeenCalledOnce();
    expect(old.parent).toBeNull();
    expectCurrentView(field, view);
    field.move(extra, 222, 333);
    view.sync();
    expectInstance(grown, extra);
    expect(view.root.children).toHaveLength(1);
    view.dispose();
  });

  it('hydrates a late or replacement renderer independently of pending history', () => {
    const field = new DebrisField(types);
    const rng = new Rng('late');
    const d = field.spawn(0, 1, 2, rng)!;
    for (let i = 0; i < 10_000; i++) field.move(d, i, -i);
    for (let i = 0; i < 100; i++) field.remove(field.spawn(1, i, i, rng)!);
    const first = new DebrisRenderer(field);
    expectCurrentView(field, first);
    first.dispose();
    expect(field.pendingChanges).toEqual({ slots: 0, types: 0 });
    const replacement = new DebrisRenderer(field);
    expectCurrentView(field, replacement);
    field.move(d, 12, 34);
    field.spawn(1, 56, 78, rng);
    replacement.sync();
    expectCurrentView(field, replacement);
    replacement.dispose();
  });

  it('resets existing meshes, including types absent from the repopulated field', () => {
    const field = new DebrisField(types);
    const rng = new Rng('reset');
    field.spawn(0, 1, 2, rng);
    field.spawn(1, 3, 4, rng);
    const view = new DebrisRenderer(field);
    const original = meshFor(view, types[1]!);
    field.move(field.spawn(0, 5, 6, rng)!, 7, 8);
    field.reset(500);
    field.clear();
    field.spawn(1, 100, 200, rng);
    view.sync();
    expectCurrentView(field, view);
    expect(meshFor(view, types[0]!).count).toBe(0);
    expect(meshFor(view, types[1]!)).toBe(original);
    field.clear();
    view.sync();
    expectCurrentView(field, view);
    view.dispose();
  });

  it('keeps one renderer coherent through both Area transitions', () => {
    const run = new Run(new EventBus(), { seed: 'render-areas', characterId: 'lint' });
    const view = new DebrisRenderer(run.debris);
    expectCurrentView(run.debris, view);
    for (const area of ['neighborhood', 'city'] as const) {
      run.enterArea(area);
      expect(run.debris.count).toBeGreaterThan(0);
      view.sync();
      expectCurrentView(run.debris, view);
      expect(run.debris.pendingChanges).toEqual({ slots: 0, types: 0 });
    }
    view.dispose();
    run.dispose();
  });
});
