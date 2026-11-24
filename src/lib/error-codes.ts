/**
 * エラーコード表。画面に出すエラーには必ずコードを付け、`docs/error-codes.md` の表で原因と対処を引けるようにする。
 * コードを足したら `docs/error-codes.md` にも同じコードの行を足す（tests/lib/error-codes.test.ts が両方の一致を確かめる）。
 * React Native に依存しない（試験から読むため）。
 */

export const ERROR_CODES = {
  // 通信・ログイン
  'IJ-NET-001': '通信できませんでした',
  'IJ-AUTH-001': 'ログインの有効期限が切れました',
  // データベース（Supabase）
  'IJ-DB-001': 'この操作をする権限がありません',
  'IJ-DB-002': '同じ内容がすでに登録されています',
  'IJ-DB-003': '入力された値を保存できませんでした',
  'IJ-DB-004': 'データが見つかりませんでした',
  'IJ-DB-009': 'データベースでエラーが起きました',
  // サーバー処理（Edge Functions）
  'IJ-FN-001': 'サーバーの処理でエラーが起きました',
  'IJ-FN-002': 'サーバーの処理に届きませんでした',
  // 端末の許可
  'IJ-PERM-001': 'カメラ・写真を使う許可がありません',
  'IJ-PERM-002': '位置情報を使う許可がありません',
  'IJ-PERM-003': '通知の許可がありません',
  'IJ-PERM-004': 'マイク・音声認識を使えません',
  // 入力・ほかのアプリ
  'IJ-VOICE-001': '音声を聞き取れませんでした',
  'IJ-APP-001': '地図アプリ・ブラウザを開けませんでした',
  'IJ-QR-001': 'QRコードを読み取れませんでした',
  'IJ-NAV-001': '画面を開くための情報が足りません',
  // アプリ内課金（複数台プラン）
  'IJ-BIL-001': 'ストアにつながりませんでした',
  'IJ-BIL-002': 'ストアに複数台プランが見つかりませんでした',
  'IJ-BIL-003': 'ストアの国・地域が日本になっていません',
  'IJ-BIL-004': 'ストアの手続きが途中で終わりました',
  'IJ-BIL-005': 'お支払いの完了を待っています',
  'IJ-BIL-006': '購入を確認できませんでした',
  'IJ-BIL-007': 'Google Play の料金プランを読み込めませんでした',
  'IJ-BIL-008': 'ストアでエラーが起きました',
  // その他
  'IJ-UNK-000': '思いがけないエラーが起きました',
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** コードの付いたエラー。detail はストアやサーバーから返ってきた元の文（原因を調べるため画面にも出す） */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly detail: string | null;
  constructor(code: ErrorCode, message?: string, detail?: string | null) {
    super(message ?? ERROR_CODES[code]);
    this.name = 'AppError';
    this.code = code;
    this.detail = detail ?? null;
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

function rawMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && e !== null && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

const NETWORK_PATTERNS = [/network request failed/i, /failed to fetch/i, /network ?error/i, /timed? ?out/i, /load failed/i, /offline/i];
const AUTH_PATTERNS = [/jwt expired/i, /invalid jwt/i, /auth session missing/i, /refresh token/i, /not authenticated/i];

/**
 * Supabase（PostgREST・Postgres）のエラーをコードにする。
 * pg のエラーコード：42501 権限（RLS）、23505 一意制約、23502/23514/22xxx 値の誤り。PGRST116 は行が無い
 */
export function codeForDbError(err: { code?: string | null; message?: string | null }): ErrorCode {
  const code = err.code ?? '';
  const message = err.message ?? '';
  if (AUTH_PATTERNS.some((p) => p.test(message)) || code === 'PGRST301' || code === 'PGRST303') return 'IJ-AUTH-001';
  if (NETWORK_PATTERNS.some((p) => p.test(message))) return 'IJ-NET-001';
  if (code === '42501' || /row-level security/i.test(message)) return 'IJ-DB-001';
  if (code === '23505') return 'IJ-DB-002';
  if (code === '23502' || code === '23514' || code === '23503' || code.startsWith('22') || code === 'P0001') return 'IJ-DB-003';
  if (code === 'PGRST116') return 'IJ-DB-004';
  return 'IJ-DB-009';
}

/** どんなエラーでもコードにする。AppError ならそのコード、それ以外は文から推し量り、分からなければ fallback */
export function codeOf(e: unknown, fallback: ErrorCode = 'IJ-UNK-000'): ErrorCode {
  if (isAppError(e)) return e.code;
  const message = rawMessage(e);
  if (AUTH_PATTERNS.some((p) => p.test(message))) return 'IJ-AUTH-001';
  if (NETWORK_PATTERNS.some((p) => p.test(message))) return 'IJ-NET-001';
  return fallback;
}

/** 利用者向けの文に、エラーコードを付ける（例外ではない案内用。許可が無いときなど） */
export function withCode(message: string, code: ErrorCode): string {
  return `${message}\n\nエラーコード：${code}`;
}

/** 画面に出す本文。利用者向けの文のあとに、ストア・サーバーからの元の文とエラーコードを付ける */
export function describeError(e: unknown, fallback: ErrorCode = 'IJ-UNK-000'): string {
  const code = codeOf(e, fallback);
  const message = rawMessage(e) || ERROR_CODES[code];
  const detail = isAppError(e) && e.detail && e.detail !== message ? `\n（${e.detail}）` : '';
  return `${message}${detail}\n\nエラーコード：${code}`;
}
