import { describe, expect, it } from 'vitest';
import { ACCENT_IDS, BASE_IDS, buildPalette, DEFAULT_THEME, parseThemeChoice } from '../../src/palettes';

/** '#rrggbb' または 'rgba(r,g,b,a)'（下の色に重ねた結果）を [r,g,b] にする */
function rgb(color: string, under: [number, number, number] = [0, 0, 0]): [number, number, number] {
  if (color.startsWith('#')) {
    const n = parseInt(color.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const [r, g, b, a] = color.replace(/rgba\(|\)/g, '').split(',').map(Number);
  return [r, g, b].map((c, i) => c * a + under[i] * (1 - a)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 2.1 のコントラスト比 */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const combos = BASE_IDS.flatMap((base) => ACCENT_IDS.map((accent) => ({ base, accent })));

describe.each(combos)('配色 $base × $accent', (choice) => {
  const p = buildPalette(choice);
  const bg = rgb(p.background);
  const card = rgb(p.card);

  it('本文・補足の文字は背景とカードの上で 4.5:1 以上', () => {
    for (const surface of [bg, card]) {
      expect(contrast(rgb(p.text), surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(rgb(p.textSecondary), surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('アクセント色の文字は背景・カード・薄い塗りの上で 4.5:1 以上', () => {
    for (const surface of [bg, card, rgb(p.accentSoft, card), rgb(p.accentSoft, bg)]) {
      expect(contrast(rgb(p.accentText), surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('アクセントの塗りの上の文字は 4.5:1 以上', () => {
    expect(contrast(rgb(p.onAccent), rgb(p.accent))).toBeGreaterThanOrEqual(4.5);
  });

  it('アクセントの塗り（グラフ・スイッチ・選択中の線）は背景から 3:1 以上で見分けられる', () => {
    expect(contrast(rgb(p.accent), bg)).toBeGreaterThanOrEqual(3);
    expect(contrast(rgb(p.accent), card)).toBeGreaterThanOrEqual(3);
  });

  it('注意の文字は背景・カード・注意の塗りの上で 4.5:1 以上', () => {
    for (const surface of [bg, card, rgb(p.cautionBackground, card), rgb(p.cautionBackground, bg)]) {
      expect(contrast(rgb(p.caution), surface)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(rgb(p.onCaution), rgb(p.caution))).toBeGreaterThanOrEqual(4.5);
  });

  it('アイコン用の薄い文字色はカードの上で 3:1 以上', () => {
    expect(contrast(rgb(p.textTertiary), card)).toBeGreaterThanOrEqual(3);
  });
});

describe('保存した配色の読み直し', () => {
  it('正しい値はそのまま', () => {
    expect(parseThemeChoice('{"base":"light","accent":"blue"}')).toEqual({ base: 'light', accent: 'blue' });
  });

  it('未保存・壊れた値は既定（ダーク×レッド）', () => {
    expect(parseThemeChoice(null)).toEqual(DEFAULT_THEME);
    expect(parseThemeChoice('not json')).toEqual(DEFAULT_THEME);
    expect(DEFAULT_THEME).toEqual({ base: 'dark', accent: 'red' });
  });

  it('知らない値は項目ごとに既定へ戻す', () => {
    expect(parseThemeChoice('{"base":"sepia","accent":"blue"}')).toEqual({ base: 'dark', accent: 'blue' });
    expect(parseThemeChoice('{"base":"light","accent":"gold"}')).toEqual({ base: 'light', accent: 'red' });
  });
});
