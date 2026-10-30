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

/**
 * Origins of the bundled Capacitor apps (iOS serves the game from `capacitor://localhost`,
 * Android from `https://localhost`), which call the production API cross-origin.
 */
export const APP_ORIGINS: readonly string[] = ['capacitor://localhost', 'https://localhost'];

type FetchHandler = { fetch(request: Request): Promise<Response> };

/**
 * Opens a function to the app origins (CORS): answers their preflight and adds
 * `Access-Control-Allow-Origin` to every response for them. No credentials: app requests carry no
 * session cookie, so only anonymous use works from the apps. Other origins (and same-origin
 * requests) get the handler's response unchanged.
 */
export function withAppCors(handler: FetchHandler, methods: readonly string[]): FetchHandler {
  return {
    async fetch(request) {
      const origin = request.headers.get('origin');
      if (!origin || !APP_ORIGINS.includes(origin)) return handler.fetch(request);
      const cors: Record<string, string> = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            ...cors,
            'Access-Control-Allow-Methods': [...methods, 'OPTIONS'].join(', '),
            'Access-Control-Allow-Headers': 'Content-Type, Accept',
            'Access-Control-Max-Age': '86400',
          },
        });
      }
      const res = await handler.fetch(request);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    },
  };
}
