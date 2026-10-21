/**
 * Settings and How-to-Play screens. Both are reachable from the title and pause menus:
 * game.go('settings', { back: 'paused' }). Esc / Back returns to `back` (default: paused
 * mid-Run, else title).
 */
import type { Game } from '../../game/game';
import { button, focusFirst, handleMenuKeys, isKey, panel, segmented, slider, toggle } from '../components';
import { h, registerScreen } from '../screens';
import { settings, type GraphicsQuality, type TouchControlsMode } from '../settings';

export interface BackParams {
  back?: string;
}

function backTarget(game: Game, params: unknown): string {
  const back = (params as BackParams | undefined)?.back;
  if (back) return back;
  return game.run && !game.run.ended ? 'paused' : 'title';
}

function section(title: string, ...children: HTMLElement[]): HTMLElement {
  return h('fieldset', { className: 'settings-group' }, h('legend', { textContent: title }), ...children);
}

export function registerMenuScreens(): void {
  registerScreen({
    id: 'settings',
    hud: true,
    create(game) {
      let back = 'title';
      const s = settings.value;
      const master = slider({ label: 'Master', value: s.masterVolume, onInput: (v) => settings.update({ masterVolume: v }) });
      const music = slider({ label: 'Music', value: s.musicVolume, onInput: (v) => settings.update({ musicVolume: v }) });
      const sfx = slider({ label: 'Sound effects', value: s.sfxVolume, onInput: (v) => settings.update({ sfxVolume: v }) });
      const mute = toggle({ label: 'Mute all', hint: 'M', value: s.muted, onChange: (v) => settings.update({ muted: v }) });
      const quality = segmented<GraphicsQuality>({
        label: 'Graphics',
        value: s.quality,
        options: [
          { value: 'low', label: 'Fast' },
          { value: 'high', label: 'Pretty' },
        ],
        onChange: (v) => settings.update({ quality: v }),
      });
      const motion = toggle({ label: 'Reduced motion', hint: 'Calmer camera and UI animation', value: s.reducedMotion, onChange: (v) => settings.update({ reducedMotion: v }) });
      const fps = toggle({ label: 'Show FPS', value: s.showFps, onChange: (v) => settings.update({ showFps: v }) });
      const touch = segmented<TouchControlsMode>({
        label: 'Touch controls',
        value: s.touchControls,
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'on', label: 'On' },
          { value: 'off', label: 'Off' },
        ],
        onChange: (v) => settings.update({ touchControls: v }),
      });
      // Keep controls in sync if settings change elsewhere (M key, reset).
      settings.subscribe((v) => {
        master.set(v.masterVolume);
        music.set(v.musicVolume);
        sfx.set(v.sfxVolume);
        mute.set(v.muted);
        quality.set(v.quality);
        motion.set(v.reducedMotion);
        fps.set(v.showFps);
        touch.set(v.touchControls);
      });
      const done = button('Done', () => game.go(back), { variant: 'primary' });
      const reset = button('Reset to defaults', () => settings.reset(), { variant: 'ghost', size: 'sm' });
      const el = panel(
        { title: 'Settings', className: 'settings-panel' },
        h('div', { className: 'settings-body' }, section('Sound', master.el, music.el, sfx.el, mute.el), section('Display', quality.el, motion.el, fps.el, touch.el)),
        h('div', { className: 'panel-actions' }, reset, done),
      );
      return {
        el,
        enter(params) {
          back = backTarget(game, params);
          focusFirst(el, done);
        },
        onKey(e) {
          if (!e.repeat && isKey(e, 'Escape')) {
            game.go(back);
            return true;
          }
          return handleMenuKeys(e, el);
        },
      };
    },
  });

  registerScreen({
    id: 'howToPlay',
    hud: true,
    create(game) {
      let back = 'title';
      const keyRow = (keys: string[], what: string): HTMLElement =>
        h('li', {}, h('span', { className: 'keys' }, ...keys.map((k) => h('kbd', { textContent: k }))), h('span', { textContent: what }));
      const rule = (icon: string, title: string, text: string): HTMLElement =>
        h('li', { className: 'rule' }, h('span', { className: 'rule-icon', textContent: icon }), h('div', {}, h('strong', { textContent: title }), h('p', { textContent: text })));
      const done = button('Got it!', () => game.go(back), { variant: 'primary' });
      const el = panel(
        { title: 'How to play', className: 'howto-panel' },
        h(
          'div',
          { className: 'howto-body' },
          h(
            'section',
            {},
            h('h3', { textContent: 'Controls' }),
            h(
              'ul',
              { className: 'controls-list' },
              keyRow(['W', 'A', 'S', 'D'], 'Roll (or arrow keys)'),
              keyRow(['Click'], 'Hold to roll toward the cursor'),
              keyRow(['Space'], 'Dash (Shift works too)'),
              keyRow(['Esc'], 'Pause'),
              keyRow(['M'], 'Mute sound'),
            ),
            h('p', { className: 'touch-note' }, h('strong', { textContent: 'On touch: ' }), 'put your thumb anywhere on the left half to steer, tap the dash button on the right.'),
          ),
          h(
            'section',
            {},
            h('h3', { textContent: 'Rules' }),
            h(
              'ul',
              { className: 'rules-list' },
              rule('🧶', 'Absorb Debris', 'Roll into anything smaller than you to stick it on and grow.'),
              rule('🪑', 'Bigger is blocked', 'Things too large are Obstacles. Grow and come back later.'),
              rule('⭐', 'Tier up', 'Each Tier widens the view, opens new rooms and lets you pick a Perk.'),
              rule('🤖', 'Dodge the cleaners', 'Roombas, brooms and mops hurt. Once you are big enough, absorb them too.'),
              rule('👑', 'Win', 'Reach Dust Titan and absorb the Robo-Vac 9000.'),
            ),
          ),
        ),
        h('div', { className: 'panel-actions' }, done),
      );
      return {
        el,
        enter(params) {
          back = backTarget(game, params);
          focusFirst(el, done);
        },
        onKey(e) {
          if (!e.repeat && isKey(e, 'Escape', 'Enter')) {
            game.go(back);
            return true;
          }
          return handleMenuKeys(e, el);
        },
      };
    },
  });
}
