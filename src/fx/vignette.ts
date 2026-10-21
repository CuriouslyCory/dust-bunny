/** Gentle warm vignette: a CSS overlay above the canvas (no GPU cost), below the UI layer. */
export function installVignette(container: HTMLElement): HTMLElement {
  let el = container.querySelector<HTMLElement>(':scope > .fx-vignette');
  if (el) return el;
  el = document.createElement('div');
  el.className = 'fx-vignette';
  el.setAttribute('aria-hidden', 'true');
  Object.assign(el.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
    background: 'radial-gradient(ellipse 75% 70% at 50% 48%, rgba(0,0,0,0) 55%, rgba(38,22,12,0.22) 82%, rgba(26,14,8,0.5) 100%)',
  } satisfies Partial<CSSStyleDeclaration>);
  const canvas = container.querySelector('canvas');
  if (canvas?.nextSibling) container.insertBefore(el, canvas.nextSibling);
  else container.append(el);
  return el;
}
