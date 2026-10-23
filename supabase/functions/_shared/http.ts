export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** 例外を JSON の応答にする。想定外の例外の中身は利用者に返さない */
export function handle(fn: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status);
      console.error(e);
      return json({ error: 'internal_error', message: 'サーバーでエラーが発生しました。時間をおいてお試しください。' }, 500);
    }
  };
}

export function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`環境変数 ${name} が設定されていません`);
  return value;
}

export function requirePost(req: Request) {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
}

export async function readJson<T>(req: Request): Promise<Partial<T>> {
  try {
    return (await req.json()) as Partial<T>;
  } catch {
    throw new HttpError(400, 'invalid_json');
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

/** 定期実行（pg_cron）からの呼び出しだけを受け付ける */
export function requireCronSecret(req: Request) {
  const given = req.headers.get('x-cron-secret') ?? '';
  if (!timingSafeEqual(given, requireEnv('CRON_SECRET'))) throw new HttpError(401, 'unauthorized');
}
