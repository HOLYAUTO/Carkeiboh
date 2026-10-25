import { describe, expect, it } from 'vitest';
import {
  isDraftSufficient,
  mergeDrafts,
  parseJapaneseNumber,
  parseReceiptText,
  parseSpokenRecord,
  sanitizeDraft,
} from '../../supabase/functions/_shared/record-draft.ts';

const TODAY = '2026-10-24';

describe('数の読み取り', () => {
  it.each([
    ['4500', 4500],
    ['4千500', 4500],
    ['1万2000', 12000],
    ['1.2万', 12000],
    ['三千五百', 3500],
    ['四万千', 41000],
    ['十万', 100000],
  ])('%s → %d', (token, expected) => {
    expect(parseJapaneseNumber(token)).toBe(expected);
  });

  it('数でない文字があれば読まない', () => {
    expect(parseJapaneseNumber('4500a')).toBeNull();
  });
});

describe('音声の解析', () => {
  it('給油：日付・金額・走行距離・項目を読む', () => {
    expect(parseSpokenRecord('昨日ガソリン満タンで4,500円、走行距離41200キロ', TODAY)).toEqual({
      date: '2026-10-23',
      amountYen: 4500,
      odoKm: 41200,
      category: 'fuel',
    });
  });

  it('全角数字と km を読む', () => {
    expect(parseSpokenRecord('４１２００ｋｍ', TODAY)).toEqual({ odoKm: 41200, category: 'odometer' });
  });

  it('漢数字の金額を読む', () => {
    expect(parseSpokenRecord('高速代 三千五百円', TODAY)).toMatchObject({ amountYen: 3500, category: 'parking_toll' });
  });

  it('オイル交換とフィルター交換', () => {
    expect(parseSpokenRecord('今日オイル交換 フィルターも交換 3万5000キロ', TODAY)).toEqual({
      date: TODAY,
      odoKm: 35000,
      filterChanged: true,
      category: 'oil_change',
      note: 'オイル交換 フィルターも交換',
    });
    expect(parseSpokenRecord('オイル交換 フィルターは交換なし', TODAY).filterChanged).toBe(false);
  });

  it('月日の指定。年がなく未来になる日付は前の年', () => {
    expect(parseSpokenRecord('10月3日 洗車 1500円', TODAY)).toEqual({
      date: '2026-10-03',
      amountYen: 1500,
      category: 'maintenance',
      note: '洗車',
    });
    expect(parseSpokenRecord('12月30日 駐車場 800円', TODAY).date).toBe('2025-12-30');
  });

  it('N日前', () => {
    expect(parseSpokenRecord('3日前に給油 5000円', TODAY).date).toBe('2026-10-21');
  });

  it('項目名だけの言葉はメモにしない', () => {
    expect(parseSpokenRecord('ガソリン 4500円', TODAY).note).toBeUndefined();
  });

  it('読み取れなければ空', () => {
    expect(parseSpokenRecord('えーと', TODAY)).toEqual({ note: 'えーと' });
    expect(parseSpokenRecord('', TODAY)).toEqual({});
  });
});

describe('読み取り結果の検証', () => {
  it('範囲外・形式違いの値は捨てる', () => {
    expect(
      sanitizeDraft(
        { date: '2026-13-01', amountYen: -1, odoKm: 3_000_000, category: 'gasoline', filterChanged: 'yes', note: '  ' },
        TODAY,
      ),
    ).toEqual({});
  });

  it('未来の日付は翌日まで', () => {
    expect(sanitizeDraft({ date: '2026-10-25' }, TODAY)).toEqual({ date: '2026-10-25' });
    expect(sanitizeDraft({ date: '2026-10-26' }, TODAY)).toEqual({});
  });

  it('正しい値は残す', () => {
    expect(
      sanitizeDraft({ date: '2026-10-01', amountYen: 4500.4, odoKm: 41200, category: 'fuel', filterChanged: false, note: 'ENEOS' }, TODAY),
    ).toEqual({ date: '2026-10-01', amountYen: 4500, odoKm: 41200, category: 'fuel', filterChanged: false, note: 'ENEOS' });
  });
});

describe('端末の OCR の解析', () => {
  it('ガソリンスタンドのレシート：合計・日付・項目を拾い、小計・お預りは使わない', () => {
    const lines = [
      'ENEOS 〇〇SS',
      '2026/10/23(金) 18:42',
      'レギュラー 32.15L',
      '小計 ¥4,500',
      '(内消費税 ¥409)',
      '合計 ¥4,500',
      'お預り ¥5,000',
      'お釣 ¥500',
    ];
    expect(parseReceiptText(lines, 'fuel', TODAY)).toEqual({ amountYen: 4500, date: '2026-10-23', category: 'fuel' });
  });

  it('「合計」と金額が別の行でも拾う。令和の日付も読む', () => {
    const lines = ['令和8年10月20日', 'タイヤ交換', 'ご請求金額', '32,800円'];
    expect(parseReceiptText(lines, 'maintenance', TODAY)).toEqual({ amountYen: 32800, date: '2026-10-20', category: 'maintenance' });
  });

  it('オイル交換の明細：走行距離を拾い、次回の目安は使わない', () => {
    const lines = ['作業日 26.10.24', 'エンジンオイル交換', 'オイルエレメント', '走行距離 41,200km', '次回交換目安 46,200km', '合計 6,380円'];
    expect(parseReceiptText(lines, 'oil_change', TODAY)).toEqual({
      date: '2026-10-24',
      odoKm: 41200,
      amountYen: 6380,
      filterChanged: true,
      category: 'oil_change',
    });
  });

  it('メーターの写真：時刻・トリップを除いた数が1つなら総走行距離', () => {
    expect(parseReceiptText(['12:34', 'TRIP A 123.4', '41200', '22°C'], 'odometer', TODAY)).toEqual({ odoKm: 41200 });
    // 候補が2つあれば決めない（サーバーで読み直す）
    expect(parseReceiptText(['41200', '1234'], 'odometer', TODAY)).toEqual({});
  });

  it('ラベルのない数を走行距離にするのはメーターの写真だけ。金額・電話番号・日付は候補にしない', () => {
    expect(parseReceiptText(['オイル交換', '6380円'], 'oil_change', TODAY).odoKm).toBeUndefined();
    expect(parseReceiptText(['TEL 03-1234-5678', '2026/10/24', '¥6380', '41200'], 'odometer', TODAY).odoKm).toBe(41200);
  });

  it('未来すぎる日付・合計のないレシートは拾わない', () => {
    expect(parseReceiptText(['2027/01/01', '¥1,200'], 'other', TODAY)).toEqual({});
  });
});

describe('端末の読み取りで足りるか', () => {
  it('走行距離だけ・オイル交換は走行距離があれば足りる', () => {
    expect(isDraftSufficient('odometer', { odoKm: 41200 })).toBe(true);
    expect(isDraftSufficient('oil_change', { amountYen: 6000 })).toBe(false);
  });

  it('支出は金額と日付の両方が要る', () => {
    expect(isDraftSufficient('fuel', { amountYen: 4500, date: TODAY })).toBe(true);
    expect(isDraftSufficient('fuel', { amountYen: 4500 })).toBe(false);
  });

  it('サーバーの結果を優先し、足りない項目を端末の結果で埋める', () => {
    expect(mergeDrafts({ amountYen: 4500, date: TODAY }, { amountYen: 4800, odoKm: 41200 })).toEqual({
      amountYen: 4800,
      date: TODAY,
      odoKm: 41200,
    });
  });
});
