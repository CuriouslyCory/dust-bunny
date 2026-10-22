/**
 * Settings and How-to-Play screens. Both are reachable from the title and pause menus:
 * game.go('settings', { back: 'paused' }). Esc / Back returns to `back` (default: paused
 * mid-Run, else title).
 */
import type { Game } from '../../game/game';
import { button, focusFirst, handleMenuKeys, isKey, panel, scrollArea, segmented, slider, toggle } from '../components';
import { h, registerScreen, screenRegistry } from '../screens';
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
      mute.el.querySelector('.field-hint')?.classList.add('key-hint');
      const quality = segmented<GraphicsQuality>({
        label: 'Graphics',
        value: s.quality,
        options: [
          { value: 'low', label: 'Fast' },
          { value: 'high', label: 'Pretty' },
        ],
        onChange: (v) => settings.update({ quality: v }),
      });
      const motion = toggle({ label: 'Reduced motion', hint: 'Calmer UI animation', value: s.reducedMotion, onChange: (v) => settings.update({ reducedMotion: v }) });
      const fps = toggle({ label: 'Show FPS', value: s.showFps, onChange: (v) => settings.update({ showFps: v }) });
      const captions = toggle({ label: 'Story captions', hint: 'The narrator: Tier-ups, bosses, Areas, Keepsakes', value: s.storyCaptions, onChange: (v) => settings.update({ storyCaptions: v }) });
      const replay = button('Replay intro', () => game.go('intro', { done: () => game.go('settings', { back }) }), { size: 'sm', icon: '▶' });
      const replayRow = h('div', { className: 'field' }, replay);
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
        captions.set(v.storyCaptions);
      });
      const done = button('Done', () => game.go(back), { variant: 'primary' });
      const reset = button('Reset to defaults', () => settings.reset(), { variant: 'ghost', size: 'sm' });
      const el = panel(
        { title: 'Settings', className: 'settings-panel' },
        scrollArea('settings-body', section('Sound', master.el, music.el, sfx.el, mute.el), section('Display', quality.el, motion.el, fps.el, touch.el), section('Story', captions.el, replayRow)),
        h('div', { className: 'panel-actions' }, reset, done),
      );
      return {
        el,
        enter(params) {
          back = backTarget(game, params);
          replayRow.hidden = !screenRegistry.has('intro');
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
      const touchRow = (icon: string, what: string): HTMLElement => h('li', {}, h('span', { className: 'keys touch-key', textContent: icon }), h('span', { textContent: what }));
      const done = button('Got it!', () => game.go(back), { variant: 'primary' });
      const el = panel(
        { title: 'How to play', className: 'howto-panel' },
        scrollArea(
          'howto-body',
          h(
            'section',
            { className: 'howto-controls' },
            h('h3', { textContent: 'Controls' }),
            h(
              'ul',
              { className: 'controls-list controls-keys' },
              keyRow(['W', 'A', 'S', 'D'], 'Roll (or arrow keys)'),
              keyRow(['Click'], 'Hold to roll toward the cursor'),
              keyRow(['Space'], 'Dash (Shift works too)'),
              keyRow(['E'], 'Ability: tap (Lint, Zap) or hold (Tumble). Right-click works too'),
              keyRow(['Esc'], 'Pause'),
              keyRow(['M'], 'Mute sound'),
            ),
            h('p', { className: 'touch-note' }, h('strong', { textContent: 'On touch: ' }), 'put your thumb anywhere on the left half to steer, tap the dash button on the right.'),
            // Shown instead of the keys on touch devices (.touch on the root).
            h(
              'ul',
              { className: 'controls-list controls-touch' },
              touchRow('👍', 'Drag anywhere on the left half to roll'),
              touchRow('💨', 'Tap the dash button on the right'),
              touchRow('✨', 'Tap or hold the Ability button next to it'),
              touchRow('⏸️', 'Pause button, top right'),
            ),
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
              rule('🚪', 'Head outside', 'Absorb the Robo-Vac 9000 at Dust Titan and the front door opens onto the neighborhood.'),
              rule('🏙️', 'Hit the city', 'Absorb the Street Sweeper at Dust Cyclone and the road barrier lifts: roll on downtown.'),
              rule('🛣️', 'Take the highway', 'Absorb the Garbage Truck at Dust Colossus and the on-ramp opens onto the region.'),
              rule('🌍', 'Roll west', 'Out in the region, towns are Debris. Absorb the Incinerator at Dust Front and the motorway west opens onto the continent.'),
              rule('🚀', 'Leave the atmosphere', 'On the continent, mountain ranges are Debris. Absorb the Ice Sheet at Dust Pangaea and the launch corridor north opens up to orbit.'),
              rule('🛰️', 'Escape orbit', 'In orbit the map wraps around the planet: roll off one edge and you come back on the other. Absorb the Orbital Sweeper at Dust Planet and the escape trajectory over the North Pole opens.'),
              rule('👑', 'Win', 'In the Solar System, planets are Debris; Jupiter is in the way until Dust Star. Absorb the Sun at Dust Star.'),
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
