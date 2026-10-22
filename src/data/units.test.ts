import { describe, expect, it } from 'vitest';
import { formatLength, lengthUnitFor } from './units';

describe('length unit ladder', () => {
  it('starts at the Area rung and steps up at 1,000', () => {
    expect(formatLength(1.47)).toBe('1.47 cm');
    expect(formatLength(650)).toBe('650.0 cm');
    expect(formatLength(1470, 'm')).toBe('14.7 m');
    expect(formatLength(3000, 'm')).toBe('30.0 m');
    expect(formatLength(120_000, 'm')).toBe('1.20 km');
    expect(lengthUnitFor(1000).id).toBe('m');
    expect(lengthUnitFor(999).id).toBe('cm');
    expect(lengthUnitFor(1.5e13, 'm').id).toBe('AU');
    // The Solar System's readout starts in AU: two significant digits below 0.1.
    expect(formatLength(0.85 * 1.496e11, 'AU')).toBe('0.0085 AU');
    expect(formatLength(3 * 1.496e11, 'AU')).toBe('0.030 AU');
    expect(formatLength(0.13 * 6.371e8, 'Earths')).toBe('0.13 Earths');
    // The Galaxy's readout starts in light-years (1 unit = 100 ly), the top rung.
    expect(formatLength(0.85 * 9.461e19, 'ly')).toBe('85.0 ly');
    expect(formatLength(3 * 9.461e19, 'ly')).toBe('300.0 ly');
    expect(formatLength(45 * 9.461e19, 'ly')).toBe('4500 ly');
  });
});
