/**
 * How a Bunny looks. The type is the Character `look` descriptor (src/data/characters.ts);
 * BunnyView reads it through resolveLook() so partial or missing looks get sensible defaults.
 *
 *   color       base fur colour (roots are darker, see tipColor)
 *   tipColor    colour at the strand tips and the soft rim light
 *   furLength   strand length relative to Lint (1 ≈ 22% of the radius)
 *   fluffiness  0 tidy and dense … 1 wispy, irregular strands and a lumpier core
 *   eyeStyle    'round' | 'sleepy' (half-lidded) | 'sparkly' (big pupils, extra highlights)
 *   glow        0..1 crackling emissive sparkle on the strand tips (Zap's static)
 */
import type { CharacterLook } from '../data/characters';

export type BunnyLook = CharacterLook;
export type EyeStyle = BunnyLook['eyeStyle'];

export const DEFAULT_LOOK: Required<BunnyLook> = {
  color: '#a9adb3',
  tipColor: '#d4d6da',
  furLength: 1,
  fluffiness: 0.4,
  eyeStyle: 'round',
  glow: 0,
};

export function resolveLook(look?: Partial<BunnyLook> | null, fallbackColor?: string): Required<BunnyLook> {
  const color = look?.color ?? fallbackColor ?? DEFAULT_LOOK.color;
  return {
    color,
    tipColor: look?.tipColor ?? color,
    furLength: Math.max(0.2, Math.min(3, look?.furLength ?? DEFAULT_LOOK.furLength)),
    fluffiness: Math.max(0, Math.min(1, look?.fluffiness ?? DEFAULT_LOOK.fluffiness)),
    eyeStyle: look?.eyeStyle ?? DEFAULT_LOOK.eyeStyle,
    glow: Math.max(0, Math.min(1, look?.glow ?? 0)),
  };
}
