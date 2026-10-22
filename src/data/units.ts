/**
 * Length units for readouts (HUD radius, results, leaderboards). Real lengths are centimetres;
 * an Area's world unit is `AREAS[area].unit` cm (src/data/areas.ts). The readout ladder steps up
 * a rung once a value reaches 1,000 of the current one, so the progress pill keeps its layout from
 * `1.47 / 3 cm` to `14.7 / 30 m` and, in later Areas, AU and light-years.
 */
export type LengthUnitId = 'cm' | 'm' | 'km' | 'Earths' | 'AU' | 'ly';

export const LENGTH_UNITS: ReadonlyArray<{ id: LengthUnitId; cm: number }> = [
  { id: 'cm', cm: 1 },
  { id: 'm', cm: 100 },
  { id: 'km', cm: 1e5 },
  { id: 'Earths', cm: 6.371e8 },
  { id: 'AU', cm: 1.496e13 },
  { id: 'ly', cm: 9.461e17 },
];

/** The ladder rung for a real length: the smallest rung is `from`, then up while the value is ≥ 1,000. */
export function lengthUnitFor(cm: number, from: LengthUnitId = 'cm'): { id: LengthUnitId; cm: number } {
  let i = Math.max(0, LENGTH_UNITS.findIndex((u) => u.id === from));
  while (i < LENGTH_UNITS.length - 1 && Math.abs(cm) / LENGTH_UNITS[i]!.cm >= 1000) i++;
  return LENGTH_UNITS[i]!;
}

/**
 * A number for a readout: 2 significant digits below 0.1 (the Solar System's `0.0085 AU`), 2
 * decimals below 10, 1 below 1,000, none above.
 */
export function formatAmount(v: number): string {
  const a = Math.abs(v);
  if (a > 0 && a < 0.1) return v.toPrecision(2);
  return v.toFixed(a < 10 ? 2 : a < 1000 ? 1 : 0);
}

/** "1.47 cm", "14.7 m", "1.20 km": a real length (cm) on the ladder starting at `from`. */
export function formatLength(cm: number, from: LengthUnitId = 'cm'): string {
  const u = lengthUnitFor(cm, from);
  return `${formatAmount(cm / u.cm)} ${u.id}`;
}

/** Compact threshold text: "3 cm", "30 m", "1.5 km" (no trailing zeros). */
export function formatThreshold(cm: number, unit: { id: LengthUnitId; cm: number }): string {
  return `${Number((cm / unit.cm).toPrecision(3))} ${unit.id}`;
}
