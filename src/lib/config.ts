/** 公開してよい設定だけを置く（EXPO_PUBLIC_ はアプリに埋め込まれる）。Ledra の API キーなどの秘密情報は置かない */
export const config = {
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL ?? '',
  supabasePublishableKey: process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
  /** 【要確認】利用規約・プライバシーポリシーの文面は別途用意される。URL が決まったら設定する */
  termsUrl: process.env.EXPO_PUBLIC_TERMS_URL ?? '',
  privacyUrl: process.env.EXPO_PUBLIC_PRIVACY_URL ?? '',
  /** 【要確認】複数台プランの料金表示（例：「月額 300円」）。決まるまでは「準備中」と出す */
  plusPriceLabel: process.env.EXPO_PUBLIC_PLUS_PRICE_LABEL ?? '',
  /**
   * 紹介用QRコードのリンク。iPhone は新しいアプリID（app.ijilog）の TestFlight の公開リンク（2026-11-02）。
   * App Store で公開したら、ストアのページに差し替える。
   * 【要確認】Android はストアのページ（アプリID から決まる）。公開するまでは開けないため、内部テストの参加リンクに差し替える
   */
  iosInstallUrl: process.env.EXPO_PUBLIC_IOS_INSTALL_URL || 'https://testflight.apple.com/join/j6YE2zFp',
  androidInstallUrl: process.env.EXPO_PUBLIC_ANDROID_INSTALL_URL || 'https://play.google.com/store/apps/details?id=app.ijilog',
};

/** 画面に出すアプリ名。「カーケイボー」は他社の商標登録があるため使わない（2026-10-31 変更） */
export const APP_NAME = 'イジログ';

export const APP_OWNER = '株式会社たにぐち自動車';
export const DEVELOPER = '株式会社HOLY';
