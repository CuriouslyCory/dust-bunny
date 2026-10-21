/**
 * Audio wiring: event-bus subscribers only. installAudio(game) is called once at boot.
 * The AudioContext is created on the first user gesture. M toggles mute.
 *
 * UI sounds are automatic for any `button` inside #ui (hover/focus tick, click pop), so
 * screens from other modules get them for free. Opt out with `data-sfx="off"`.
 *
 * Other modules can trigger sounds directly with getAudio()?.sfx.pickup() etc.
 */
import type { Game } from '../game/game';
import { isBossHazard, onLoose } from '../ui/looseEvents';
import { settings } from '../ui/settings';
import { AudioEngine } from './engine';
import { Music } from './music';
import { Sfx } from './sfx';
import { musicIntensity } from './voices';

export interface GameAudio {
  engine: AudioEngine;
  sfx: Sfx;
  music: Music;
}

let instance: GameAudio | null = null;

export function getAudio(): GameAudio | null {
  return instance;
}

export function installAudio(game: Game): GameAudio {
  if (instance) return instance;
  const engine = new AudioEngine();
  const sfx = new Sfx(engine);
  const music = new Music(engine);
  instance = { engine, sfx, music };

  settings.subscribe((s) => engine.setVolumes({ master: s.masterVolume, music: s.musicVolume, sfx: s.sfxVolume, muted: s.muted }));

  // Unlock on first gesture (and re-resume after iOS interruptions).
  const unlock = (): void => {
    engine.unlock();
    music.start();
  };
  for (const ev of ['pointerdown', 'keydown', 'touchend'] as const) window.addEventListener(ev, unlock, { capture: true, passive: true });

  document.addEventListener('visibilitychange', () => (document.hidden ? engine.suspend() : engine.resume()));

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    settings.update({ muted: !settings.value.muted });
  });

  // ── Game events ──────────────────────────────────────────────
  let boss = false;
  let lastHazardAbsorb = -1;
  let lastVictory = -10;
  const setIntensity = (): void => {
    music.setBoss(boss);
    music.intensity = musicIntensity(game.run?.tier ?? 1, boss);
  };
  const ev = game.events;

  ev.on('runStarted', () => {
    boss = false;
    setIntensity();
  });
  ev.on('debrisAbsorbed', (e) => {
    const b = game.run?.bunny;
    const pan = b ? Math.max(-0.6, Math.min(0.6, (e.position.x - b.x) / (b.radius * 8))) : 0;
    if (e.kind === 'hazard') lastHazardAbsorb = engine.now;
    sfx.absorb(e.size, e.radius, e.kind, pan);
  });
  onLoose(ev, 'hazardAbsorbed', (p) => {
    // Only if core's debrisAbsorbed (kind 'hazard') didn't already cover it.
    if (engine.now - lastHazardAbsorb > 0.1) sfx.absorb(typeof p.size === 'number' ? p.size : 20, game.run?.bunny.radius ?? 30, 'hazard');
  });
  ev.on('tierUp', (e) => {
    sfx.tierUp(e.tier);
    setIntensity();
  });
  ev.on('bunnyDamaged', () => sfx.damage());
  ev.on('bunnyHealed', () => sfx.heal());
  ev.on('bunnyDied', () => {
    sfx.death();
    music.intensity = 0.1;
  });
  ev.on('dashStarted', () => sfx.dash());
  ev.on('pickupCollected', () => sfx.pickup());
  ev.on('perkApplied', () => sfx.perk());
  onLoose(ev, 'perkChosen', () => sfx.perk());

  const startBoss = (): void => {
    if (boss) return;
    boss = true;
    sfx.bossWarning();
    setIntensity();
  };
  onLoose(ev, 'bossSpawned', startBoss);
  ev.on('hazardSpawned', (e) => {
    if (isBossHazard(e.defId)) startBoss();
  });
  const endBoss = (): void => {
    boss = false;
    setIntensity();
  };
  onLoose(ev, 'bossDefeated', endBoss);
  ev.on('hazardRemoved', (e) => {
    if (isBossHazard(e.defId)) endBoss();
  });

  const victory = (): void => {
    if (engine.now - lastVictory < 3) return;
    lastVictory = engine.now;
    sfx.victory();
  };
  onLoose(ev, 'victory', victory);
  ev.on('runEnded', (e) => {
    boss = false;
    music.setBoss(false);
    music.intensity = 0.1;
    if (e.reason === 'victory') victory();
  });

  ev.on('paused', (e) => engine.setDuck(e.reason === 'paused' ? 0.35 : 0.6));
  ev.on('resumed', () => engine.setDuck(1));
  ev.on('screenChanged', (e) => {
    if (e.to === 'title' || e.to === 'results') {
      engine.setDuck(1);
      music.setBoss(false);
      music.intensity = 0.1;
    }
  });

  // ── UI sounds (delegated) ────────────────────────────────────
  const ui = game.uiLayer;
  let keyboardFocus = false;
  window.addEventListener('keydown', () => (keyboardFocus = true), { capture: true });
  window.addEventListener('pointerdown', () => (keyboardFocus = false), { capture: true });
  const target = (e: Event): HTMLElement | null => {
    const el = (e.target as HTMLElement | null)?.closest?.('button, input[type="range"]') as HTMLElement | null;
    return el && el.dataset.sfx !== 'off' && !(el as HTMLButtonElement).disabled ? el : null;
  };
  ui.addEventListener('pointerover', (e) => {
    const el = target(e);
    if (el && (e as PointerEvent).pointerType === 'mouse' && !el.contains(e.relatedTarget as Node | null)) sfx.uiHover();
  });
  ui.addEventListener('focusin', (e) => {
    if (keyboardFocus && target(e)) sfx.uiHover();
  });
  ui.addEventListener('click', (e) => {
    if (target(e)) {
      engine.unlock();
      sfx.uiClick();
    }
  });

  return instance;
}
