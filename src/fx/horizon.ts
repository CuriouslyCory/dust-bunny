/**
 * The Continent's horizon (dusk from the stratosphere): a CSS overlay above the canvas, below the
 * UI layer, with no GPU cost. The planet's limb curves across the top of the view: the ground
 * fades into the fog colour, then a thin warm band (the sun has just set in the west, so it is
 * brighter on the left) and the blue-violet and indigo sky above. Shown only while
 * `.continent` is set on the container (Game.applyAtmosphere toggles it).
 */
export function installHorizon(container: HTMLElement, fog: string): HTMLElement {
  let el = container.querySelector<HTMLElement>(':scope > .fx-horizon');
  if (!el) {
    el = document.createElement('div');
    el.className = 'fx-horizon';
    el.setAttribute('aria-hidden', 'true');
    const canvas = container.querySelector('canvas');
    if (canvas?.nextSibling) container.insertBefore(el, canvas.nextSibling);
    else container.append(el);
  }
  // The limb: an ellipse centred well below the view, so its top edge arcs across the top of the
  // screen (lower at the corners). Stops are fractions of its radius.
  const limb = `radial-gradient(ellipse 118% 108% at 50% 116%, rgba(0,0,0,0) 94.6%, ${fog}cc 96.4%, rgba(255,190,140,0.75) 97.2%, rgba(126,112,190,0.88) 98.2%, rgba(46,40,98,0.92) 99.6%, rgba(24,22,60,0.94) 100%)`;
  // Sunset glow low in the west (left), over the limb only.
  const glow = 'radial-gradient(ellipse 55% 26% at 4% 6%, rgba(255,150,90,0.4), rgba(255,150,90,0) 70%)';
  Object.assign(el.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    background: `${glow}, ${limb}`,
    display: 'none',
  } satisfies Partial<CSSStyleDeclaration>);
  return el;
}

export function showHorizon(el: HTMLElement, on: boolean): void {
  el.style.display = on ? 'block' : 'none';
}

/** Seeded speckle of stars as a tileable PNG data URL (bright few, many faint). */
function starfield(): string {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = S;
  c.height = S;
  const ctx = c.getContext('2d');
  if (!ctx) return '';
  let s = 0x5eed;
  const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 140; i++) {
    const b = rnd();
    const a = 0.25 + b * b * 0.75;
    const r = b > 0.93 ? 1.3 : b > 0.7 ? 0.9 : 0.6;
    const tint = rnd();
    ctx.fillStyle = tint > 0.85 ? `rgba(255,226,190,${a})` : tint > 0.7 ? `rgba(196,214,255,${a})` : `rgba(255,255,255,${a})`;
    ctx.beginPath();
    ctx.arc(rnd() * S, rnd() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return c.toDataURL('image/png');
}

/**
 * The Globe's limb (Earth from orbit): a CSS overlay like the Continent's horizon. The floor's
 * blue haze (the fog colour) brightens into a thin glowing band of atmosphere where the planet
 * curves away across the top of the view; above it is black space with a starfield (masked to
 * the sky) and the hard sun's glare in the top right corner (the side the light comes from,
 * lighting.ts). Shown only on the Globe (Game.applyAtmosphere).
 */
export function installLimb(container: HTMLElement, haze: string): HTMLElement {
  let el = container.querySelector<HTMLElement>(':scope > .fx-limb');
  if (!el) {
    el = document.createElement('div');
    el.className = 'fx-limb';
    el.setAttribute('aria-hidden', 'true');
    const canvas = container.querySelector('canvas');
    if (canvas?.nextSibling) container.insertBefore(el, canvas.nextSibling);
    else container.append(el);
  }
  el.replaceChildren();
  const shape = 'ellipse 125% 100% at 50% 113%';
  const sky = document.createElement('div');
  const limb = `radial-gradient(${shape}, rgba(0,0,0,0) 95.2%, ${haze}b0 97.6%, rgba(120,190,255,0.85) 98.9%, rgba(200,236,255,0.97) 99.25%, rgba(70,130,230,0.95) 99.6%, rgba(10,20,52,0.98) 100%, rgba(2,3,10,1) 101.5%)`;
  const sun = 'radial-gradient(circle at 93% 3%, rgba(255,255,255,1) 0, rgba(255,255,250,0.95) 0.9%, rgba(255,246,226,0.45) 2.6%, rgba(255,240,215,0.12) 7%, rgba(255,240,215,0) 16%)';
  Object.assign(sky.style, { position: 'absolute', inset: '0', background: `${sun}, ${limb}` } satisfies Partial<CSSStyleDeclaration>);
  const stars = document.createElement('div');
  const mask = `radial-gradient(${shape}, transparent 100.2%, #000 101.5%)`;
  Object.assign(stars.style, {
    position: 'absolute',
    inset: '0',
    backgroundImage: `url(${starfield()})`,
    backgroundSize: '256px 256px',
    maskImage: mask,
    webkitMaskImage: mask,
  } satisfies Partial<CSSStyleDeclaration>);
  el.append(sky, stars);
  Object.assign(el.style, { position: 'absolute', inset: '0', pointerEvents: 'none', display: 'none' } satisfies Partial<CSSStyleDeclaration>);
  return el;
}
