/**
 * デザイン：ガレージ・ダーク（2026-10-25、docs/design/patterns.html の 01 案）。
 * たにぐち自動車（ツアラーV専門店・ドリフト・オイル）の雰囲気に合わせ、黒い画面にアクセントの赤を1色だけ使う。
 * 注意表示だけ琥珀色。赤が「危険」に見えないよう、状態は必ず文字とアイコンでも伝える。
 * 01 6章の指定（Ledra Web 版のトークン）からの変更のため、発注元の合意待ち（docs/open-questions.md 36）。
 */
export const colors = {
  background: '#0b0b0d',
  card: '#161619',
  surfaceVariant: '#232328',
  text: '#f4f4f5',
  textSecondary: '#a1a1aa',
  textTertiary: '#8a8a93',
  border: '#2a2a30',
  /** 塗り（ボタン・選択中のタブ・グラフ）。白い文字を載せられる濃さ */
  accent: '#e60012',
  accentPressed: '#c2000f',
  /** 暗い背景に置く赤い文字・アイコン。accent のままだと文字が読みにくいため明るくしている */
  accentText: '#ff4b55',
  accentSoft: 'rgba(230,0,18,0.16)',
  caution: '#ffb020',
  /** caution で塗った上に載せる文字 */
  onCaution: '#1a1100',
  cautionBackground: 'rgba(255,176,32,0.12)',
  track: '#2a2a30',
  white: '#ffffff',
  /** ナンバープレート風の表示（自家用の白地に緑の文字） */
  plateBackground: '#f2f2ee',
  plateText: '#0f4d2e',
} as const;

/**
 * 文字は M PLUS 2（太さは600まで）。金額・距離・日付は Saira（スピードメーター風の数字）で、桁をそろえて出す。
 * 汎用的な書体の組み合わせ（Noto Sans JP ＋ Geist Mono）から、クルマのアプリらしい組み合わせに変えた（2026-10-25 決定）
 */
export const fonts = {
  regular: 'MPLUS2_400Regular',
  medium: 'MPLUS2_500Medium',
  semibold: 'MPLUS2_600SemiBold',
  num: 'Saira_400Regular',
  numMedium: 'Saira_500Medium',
} as const;

/** 小さな部品 6 / ボタン・入力 10 / カード 14 / シート 18 */
export const radius = { chip: 6, control: 10, card: 14, sheet: 18, pill: 999 } as const;

/** タップ領域は44px以上 */
export const MIN_TAP = 44;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;

/** 暗い背景では影がほとんど見えないため、カードは枠線（colors.border）で区切り、影は控えめに残す */
export const cardShadow = {
  shadowColor: '#000000',
  shadowOpacity: 0.3,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
  elevation: 2,
} as const;
