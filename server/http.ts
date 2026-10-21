/** JSON responses and request helpers shared by the Vercel functions in api/. */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
  }
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

/** Turns a thrown error into a JSON response. Unknown errors (DB/network) become 503 `unavailable`. */
export function errorResponse(err: unknown, tag: string): Response {
  if (err instanceof HttpError) return json(err.status, { error: err.code, message: err.message, ...err.extra }, err.headers);
  console.error(`[${tag}]`, err);
  return json(503, { error: 'unavailable', message: 'The server is temporarily unavailable.' });
}

export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > maxBytes) throw new HttpError(413, 'too_large', 'Request body too large.');
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, 'too_large', 'Request body too large.');
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, 'bad_json', 'Request body must be JSON.');
  }
}
