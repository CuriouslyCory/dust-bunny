/**
 * End-to-end test hooks for the native apps, built in only when VITE_E2E is set (main.ts imports
 * this module behind the flag, so release builds leave it out; vite.config.ts fails a release build
 * whose output still contains a marker). See docs/architecture.md, "Native apps".
 *
 * The app can't take URL params, so the scenario is the flag's value:
 *   submit  autostarts a seeded House Run, ends it after a few seconds of play (through `runEnded`,
 *           so it stays ranked) and lands on the results screen, name filled in: the tester taps Submit.
 *   house   autostarts a seeded House Run, rolls on to the Neighborhood (debugTools.nextArea) after a
 *           few seconds of play, and keeps playing there: no results, so no API call (the offline check).
 * Their waits count simulated Run time, not the clock: an emulator's software GL can take longer
 * than that to draw the first frames, and a Run under a second long isn't a valid submission.
 *   other   (e.g. `1`) the markers and `window.__game.debugTools` only.
 * Every scenario exposes `window.__game` and its debugTools without `game.debug`.
 *
 * Markers go to the console (`[e2e] …`, Capacitor/Console in logcat, the App process on iOS) and to
 * one visible status line (`#e2e-status`, aria-live) for screenshots and accessibility snapshots:
 *   title-ready · models <loaded>/<total> · screen <id> · area <id> · run-ended <reason>
 *   board-loaded | board-offline · submit ok <rank> | submit err <code>
 *   external <url>  (any resource from outside the app's origin: the offline proof)
 */
import { exposeDebugTools } from '../debug/debug';
import type { Game } from '../game/game';
import { E2E_MARKER } from '../native/build';
import { leaderboard, LeaderboardError, type LeaderboardClient } from '../net/leaderboard';

const SEED = 'e2e';
const PLAYER_NAME = 'E2E Bunny';
/** Status line: the newest markers, oldest first. */
const SHOWN = 8;

const shown: string[] = [];
let line: HTMLElement | null = null;

export function mark(text: string): void {
  console.log(`${E2E_MARKER} ${text}`);
  shown.push(text);
  if (shown.length > SHOWN) shown.shift();
  if (!line) {
    line = document.createElement('output');
    line.id = 'e2e-status';
    line.setAttribute('role', 'status');
    line.setAttribute('aria-live', 'polite');
    line.style.cssText =
      'position:fixed;left:4px;right:4px;bottom:calc(4px + env(safe-area-inset-bottom));z-index:99999;pointer-events:none;' +
      'font:11px/1.3 ui-monospace,monospace;color:#fff;background:rgba(0,0,0,.6);padding:2px 4px;white-space:pre-wrap;word-break:break-all';
    document.body.append(line);
  }
  line.textContent = `${E2E_MARKER} ${shown.join(' · ')}`;
}

/** From boot: marks every resource loaded from outside the app's origin. */
export function watchExternal(): void {
  if (typeof PerformanceObserver === 'undefined') return;
  const seen = new Set<string>();
  const check = (entries: PerformanceEntryList) => {
    for (const e of entries) {
      let url: URL;
      try {
        url = new URL(e.name, location.href);
      } catch {
        continue;
      }
      if ((url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'capacitor:') && url.origin !== location.origin && !seen.has(url.href)) {
        seen.add(url.href);
        mark(`external ${url.href}`);
      }
    }
  };
  check(performance.getEntriesByType('resource'));
  new PerformanceObserver((list) => check(list.getEntries())).observe({ type: 'resource' });
}

/** Marks every board read and submit the game makes through the leaderboard client. */
function watchLeaderboard(client: LeaderboardClient): void {
  const read = <A extends unknown[], R extends { online: boolean }>(fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      const r = await fn(...a);
      mark(r.online ? 'board-loaded' : 'board-offline');
      return r;
    };
  const submit = <A extends unknown[], R extends { online: boolean; rank: number | null }>(fn: (...a: A) => Promise<R>) =>
    async (...a: A): Promise<R> => {
      try {
        const r = await fn(...a);
        mark(r.online ? `submit ok ${r.rank ?? '-'}` : 'submit err offline');
        return r;
      } catch (err) {
        mark(`submit err ${err instanceof LeaderboardError ? err.code : 'error'}`);
        throw err;
      }
    };
  client.getTop = read(client.getTop);
  client.getAreaTop = read(client.getAreaTop);
  client.submitScore = submit(client.submitScore);
  client.submitAreaScore = submit(client.submitAreaScore);
}

/** Marks screen changes (the manager has no event for them). */
function watchScreens(game: Game): void {
  let last = '';
  window.setInterval(() => {
    const id = game.screens.current?.id ?? '';
    if (id && id !== last) mark(`screen ${(last = id)}`);
  }, 250);
}

const after = (seconds: number, fn: () => void) => window.setTimeout(fn, seconds * 1000);

/** Calls `fn` once the current Run has simulated `seconds`. */
function afterRunTime(game: Game, seconds: number, fn: () => void): void {
  const timer = window.setInterval(() => {
    if (!game.run || game.run.time < seconds) return;
    window.clearInterval(timer);
    fn();
  }, 100);
}

/** After `game.start('title')`: tools, markers and the scenario named by VITE_E2E. */
export function installE2E(game: Game, scenario: string): void {
  const tools = exposeDebugTools(game);
  watchLeaderboard(leaderboard);
  watchScreens(game);
  game.events.on('areaEntered', (e) => mark(`area ${e.area}`));
  game.events.on('runEnded', (e) => mark(`run-ended ${e.reason}`));
  mark('title-ready');

  if (scenario !== 'submit' && scenario !== 'house') return;
  if (!leaderboard.getPlayerName()) leaderboard.setPlayerName(PLAYER_NAME);
  game.nextRunConfig.seed = SEED;
  after(1.5, () => {
    game.startRun();
    if (scenario === 'submit') afterRunTime(game, 4, () => tools.endRun());
    else {
      afterRunTime(game, 5, () => tools.nextArea());
    }
  });
}
