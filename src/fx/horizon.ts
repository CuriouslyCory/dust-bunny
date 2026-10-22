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
