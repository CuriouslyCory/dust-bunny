/**
 * Small account UI pieces shared by the account screen, the title chip and the leaderboard panel:
 * provider sign-in buttons, an avatar, and the verified / anonymous marks for leaderboard names.
 */
import type { AccountClient, AccountUser } from '../../net/account';
import { PROVIDER_LABELS, type SocialProvider } from '../../shared/account';
import { h } from '../screens';
import './account.css';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Provider marks: Google's four-colour "G" and the Discord logo (from simple-icons, CC0). */
const PROVIDER_LOGOS: Record<SocialProvider, { viewBox: string; paths: Array<[string, string]> }> = {
  google: {
    viewBox: '0 0 48 48',
    paths: [
      ['#FFC107', 'M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z'],
      ['#FF3D00', 'm6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z'],
      ['#4CAF50', 'M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A11.9 11.9 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z'],
      ['#1976D2', 'M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z'],
    ],
  },
  discord: {
    viewBox: '0 0 24 24',
    paths: [
      [
        'currentColor',
        'M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z',
      ],
    ],
  },
};

function providerIcon(provider: SocialProvider): Node {
  const logo = PROVIDER_LOGOS[provider];
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', logo.viewBox);
  svg.setAttribute('class', 'acct-provider-logo');
  svg.setAttribute('aria-hidden', 'true');
  for (const [fill, d] of logo.paths) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', fill);
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}

export interface ProviderButtonsOptions {
  /** 'full': "Continue with Google" buttons; 'compact': small "Google" buttons for inline use. */
  size?: 'full' | 'compact';
}

/** One button per configured provider; empty when there are none. */
export function providerButtons(account: AccountClient, opts: ProviderButtonsOptions = {}): HTMLElement {
  const compact = opts.size === 'compact';
  const el = h('div', { className: `acct-providers${compact ? ' compact' : ''}` });
  // Rebuild only when the provider list changes, so keyboard focus survives other account updates.
  let shown = '';
  const render = () => {
    const { providers } = account.state;
    if (providers.join() === shown) return;
    shown = providers.join();
    el.replaceChildren(
      ...providers.map((p) => {
        const label = compact ? PROVIDER_LABELS[p] : `Continue with ${PROVIDER_LABELS[p]}`;
        const b = h('button', { type: 'button', className: `btn acct-provider acct-provider-${p}` }, providerIcon(p), h('span', { textContent: label }));
        b.addEventListener('click', () => void account.signIn(p));
        return b;
      }),
    );
  };
  account.subscribe(render);
  return el;
}

/** Round avatar: the provider picture, or the name's first letter. */
export function avatar(user: AccountUser, className = ''): HTMLElement {
  const el = h('span', { className: `acct-avatar ${className}`.trim() });
  el.setAttribute('aria-hidden', 'true');
  const initial = () => {
    el.textContent = [...(user.name.trim() || '?')][0]!.toUpperCase();
  };
  if (user.image) {
    const img = h('img', { src: user.image, alt: '', referrerPolicy: 'no-referrer', loading: 'lazy' });
    img.onerror = () => {
      img.remove();
      initial();
    };
    el.append(img);
  } else initial();
  return el;
}

/** ✓ after a leaderboard name submitted by a signed-in player. */
export function verifiedMark(): HTMLElement {
  const el = h('span', { className: 'lb-verified', textContent: '✓', title: 'Verified: posted by a signed-in player' });
  el.setAttribute('aria-label', 'verified');
  return el;
}

/** Muted tag after a leaderboard name submitted without an account. */
export function anonymousMark(): HTMLElement {
  return h('span', { className: 'lb-anon', textContent: 'anon', title: 'Anonymous: posted without signing in' });
}
