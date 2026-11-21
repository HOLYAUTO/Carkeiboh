/**
 * デザイン：ガレージ・ダーク（2026-10-25、docs/design/patterns.html の 01 案）が既定。
 * たにぐち自動車（ツアラーV専門店・ドリフト・オイル）の雰囲気に合わせ、黒い画面にアクセントの赤を1色だけ使う。
 * 注意表示だけ琥珀色。赤が「危険」に見えないよう、状態は必ず文字とアイコンでも伝える。
 * 01 6章の指定（Ledra Web 版のトークン）からの変更のため、発注元の合意待ち（docs/open-questions.md 36）。
 *
 * 2026-10-29：画面の明るさ（ダーク／ライト）とアクセントカラーを利用者が選べるようにした（docs/open-questions.md 37）。
 * 色の値は src/palettes.ts。画面では useColors() で今の配色を受け取る（選び直すとその場で描き直す）。
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { BASES, buildPalette, DEFAULT_THEME, parseThemeChoice, type Palette, type ThemeChoice } from './palettes';
import { STORAGE_KEYS } from './lib/storage-keys';

export type { Palette, ThemeChoice };

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

interface ThemeValue {
  choice: ThemeChoice;
  colors: Palette;
  isDark: boolean;
  setChoice: (choice: ThemeChoice) => void;
}

const ThemeContext = createContext<ThemeValue>({
  choice: DEFAULT_THEME,
  colors: buildPalette(DEFAULT_THEME),
  isDark: true,
  setChoice: () => {},
});

/**
 * 選んだ配色を端末に覚えておき、次に開いたときも同じ色で出す。
 * 読み込むまでは何も描かない（既定の色が一瞬見えてから切り替わるのを防ぐ。その間はスプラッシュ画面のまま）
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEYS.theme)
      .catch(() => null)
      .then((raw) => setChoiceState((current) => current ?? parseThemeChoice(raw)));
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    AsyncStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(next)).catch(() => {});
  }, []);

  const value = useMemo<ThemeValue | null>(
    () => (choice ? { choice, colors: buildPalette(choice), isDark: BASES[choice.base].isDark, setChoice } : null),
    [choice, setChoice],
  );

  if (!value) return null;
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  return useContext(ThemeContext);
}

/** 今の配色。色を使う部品は必ずこれで受け取る（モジュールの上で色を固定すると、選び直しても変わらない） */
export function useColors(): Palette {
  return useContext(ThemeContext).colors;
}

/**
 * 配色ごとに StyleSheet を作り直して使い回す。
 *   const useStyles = themedStyles((c) => StyleSheet.create({ ... }));
 *   const styles = useStyles();
 */
export function themedStyles<T>(factory: (colors: Palette) => T): () => T {
  const cache = new WeakMap<Palette, T>();
  return function useThemedStyles() {
    const colors = useColors();
    let styles = cache.get(colors);
    if (!styles) {
      styles = factory(colors);
      cache.set(colors, styles);
    }
    return styles;
  };
}
