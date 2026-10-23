/** 公開してよい設定だけを置く（EXPO_PUBLIC_ はアプリに埋め込まれる）。Ledra の API キーなどの秘密情報は置かない */
export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  /** 【要確認】利用規約・プライバシーポリシーの文面は別途用意される。URL が決まったら設定する */
  termsUrl: process.env.EXPO_PUBLIC_TERMS_URL ?? '',
  privacyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL ?? '',
};

export const APP_OWNER = '株式会社たにぐち自動車';
export const DEVELOPER = '株式会社HOLY';
