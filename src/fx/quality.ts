/**
 * Render quality. 'high' (default): soft shadows, pixel ratio up to 2, dense fur, dust motes.
 * 'low': no shadows, pixel ratio 1, fewer fur shells and particles.
 *
 *   import { setQuality } from './fx/quality';
 *   setQuality('low');   // e.g. from a settings menu; applies immediately
 *
 * `?quality=low` in the URL sets the initial level. The choice is remembered in localStorage.
 * Game applies renderer/shadow changes; views read the level when they need it.
 */
export type Quality = 'high' | 'low';

const KEY = 'dustbunny.quality';
const listeners = new Set<(q: Quality) => void>();

function initial(): Quality {
  if (typeof window === 'undefined') return 'high';
  const p = new URLSearchParams(window.location.search).get('quality');
  if (p === 'low' || p === 'high') return p;
  try {
    const s = window.localStorage.getItem(KEY);
    if (s === 'low' || s === 'high') return s;
  } catch {
    /* storage unavailable */
  }
  return 'high';
}

let current: Quality = initial();

export function getQuality(): Quality {
  return current;
}

export function setQuality(q: Quality): void {
  if (q === current) return;
  current = q;
  try {
    window.localStorage.setItem(KEY, q);
  } catch {
    /* storage unavailable */
  }
  for (const l of listeners) l(q);
}

/** Subscribe to quality changes; returns an unsubscribe function. */
export function onQualityChange(fn: (q: Quality) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
