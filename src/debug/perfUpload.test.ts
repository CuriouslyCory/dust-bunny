import { describe, expect, it } from 'vitest';
import { checkPerfUpload, PERF_MAX_BYTES, perfReportFileName, safePlatform } from './perfUpload';

const body = (o: unknown) => {
  const s = JSON.stringify(o);
  return [s, Buffer.byteLength(s)] as const;
};

describe('POST /__perf rules', () => {
  it('accepts a report and takes its platform', () => {
    expect(checkPerfUpload(...body({ schema: 1, meta: { platform: 'android' } }))).toEqual({ ok: true, platform: 'android' });
  });

  it('refuses a body over the cap with 413', () => {
    expect(checkPerfUpload('{"schema":1}', PERF_MAX_BYTES + 1)).toMatchObject({ ok: false, status: 413 });
  });

  it('refuses anything but JSON with a numeric schema', () => {
    expect(checkPerfUpload('<html>', 6)).toMatchObject({ ok: false, status: 400 });
    expect(checkPerfUpload(...body({ schema: '1' }))).toMatchObject({ ok: false, status: 400 });
    expect(checkPerfUpload(...body(null))).toMatchObject({ ok: false, status: 400 });
    expect(checkPerfUpload(...body([1]))).toMatchObject({ ok: false, status: 400 });
  });

  it('reduces the platform to letters', () => {
    expect(safePlatform('../../etc/passwd')).toBe('etcpasswd');
    expect(safePlatform('iOS')).toBe('ios');
    expect(safePlatform(42)).toBe('unknown');
    expect(safePlatform('../')).toBe('unknown');
    expect(checkPerfUpload(...body({ schema: 1 }))).toEqual({ ok: true, platform: 'unknown' });
  });

  it('builds the file name itself: UTC timestamp without colons, platform, clash suffix', () => {
    const at = new Date(Date.UTC(2026, 10, 9, 14, 32, 5, 678));
    expect(perfReportFileName(at, 'android')).toBe('2026-11-09T14-32-05Z-android.json');
    expect(perfReportFileName(at, '../x/', 2)).toBe('2026-11-09T14-32-05Z-x-2.json');
  });
});
