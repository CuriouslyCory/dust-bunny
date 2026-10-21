/**
 * Render quality. 'high' (default): soft shadows, pixel ratio up to 2, dense fur, dust motes.
 * 'low': no shadows, pixel ratio 1, fewer fur shells and particles.
 *
 *   import { setQuality } from './fx/quality';
 *   setQuality('low');   // the Settings screen does this (src/ui/install.ts)
 *
 * Game applies renderer/shadow changes immediately; fur and particle counts are read when a Run
 * starts. `?quality=low` in the URL sets the initial level (persistence lives in UI settings).
 */
export type Quality = 'high' | 'low';

const listeners = new Set<(q: Quality) => void>();

function initial(): Quality {
  if (typeof window === 'undefined') return 'high';
  const p = new URLSearchParams(window.location.search).get('quality');
  return p === 'low' ? 'low' : 'high';
}

let current: Quality = initial();

export function getQuality(): Quality {
  return current;
}

export function setQuality(q: Quality): void {
  if (q === current) return;
  current = q;
  for (const l of listeners) l(q);
}

/** Subscribe to quality changes; returns an unsubscribe function. */
export function onQualityChange(fn: (q: Quality) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
