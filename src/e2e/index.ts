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
 *   perf    the frame recorder (src/debug/perf.ts): autostarts a seeded House Run, records from its
 *           start, and sends the report so far to the dev server on every runEnded and on Stop
 *           (keeps recording across Runs until Stop). For a real device: see "Perf reports from a device".
 *   tour    `perf` with nobody playing (./autopilot.ts): the autopilot steers, takes Perks and moves
 *           past paused screens, the Bunny can't die, and every TOUR_AREA_S of Run time it grows a
 *           Tier (halfway) or rolls on to the next Area (debugTools); after the Universe it stops
 *           the recording, which sends the report (about 15 minutes in all).
 *   other   (e.g. `1`) the markers and `window.__game.debugTools` (perf included) only.
 * Every scenario exposes `window.__game` and its debugTools without `game.debug`.
 *
 * Markers go to the console (`[e2e] …`, Capacitor/Console in logcat, the App process on iOS) and to
 * one visible status line (`#e2e-status`, aria-live) for screenshots and accessibility snapshots:
 *   models <loaded>/<expected> · title-ready · screen <id> · area <id> · run-ended <reason>
 *   board-loaded | board-offline · submit ok <rank> | submit err <code>
 *   external <url>  (any resource or fetch from outside the app's origin: the offline proof)
 *   perf recording · perf sent <file> | perf send-failed <error> · tour done
 * `expected` is the manifest's model count when the app was built (VITE_E2E_MODELS, vite.config.ts),
 * so a missing manifest or loader reads as `0/158`, not a passing `0/0`.
 */
import { exposeDebugTools, installPerfTools, type DebugTools } from '../debug/debug';
import type { PerfTools } from '../debug/perf';
import type { Game } from '../game/game';
import { E2E_MARKER } from '../native/build';
import { leaderboard, LeaderboardError, type LeaderboardClient } from '../net/leaderboard';
import { AREA_ORDER } from '../world/types';
import { Autopilot, immortal, keepPlaying } from './autopilot';

const SEED = 'e2e';
const PLAYER_NAME = 'E2E Bunny';
/** `tour`: Run seconds per Area (a Tier up halfway through each), so the nine take 15 minutes. */
const TOUR_AREA_S = 100;
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

/** After the model overrides load: how many did, out of the manifest's count at build time. */
export function modelsLoaded(loaded: number): void {
  mark(`models ${loaded}/${import.meta.env.VITE_E2E_MODELS ?? '?'}`);
}

/**
 * From boot: marks every resource loaded, and every fetch made, outside the app's origin. Fetches
 * are wrapped too because a request that fails offline may leave no Resource Timing entry.
 */
export function watchExternal(): void {
  const seen = new Set<string>();
  const note = (href: string) => {
    let url: URL;
    try {
      url = new URL(href, location.href);
    } catch {
      return;
    }
    if ((url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'capacitor:') && url.origin !== location.origin && !seen.has(url.href)) {
      seen.add(url.href);
      mark(`external ${url.href}`);
    }
  };
  const fetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    note(input instanceof Request ? input.url : String(input));
    return fetch(input, init);
  };
  if (typeof PerformanceObserver === 'undefined') return;
  for (const e of performance.getEntriesByType('resource')) note(e.name);
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) note(e.name);
  }).observe({ type: 'resource' });
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
  // The markers come from here, never from src/debug/perf.ts: release builds must not contain them.
  const recording = scenario === 'perf' || scenario === 'tour';
  const perf = installPerfTools(game, tools, {
    widget: recording,
    onSent: (r) => mark(r.ok ? `perf sent ${r.file}` : `perf send-failed ${r.error ?? ''}`),
  });
  mark('title-ready');

  if (recording) {
    void perf.then((p) => {
      const start = () => {
        if (p.isRecording) return;
        p.start();
        mark('perf recording');
      };
      if (game.run) start();
      else game.events.once('runStarted', start);
      game.events.on('runEnded', () => void p.send());
    });
  }
  if (scenario === 'tour') tour(game, tools, perf);
  if (scenario !== 'submit' && scenario !== 'house' && !recording) return;
  if (!leaderboard.getPlayerName()) leaderboard.setPlayerName(PLAYER_NAME);
  game.nextRunConfig.seed = SEED;
  after(1.5, () => {
    game.startRun();
    if (scenario === 'submit') afterRunTime(game, 4, () => tools.endRun());
    else if (scenario === 'house') afterRunTime(game, 5, () => tools.nextArea());
  });
}

/** The `tour` scenario: the autopilot plays the Run through every Area, then stops the recording. */
function tour(game: Game, tools: DebugTools, perf: Promise<PerfTools>): void {
  game.input.add(new Autopilot(game));
  keepPlaying(game);
  game.events.on('runStarted', () => {
    if (game.run) immortal(game.run);
  });
  // Steps by Run time, so pauses and drafts don't eat into an Area's share.
  const step = (n: number) =>
    afterRunTime(game, (n * TOUR_AREA_S) / 2, () => {
      if (game.run?.ended) return;
      if (n % 2) tools.nextTier();
      else tools.nextArea();
      if (n < AREA_ORDER.length * 2) return step(n + 1);
      void perf.then((p) => {
        if (p.isRecording) p.stop();
        mark('tour done');
      });
    });
  step(1);
}
