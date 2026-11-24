import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { config } from './config';
import { AppError } from './error-codes';

export const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

// アプリが前面にあるときだけトークンを自動更新する
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

/** Edge Function を呼び、エラー時はサーバーが返した日本語のメッセージを投げる */
export async function invokeFunction<T>(name: string, body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body: body ?? {} });
  if (error) {
    // 関数まで届かなかった（通信・中継の失敗）か、関数がエラーを返したかで、エラーコードを分ける（docs/error-codes.md）
    const context = (error as { context?: Response }).context;
    if (!context || typeof context.json !== 'function') {
      throw new AppError(error.name === 'FunctionsFetchError' ? 'IJ-NET-001' : 'IJ-FN-002', '通信に失敗しました。時間をおいてお試しください。', `${name}: ${error.message}`);
    }
    const payload = await context.json().catch(() => null);
    const status = (context as Response).status;
    const code = status === 401 ? 'IJ-AUTH-001' : 'IJ-FN-001';
    throw new AppError(code, payload?.message ?? '処理に失敗しました。時間をおいてお試しください。', `${name} ${status ?? ''}${payload?.error ? ` ${payload.error}` : ''}`.trim());
  }
  return data as T;
}
