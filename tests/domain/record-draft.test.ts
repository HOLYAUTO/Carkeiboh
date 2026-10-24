import { describe, expect, it } from 'vitest';
import { parseJapaneseNumber, parseSpokenRecord, sanitizeDraft } from '../../supabase/functions/_shared/record-draft.ts';

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
