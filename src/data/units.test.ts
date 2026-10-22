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
  });
});
