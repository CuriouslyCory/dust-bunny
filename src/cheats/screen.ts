/**
 * The cheats panel ('cheats' screen, opened from the pause menu's secret code field) and the
 * page-wide gags it switches. The rules live in ./cheats.ts.
 *
 *   registerCheatsScreen();                 // at boot, with the other screens
 *   const entry = cheatCodeEntry(game);     // the pause menu's "Enter code" row
 *
 * Sections: warp to any Act, the Bunny's mass (within the Act's range), Perks, and the silly ones.
 * Every gag switches off when the Run ends, is saved or a new one starts.
 */
import { CylinderGeometry, DoubleSide, Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import { AREAS } from '../data/areas';
import { getTier } from '../data/tiers';
import { formatLength } from '../data/units';
import type { Game } from '../game/game';
import type { Run } from '../game/run';
import { perkForRun, perkRegistry } from '../perks';
import { button, focusFirst, handleMenuKeys, isKey, panel, scrollArea, segmented, slider, toggle } from '../ui/components';
import { h, registerScreen, screenRegistry } from '../ui/screens';
import { AREA_ORDER, type AreaId } from '../world/types';
import {
  addPerk,
  cheatsFor,
  isCheatCode,
  massAt,
  massRange,
  massT,
  maxAllPerks,
  pickupPinata,
  setMass,
  sneeze,
  summonCrew,
  unlockCheats,
  warpTo,
} from './cheats';
import './cheats.css';

const NOPE = [
  'Nope. The dust is unimpressed.',
  'Wrong code. Somewhere, a Roomba chuckles.',
  "That's not it. Have you tried blowing on the cartridge?",
  'Incorrect. The couch cushions remain sealed.',
  'Access denied. Please insert more lint.',
];

const NARRATOR = [
  'The narrator says: "I saw that."',
  'The narrator says: "Real dust bunnies earn their size."',
  'The narrator says: "Fine. I won\'t tell the Robo-Vac."',
  'The narrator says: "This is going in the permanent record. Which is also dust."',
  'The narrator says: "Psst. Under the fridge. Trust me."',
  'The narrator says: "Have you considered just… rolling?"',
  'The narrator says: "6767123? Bold. Very bold."',
];

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

/** Act number and name, e.g. "Act 3 · The City". */
const actLabel = (area: AreaId): string => `Act ${AREA_ORDER.indexOf(area) + 1} · ${AREAS[area].name}`;

/** Readout for a radius in the current Area's unit: "1.47 cm", "8.5 km". */
function massLabel(run: Run, radius: number): string {
  return formatLength(radius * AREAS[run.area].unit, AREAS[run.area].readout);
}

type TimeScale = 'snail' | 'normal' | 'espresso';
const TIME_SCALES: Record<TimeScale, number> = { snail: 0.5, normal: 1, espresso: 2 };

/** The page-wide gags: CSS classes on the canvas and UI layer, the hat, the eyes, the clock. */
class Gags {
  partyHat = false;
  animeEyes = false;
  disco = false;
  australia = false;
  comicSans = false;
  time: TimeScale = 'normal';
  private hat: Group | null = null;

  constructor(private readonly game: Game) {}

  apply(): void {
    const g = this.game;
    g.canvas.classList.toggle('cheat-disco', this.disco);
    g.canvas.classList.toggle('cheat-australia', this.australia);
    g.uiLayer.classList.toggle('cheat-comic-sans', this.comicSans);
    g.loop.timeScale = TIME_SCALES[this.time];
    const view = g.view?.bunny;
    if (!view) return;
    view.setEyeScale(this.animeEyes ? 2.1 : 1);
    this.hat ??= partyHat();
    if (this.partyHat) view.accessories.add(this.hat);
    else this.hat.removeFromParent();
  }

  reset(): void {
    this.partyHat = this.animeEyes = this.disco = this.australia = this.comicSans = false;
    this.time = 'normal';
    this.hat?.removeFromParent();
    const g = this.game;
    g.canvas.classList.remove('cheat-disco', 'cheat-australia');
    g.uiLayer.classList.remove('cheat-comic-sans');
    g.loop.timeScale = 1;
  }
}

/** A striped party hat with a pompom, in units of the Bunny's radius (sits on top of the fur). */
function partyHat(): Group {
  const hat = new Group();
  hat.name = 'cheatPartyHat';
  const colors = ['#ff6f86', '#f6b860', '#6cc4a1', '#7ab8e6'];
  const bands = colors.length;
  const height = 0.95;
  const base = 0.36;
  // One frustum per stripe (the top one closes to a point).
  colors.forEach((color, i) => {
    const bottom = base * (1 - i / bands);
    const top = base * (1 - (i + 1) / bands);
    const band = new Mesh(new CylinderGeometry(top, bottom, height / bands, 24, 1, true), new MeshStandardMaterial({ color, roughness: 0.55, side: DoubleSide }));
    band.position.y = (height * (i + 0.5)) / bands;
    hat.add(band);
  });
  const pom = new Mesh(new SphereGeometry(0.09, 16, 12), new MeshStandardMaterial({ color: '#fff7ec', roughness: 1 }));
  pom.position.y = height + 0.04;
  hat.add(pom);
  hat.scale.setScalar(1.3);
  hat.position.set(0.14, 1.12, -0.05);
  hat.rotation.set(-0.12, 0, -0.32);
  return hat;
}

/**
 * The pause menu's secret code row: an "Enter code" button that opens a small field. The right
 * code unlocks cheats for the Run and opens the panel; a wrong one gets a shake and a quip.
 */
export function cheatCodeEntry(game: Game): { el: HTMLElement; reset(): void } {
  const input = h('input', { className: 'cheat-code-input', type: 'text', inputMode: 'numeric', autocomplete: 'off', maxLength: 16, placeholder: 'Secret code', spellcheck: false });
  input.setAttribute('aria-label', 'Secret code');
  const msg = h('p', { className: 'cheat-code-msg' });
  msg.setAttribute('aria-live', 'polite');
  const ok = h('button', { type: 'submit', className: 'btn btn-secondary btn-sm', textContent: 'OK' });
  const form = h('form', { className: 'cheat-code-form' }, input, ok);
  form.hidden = true;
  const open = button('Enter code', () => {
    open.hidden = true;
    form.hidden = false;
    input.focus();
  }, { variant: 'ghost', size: 'sm', icon: '🔑', className: 'cheat-code-open' });
  const close = (): void => {
    form.hidden = true;
    open.hidden = false;
    input.value = '';
    msg.textContent = '';
  };
  // Typing stays in the field (the pause screen's P / Esc, the M mute key); Esc closes it.
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.code === 'Escape') {
      close();
      open.focus();
    }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const run = game.run;
    if (run && !run.ended && isCheatCode(input.value) && screenRegistry.has('cheats')) {
      unlockCheats(game.events, run);
      close();
      game.go('cheats');
      return;
    }
    msg.textContent = pick(NOPE);
    input.value = '';
    form.classList.remove('shake');
    void form.offsetWidth;
    form.classList.add('shake');
  });
  return { el: h('div', { className: 'cheat-code' }, open, form, msg), reset: close };
}

function group(title: string, ...children: Array<Node | string>): HTMLElement {
  return h('fieldset', { className: 'settings-group cheat-group' }, h('legend', { textContent: title }), ...children);
}

export function registerCheatsScreen(): void {
  registerScreen({
    id: 'cheats',
    hud: true,
    create(game) {
      const gags = new Gags(game);
      for (const ev of ['runStarted', 'runEnded', 'runSuspended'] as const) game.events.on(ev, () => gags.reset());

      const status = h('p', { className: 'cheat-status' });
      status.setAttribute('aria-live', 'polite');
      const say = (text: string): void => {
        status.textContent = text;
        status.classList.remove('pop');
        void status.offsetWidth;
        status.classList.add('pop');
      };

      // Acts
      const acts = AREA_ORDER.map((area) => {
        const b = button(actLabel(area), () => {
          const run = game.run;
          if (!run || run.area === area) return;
          warpTo(run, area);
          say(`Whoosh! Welcome to ${AREAS[area].name}.`);
          refresh();
        }, { size: 'sm', className: 'cheat-act' });
        b.dataset.area = area;
        return b;
      });

      // Mass
      const massRangeText = h('p', { className: 'cheat-hint' });
      const mass = slider({
        label: 'Mass',
        value: 0,
        format: (t) => {
          const run = game.run;
          return run ? massLabel(run, massAt(massRange(run.area), t)) : '';
        },
        onInput: (t) => {
          const run = game.run;
          if (!run) return;
          setMass(run, massAt(massRange(run.area), t));
          tierText.textContent = `Tier ${run.tier} · ${getTier(run.tier).name}`;
        },
      });
      const tierText = h('p', { className: 'cheat-hint cheat-tier' });

      // Perks
      const perkButtons = perkRegistry.all().map((def) => {
        const count = h('span', { className: 'cheat-perk-count' });
        const b = button(def.name, () => {
          const run = game.run;
          if (!run) return;
          if (addPerk(run, def.id)) say(`${def.icon} ${def.name}! ${def.description}.`);
          else say(`${def.name} is already as good as it gets.`);
          refresh();
        }, { size: 'sm', icon: def.icon, className: 'cheat-perk' });
        b.append(count);
        b.title = def.description;
        return { def, b, count };
      });
      const maxAll = button('Max them all', () => {
        const run = game.run;
        if (!run) return;
        const n = maxAllPerks(run);
        say(n ? `+${n} Perks. You are now mostly Perk.` : 'Every Perk is already maxed. Greedy!');
        refresh();
      }, { size: 'sm', variant: 'primary', icon: '🎰' });

      // Silly switches
      const sw = (label: string, hint: string, get: () => boolean, set: (v: boolean) => void, quip: (v: boolean) => string) => {
        const t = toggle({
          label,
          hint,
          value: get(),
          onChange: (v) => {
            set(v);
            say(quip(v));
          },
        });
        return { ...t, get };
      };
      const run = (): Run | null => game.run;
      const switches = [
        sw('🛡️ Hypoallergenic', 'Cleaning Hazards can\'t hurt you', () => !!run() && cheatsFor(run()!).invincible, (v) => run() && cheatsFor(run()!).setInvincible(v), (v) => (v ? 'The cleaning crew sneezes on contact.' : 'Allergies are back on the menu.')),
        sw('💨 Ludicrous Zoomies', '2.5× speed. Steering not included', () => !!run() && cheatsFor(run()!).zoomies, (v) => run() && cheatsFor(run()!).setZoomies(v), (v) => (v ? 'NYOOOOM.' : 'Back to a respectable roll.')),
        sw('🥳 Party Hat', 'Every day is a fur-day', () => gags.partyHat, (v) => ((gags.partyHat = v), gags.apply()), (v) => (v ? 'Happy un-birthday, dust bunny!' : 'The party is over. Somebody sweep up.')),
        sw('👀 Anime Eyes', 'Big. Shiny. Determined.', () => gags.animeEyes, (v) => ((gags.animeEyes = v), gags.apply()), (v) => (v ? 'Notice me, Robo-Vac-senpai!' : 'Eyes returned to regulation size.')),
        sw('🪩 Disco Floor', 'The whole world does the hue-hustle', () => gags.disco, (v) => ((gags.disco = v), gags.apply()), (v) => (v ? 'Saturday night lint fever!' : 'The disco ball rolls away.')),
        sw('🙃 Australia Mode', 'Everything upside down. Controls too, sort of', () => gags.australia, (v) => ((gags.australia = v), gags.apply()), (v) => (v ? 'G\'day! Mind the drop bears.' : 'Right side up again. Probably.')),
        sw('🔤 Comic Sans Everything', 'The most serious font', () => gags.comicSans, (v) => ((gags.comicSans = v), gags.apply()), (v) => (v ? 'Typography has left the building.' : 'The designers can breathe again.')),
      ];
      const time = segmented<TimeScale>({
        label: '⏱️ Time',
        value: 'normal',
        options: [
          { value: 'snail', label: '🐌 Snail' },
          { value: 'normal', label: 'Normal' },
          { value: 'espresso', label: '☕ Espresso' },
        ],
        onChange: (v) => {
          gags.time = v;
          gags.apply();
          say(v === 'snail' ? 'Everything is… so… relaxed…' : v === 'espresso' ? 'TIME HAS HAD FOUR COFFEES.' : 'Time is back to one second per second.');
        },
      });

      const pranks = h(
        'div',
        { className: 'menu-grid cheat-pranks' },
        button('Sneeze', () => {
          const r = run();
          if (!r) return;
          sneeze(r);
          say('ACHOO! You blew off 15% of yourself.');
          refresh();
        }, { size: 'sm', icon: '🤧' }),
        button('Pickup Piñata', () => {
          const r = run();
          if (!r) return;
          const n = pickupPinata(r);
          say(n ? `🪅 ${n} Pickups burst out! Go get them.` : 'The piñata was empty. Try somewhere roomier.');
        }, { size: 'sm', icon: '🪅' }),
        button('Summon the Crew', () => {
          const r = run();
          if (!r) return;
          const name = summonCrew(r);
          say(name ? `You rang? A ${name} reports for duty.` : 'Nobody answered. The crew is on break.');
        }, { size: 'sm', icon: '🧹' }),
        button('Kiss it Better', () => {
          const r = run();
          if (!r) return;
          r.bunny.heal(r.bunny.maxHealth);
          say('Mwah! All hearts restored.');
        }, { size: 'sm', icon: '❤️' }),
        button('Ask the Narrator', () => say(pick(NARRATOR)), { size: 'sm', icon: '📢' }),
      );

      const refresh = (): void => {
        const r = game.run;
        if (!r) return;
        for (const b of acts) {
          const here = b.dataset.area === r.area;
          b.disabled = here;
          b.classList.toggle('cheat-here', here);
          b.setAttribute('aria-pressed', String(here));
        }
        const range = massRange(r.area);
        mass.set(massT(range, r.bunny.radius));
        massRangeText.textContent = `${AREAS[r.area].name}: ${massLabel(r, range.min)} to ${massLabel(r, range.max)}`;
        tierText.textContent = `Tier ${r.tier} · ${getTier(r.tier).name}`;
        for (const p of perkButtons) {
          // Another Character's Perks are hidden.
          p.b.hidden = !perkForRun(r, p.def);
          const stacks = r.perkStacks(p.def.id);
          const max = p.def.unique ? 1 : (p.def.maxStacks ?? Infinity);
          p.count.textContent = max === Infinity ? `×${stacks}` : `${stacks}/${max}`;
          p.b.classList.toggle('cheat-maxed', stacks >= max);
        }
        for (const s of switches) s.set(s.get());
        time.set(gags.time);
      };

      const resume = button('Resume', () => game.go('playing'), { variant: 'primary', icon: '▶' });
      const back = button('Back', () => game.go('paused'), { variant: 'ghost' });
      const el = panel(
        { title: '🐰 Cheats 🐰', subtitle: 'Dust bunnies don\'t play fair. This Run no longer counts for leaderboards or Keepsakes.', className: 'cheats-panel' },
        scrollArea(
          'cheats-body',
          group('Warp to an Act', h('div', { className: 'cheat-acts' }, ...acts)),
          group('Mass', mass.el, massRangeText, tierText),
          group('Perks', h('div', { className: 'cheat-perks' }, ...perkButtons.map((p) => p.b)), maxAll),
          group('Totally legit options', ...switches.map((s) => s.el), time.el, pranks),
        ),
        status,
        h('div', { className: 'panel-actions' }, back, resume),
      );
      return {
        el,
        enter() {
          status.textContent = '';
          refresh();
          focusFirst(el, resume);
        },
        onKey(e) {
          if (!e.repeat && isKey(e, 'Escape')) {
            game.go('paused');
            return true;
          }
          return handleMenuKeys(e, el);
        },
      };
    },
  });
}
