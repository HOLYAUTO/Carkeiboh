#!/usr/bin/env node
/**
 * アプリのアイコン（assets/*.png）を作る。図柄はタコメーター（オイル交換の目安の表示と同じ形）。
 * 色はアプリの配色（社内資料/要確認一覧.md 36）：黒 #0b0b0d、赤 #e60012。
 * 店の正式なロゴが届いたら差し替える（社内資料/要確認一覧.md 12）。
 * 使い方：NODE_PATH=$(npm root -g) node scripts/make-icons.mjs（プリインストールの Chromium／Playwright で描く）
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Playwright はプロジェクトの依存に入れず、環境にあるものを使う（require なら NODE_PATH・グローバルを探せる）
const { chromium } = createRequire(import.meta.url)('playwright');

const BG = '#0b0b0d';
const RED = '#e60012';
const out = (name) => fileURLToPath(new URL(`../assets/${name}`, import.meta.url));

/** 1024×1024 の座標で、メーターの図柄だけを描く（背景なし） */
function gauge({ mono = false } = {}) {
  const cx = 512;
  const cy = 548;
  const r = 340;
  const start = 135; // 左下から
  const sweep = 270; // 右下まで
  const redFrom = 0.78; // ここから先がレッドゾーン
  const white = '#f4f4f6';
  const grey = mono ? white : '#8a8a92';
  const red = mono ? white : RED;
  const pt = (deg, rad) => {
    const a = (deg * Math.PI) / 180;
    return [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
  };
  const arc = (from, to, rad) => {
    const [x1, y1] = pt(from, rad);
    const [x2, y2] = pt(to, rad);
    const large = to - from > 180 ? 1 : 0;
    return `M ${x1.toFixed(1)} ${y1.toFixed(1)} A ${rad} ${rad} 0 ${large} 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
  };
  const parts = [];
  const redDeg = start + sweep * redFrom;
  // 外周の帯
  parts.push(`<path d="${arc(start, redDeg, r)}" stroke="${white}" stroke-width="34" fill="none" stroke-linecap="round"/>`);
  parts.push(`<path d="${arc(redDeg + 4, start + sweep, r)}" stroke="${red}" stroke-width="34" fill="none" stroke-linecap="round"/>`);
  // 目盛り（大 9 本・小 8 本）
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    const deg = start + sweep * t;
    const major = i % 2 === 0;
    const [x1, y1] = pt(deg, r - 58);
    const [x2, y2] = pt(deg, r - (major ? 128 : 92));
    const color = t >= redFrom - 0.001 ? red : major ? white : grey;
    parts.push(
      `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${major ? 26 : 16}" stroke-linecap="round"/>`,
    );
  }
  // 針（右上を指す）と中心
  const needleDeg = start + sweep * 0.7;
  const [nx, ny] = pt(needleDeg, r - 92);
  const [tx, ty] = pt(needleDeg + 180, 62);
  parts.push(`<line x1="${tx.toFixed(1)}" y1="${ty.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${red}" stroke-width="34" stroke-linecap="round"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="64" fill="${red}"/>`);
  parts.push(`<circle cx="${cx}" cy="${cy}" r="24" fill="${mono ? 'transparent' : BG}"/>`);
  return parts.join('\n');
}

/** size：出力の大きさ。scale：図柄の大きさ（1 で 1024 いっぱいの設計） */
function svg({ size, scale = 1, background = null, mono = false }) {
  const offset = (1024 - 1024 * scale) / 2;
  const bg = background
    ? `<defs><radialGradient id="g" cx="50%" cy="42%" r="70%"><stop offset="0" stop-color="#1c1c21"/><stop offset="1" stop-color="${background}"/></radialGradient></defs><rect width="1024" height="1024" fill="url(#g)"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">${bg}<g transform="translate(${offset} ${offset}) scale(${scale})">${gauge({ mono })}</g></svg>`;
}

const targets = [
  // iOS・ストア：透けない正方形（角丸は OS が付ける）
  { file: 'icon.png', size: 1024, scale: 0.94, background: BG, opaque: true },
  // Android のアダプティブアイコン：前景は中央 66% に収める
  { file: 'android-icon-foreground.png', size: 512, scale: 0.62 },
  { file: 'android-icon-background.png', size: 512, scale: 1, background: BG, empty: true, opaque: true },
  { file: 'android-icon-monochrome.png', size: 432, scale: 0.62, mono: true },
  // 起動画面（背景色は app.json の #0b0b0d）
  { file: 'splash-icon.png', size: 1024, scale: 1 },
  { file: 'favicon.png', size: 48, scale: 0.9, background: BG, opaque: true },
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const t of targets) {
  const body = t.empty
    ? `<svg xmlns="http://www.w3.org/2000/svg" width="${t.size}" height="${t.size}"><rect width="100%" height="100%" fill="${BG}"/></svg>`
    : svg(t);
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${body}</body></html>`);
  await page.locator('svg').screenshot({ path: out(t.file), omitBackground: !t.opaque });
  console.log('wrote', t.file);
}
await browser.close();
