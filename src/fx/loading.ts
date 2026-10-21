/**
 * Minimal loading indicator (`#loading`) shown while GLB models preload. Reuses an existing
 * #loading element if the page provides one; otherwise creates a small self-styled pill.
 */
export interface LoadingIndicator {
  progress(done: number, total: number): void;
  done(): void;
}

export function showLoading(container: HTMLElement = document.body): LoadingIndicator {
  let el = document.getElementById('loading');
  const created = !el;
  if (!el) {
    el = document.createElement('div');
    el.id = 'loading';
    el.setAttribute('role', 'status');
    Object.assign(el.style, {
      position: 'absolute',
      left: '50%',
      bottom: '12%',
      transform: 'translateX(-50%)',
      padding: '8px 16px',
      borderRadius: '999px',
      background: 'rgba(30,20,14,0.65)',
      color: '#f4e9dc',
      font: '600 14px/1.2 system-ui, sans-serif',
      letterSpacing: '0.03em',
      pointerEvents: 'none',
      transition: 'opacity 0.3s',
      zIndex: '50',
    } satisfies Partial<CSSStyleDeclaration>);
    container.append(el);
  }
  el.textContent = 'Gathering dust…';
  return {
    progress(done, total) {
      el!.textContent = total > 0 ? `Gathering dust… ${Math.round((done / total) * 100)}%` : 'Gathering dust…';
    },
    done() {
      el!.style.opacity = '0';
      setTimeout(() => (created ? el!.remove() : (el!.hidden = true)), 320);
    },
  };
}
