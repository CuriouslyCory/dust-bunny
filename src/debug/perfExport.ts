/**
 * Getting a frame report (./perfRecorder.ts) off the device:
 *   send      POSTs it to the dev server's `/__perf` (vite.config.ts), which writes
 *             perf-reports/<timestamp>-<platform>.json on the developer's machine. `pnpm dev` and
 *             the apps' E2E builds (whose API origin is that dev server) only.
 *   download  a .json file; the web only (the apps' WebViews have no download handler).
 *   copy      the clipboard, or a selectable textarea where the clipboard is refused.
 * Fallback from an inspector (Safari Web Inspector, chrome://inspect):
 *   copy(JSON.stringify(__game.debugTools.perf.report()))
 */
import { apiUrl, NATIVE_APP } from '../platform';
import { PERF_ROUTE, perfReportFileName } from './perfUpload';
import type { PerfReport } from './perfRecorder';

export interface SendResult {
  ok: boolean;
  /** Where the dev server wrote it, relative to the project root. */
  file?: string;
  error?: string;
}

/** Whether there may be a dev server to send to. */
export const CAN_SEND: boolean = import.meta.env.DEV || !!import.meta.env.VITE_E2E;
export const CAN_DOWNLOAD: boolean = !NATIVE_APP;

const SEND_TIMEOUT_MS = 15_000;

export async function sendReport(report: PerfReport): Promise<SendResult> {
  // A timer, not AbortSignal.timeout: the iOS app supports iOS 15, whose WebView lacks it.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), SEND_TIMEOUT_MS);
  try {
    // text/plain keeps it a simple request (no preflight); the server parses it anyway.
    const res = await fetch(apiUrl(PERF_ROUTE), {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify(report),
      signal: ctrl.signal,
    });
    const body = (await res.json().catch(() => null)) as { file?: unknown; error?: unknown } | null;
    if (res.ok && typeof body?.file === 'string') return { ok: true, file: body.file };
    return { ok: false, error: typeof body?.error === 'string' ? body.error : `HTTP ${res.status}` };
  } catch (err) {
    if (ctrl.signal.aborted) return { ok: false, error: 'timeout' };
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export function downloadReport(report: PerfReport): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 1)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = perfReportFileName(new Date(), report.meta.platform);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Copies `text`; where the clipboard is refused, shows it selected in a textarea (`'textarea'`). */
export async function copyText(text: string): Promise<'clipboard' | 'textarea'> {
  try {
    await navigator.clipboard.writeText(text);
    return 'clipboard';
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.readOnly = true;
    ta.setAttribute('aria-label', 'Frame report JSON');
    ta.style.cssText = 'position:fixed;inset:10% 5%;z-index:100000;font:11px ui-monospace,monospace';
    ta.addEventListener('blur', () => ta.remove());
    document.body.append(ta);
    ta.focus();
    ta.select();
    return 'textarea';
  }
}
