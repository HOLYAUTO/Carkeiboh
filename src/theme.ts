/**
 * デザイン（依頼書 6章）。色・文字・角丸は 6章の指定に従い、
 * 画面の組み立て方は Ledra の UI を参考にカーケイボー側で作り直している（コードは流用しない）。
 * アクセントは青の1色だけ。注意表示だけオレンジ系。
 */
export const colors = {
  background: '#f5f5f7',
  card: '#ffffff',
  surfaceVariant: '#e8e8ed',
  text: '#1d1d1f',
  textSecondary: '#555560',
  textTertiary: '#6e6e73',
  border: '#e5e5ea',
  accent: '#0071e3',
  accentPressed: '#0062c4',
  accentSoft: 'rgba(0,113,227,0.08)',
  caution: '#b35c00',
  cautionBackground: 'rgba(240,147,0,0.08)',
  track: '#e8e8ed',
  white: '#ffffff',
} as const;

/** 文字は Noto Sans JP（太さは600まで）。金額・距離・日付は等幅数字 */
export const fonts = {
  regular: 'NotoSansJP_400Regular',
  medium: 'NotoSansJP_500Medium',
  semibold: 'NotoSansJP_600SemiBold',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
} as const;

/** 小さな部品 6 / ボタン・入力 10 / カード 14 / シート 18 */
export const radius = { chip: 6, control: 10, card: 14, sheet: 18, pill: 999 } as const;

/** タップ領域は44px以上 */
export const MIN_TAP = 44;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

export const cardShadow = {
  shadowColor: '#1d1d1f',
  shadowOpacity: 0.06,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
} as const;
