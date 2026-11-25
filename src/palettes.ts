/**
 * 画面の色の組み合わせ（利用者が「設定 → 画面の色」で選ぶ）。
 * 画面の明るさ（ダーク／ライト）とアクセントカラーを別々に選べる。既定は ガレージ・ダーク × レッド（社内資料/要確認一覧.md 36）。
 * React に依存しない値だけを置き、文字と背景のコントラストを単体テスト（tests/lib/palettes.test.ts）で確かめる。
 */

export type BaseId = 'dark' | 'light';
export type AccentId = 'red' | 'blue' | 'green' | 'purple' | 'pink' | 'silver';

export interface ThemeChoice {
  base: BaseId;
  accent: AccentId;
}

export const DEFAULT_THEME: ThemeChoice = { base: 'dark', accent: 'red' };

export interface Palette {
  background: string;
  card: string;
  surfaceVariant: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  border: string;
  /** 塗り（ボタン・選択中のタブ・グラフ）。onAccent の文字を載せられる濃さ */
  accent: string;
  accentPressed: string;
  /** accent で塗った上に載せる文字・アイコン */
  onAccent: string;
  /** 背景に置くアクセント色の文字・アイコン。accent のままだと文字が読みにくい組み合わせがあるため分けている */
  accentText: string;
  accentSoft: string;
  /** 注意表示の色（アクセントとは別に固定。状態は必ず文字とアイコンでも伝える） */
  caution: string;
  /** caution で塗った上に載せる文字 */
  onCaution: string;
  cautionBackground: string;
  track: string;
  white: string;
  /** ナンバープレート風の表示（自家用の白地に緑の文字） */
  plateBackground: string;
  plateText: string;
}

type BaseColors = Omit<Palette, 'accent' | 'accentPressed' | 'onAccent' | 'accentText' | 'accentSoft'>;

export const BASES: Record<BaseId, { label: string; description: string; isDark: boolean; colors: BaseColors }> = {
  dark: {
    label: 'ダーク',
    description: '黒い画面。夜のガレージのイメージ',
    isDark: true,
    colors: {
      background: '#0b0b0d',
      card: '#161619',
      surfaceVariant: '#232328',
      text: '#f4f4f5',
      textSecondary: '#a1a1aa',
      textTertiary: '#8a8a93',
      border: '#2a2a30',
      caution: '#ffb020',
      onCaution: '#1a1100',
      cautionBackground: 'rgba(255,176,32,0.12)',
      track: '#2a2a30',
      white: '#ffffff',
      plateBackground: '#f2f2ee',
      plateText: '#0f4d2e',
    },
  },
  light: {
    label: 'ライト',
    description: '明るい画面。日なたでも読みやすい',
    isDark: false,
    colors: {
      background: '#f4f4f6',
      card: '#ffffff',
      surfaceVariant: '#e6e6eb',
      text: '#1b1b1f',
      textSecondary: '#55555e',
      textTertiary: '#6e6e76',
      border: '#d9d9e0',
      caution: '#a65200',
      onCaution: '#ffffff',
      cautionBackground: 'rgba(240,147,0,0.12)',
      track: '#e3e3e8',
      white: '#ffffff',
      plateBackground: '#f2f2ee',
      plateText: '#0f4d2e',
    },
  },
};

interface AccentTone {
  accent: string;
  accentPressed: string;
  onAccent: string;
  accentText: string;
  /** accentSoft の元の色（r,g,b）と濃さ */
  softRgb: string;
  softAlpha: number;
}

export const ACCENTS: Record<AccentId, { label: string; note: string; dark: AccentTone; light: AccentTone }> = {
  red: {
    label: 'レッド',
    note: 'ドリフト車の赤',
    dark: { accent: '#e60012', accentPressed: '#c2000f', onAccent: '#ffffff', accentText: '#ff4b55', softRgb: '230,0,18', softAlpha: 0.16 },
    light: { accent: '#d7000f', accentPressed: '#b0000c', onAccent: '#ffffff', accentText: '#c4000e', softRgb: '215,0,15', softAlpha: 0.09 },
  },
  blue: {
    label: 'ブルー',
    note: '落ち着いた青',
    dark: { accent: '#1f6feb', accentPressed: '#1a5ccc', onAccent: '#ffffff', accentText: '#5ea2ff', softRgb: '31,111,235', softAlpha: 0.18 },
    light: { accent: '#0b5cd5', accentPressed: '#094bb0', onAccent: '#ffffff', accentText: '#0a55c4', softRgb: '11,92,213', softAlpha: 0.09 },
  },
  green: {
    label: 'グリーン',
    note: 'レーシングスーツのライムグリーン',
    dark: { accent: '#9be22d', accentPressed: '#86c626', onAccent: '#0b0b0d', accentText: '#a6eb3c', softRgb: '155,226,45', softAlpha: 0.15 },
    light: { accent: '#2f7d0f', accentPressed: '#25650b', onAccent: '#ffffff', accentText: '#2b730d', softRgb: '47,125,15', softAlpha: 0.1 },
  },
  purple: {
    label: 'パープル',
    note: '夜の街のネオン',
    dark: { accent: '#7c3aed', accentPressed: '#6a2fd0', onAccent: '#ffffff', accentText: '#b597ff', softRgb: '124,58,237', softAlpha: 0.2 },
    light: { accent: '#6d28d9', accentPressed: '#5b21b6', onAccent: '#ffffff', accentText: '#6424cc', softRgb: '109,40,217', softAlpha: 0.09 },
  },
  pink: {
    label: 'ピンク',
    note: '明るいマゼンタ',
    dark: { accent: '#d61f72', accentPressed: '#b81962', onAccent: '#ffffff', accentText: '#ff6fae', softRgb: '214,31,114', softAlpha: 0.18 },
    light: { accent: '#c2185b', accentPressed: '#a1134b', onAccent: '#ffffff', accentText: '#b0154f', softRgb: '194,24,91', softAlpha: 0.09 },
  },
  silver: {
    label: 'シルバー',
    note: '色を使わないモノトーン',
    dark: { accent: '#d4d4d8', accentPressed: '#b9b9bf', onAccent: '#0b0b0d', accentText: '#e4e4e7', softRgb: '212,212,216', softAlpha: 0.14 },
    light: { accent: '#2a2a2f', accentPressed: '#18181b', onAccent: '#ffffff', accentText: '#2a2a2f', softRgb: '42,42,47', softAlpha: 0.08 },
  },
};

export const BASE_IDS = Object.keys(BASES) as BaseId[];
export const ACCENT_IDS = Object.keys(ACCENTS) as AccentId[];

export function buildPalette(choice: ThemeChoice): Palette {
  const base = BASES[choice.base];
  const tone = ACCENTS[choice.accent][choice.base];
  return {
    ...base.colors,
    accent: tone.accent,
    accentPressed: tone.accentPressed,
    onAccent: tone.onAccent,
    accentText: tone.accentText,
    accentSoft: `rgba(${tone.softRgb},${tone.softAlpha})`,
  };
}

/** 保存していた値を読み直す。知らない値（古い版・壊れた値）は既定に戻す */
export function parseThemeChoice(raw: string | null | undefined): ThemeChoice {
  if (!raw) return DEFAULT_THEME;
  try {
    const v = JSON.parse(raw) as Partial<ThemeChoice>;
    const base = BASE_IDS.includes(v.base as BaseId) ? (v.base as BaseId) : DEFAULT_THEME.base;
    const accent = ACCENT_IDS.includes(v.accent as AccentId) ? (v.accent as AccentId) : DEFAULT_THEME.accent;
    return { base, accent };
  } catch {
    return DEFAULT_THEME;
  }
}
