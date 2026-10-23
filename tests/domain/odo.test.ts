import { describe, expect, it } from 'vitest';
import { checkOdoEntry, effectiveOdo, normalizeReadings } from '../../supabase/functions/_shared/domain/odo.ts';

describe('ODO の確認', () => {
  const readings = [
    { date: '2026-09-01', odoKm: 40000 },
    { date: '2026-10-01', odoKm: 41000 },
  ];

  it('普通の値は確認なし', () => {
    expect(checkOdoEntry({ date: '2026-10-20', odoKm: 41500 }, readings)).toEqual([]);
  });

  it('前回より小さい値は確認を出す', () => {
    const w = checkOdoEntry({ date: '2026-10-20', odoKm: 40990 }, readings);
    expect(w.map((x) => x.code)).toEqual(['lower_than_previous']);
  });

  it('前回から1日あたり1,000kmを超えて増えた値は確認を出す', () => {
    // 19日で 19,000km までは許容、それを超えると確認
    expect(checkOdoEntry({ date: '2026-10-20', odoKm: 60000 }, readings)).toEqual([]);
    const w = checkOdoEntry({ date: '2026-10-20', odoKm: 60001 }, readings);
    expect(w.map((x) => x.code)).toEqual(['too_fast']);
  });

  it('同じ日の入力は1日として扱う', () => {
    expect(checkOdoEntry({ date: '2026-10-01', odoKm: 42000 }, readings)).toEqual([]);
    expect(checkOdoEntry({ date: '2026-10-01', odoKm: 42001 }, readings).map((x) => x.code)).toEqual(['too_fast']);
  });

  it('過去日付の入力は、その日以前の記録と比べる', () => {
    expect(checkOdoEntry({ date: '2026-09-15', odoKm: 40500 }, readings)).toEqual([]);
  });

  it('最初の記録は確認なし', () => {
    expect(checkOdoEntry({ date: '2026-10-20', odoKm: 10 }, [])).toEqual([]);
  });

  describe('メーター交換', () => {
    const replacements = [{ replacedOn: '2026-10-10', odoBeforeKm: 41200, odoAfterKm: 0 }];

    it('交換後の読みに交換前の走行分を足す', () => {
      expect(effectiveOdo({ date: '2026-10-15', odoKm: 300 }, replacements)).toBe(41500);
      expect(effectiveOdo({ date: '2026-10-05', odoKm: 41100 }, replacements)).toBe(41100);
    });

    it('交換当日は、交換前の最終値より小さい読みを新メーターとみなす', () => {
      expect(effectiveOdo({ date: '2026-10-10', odoKm: 41200 }, replacements)).toBe(41200);
      expect(effectiveOdo({ date: '2026-10-10', odoKm: 5 }, replacements)).toBe(41205);
    });

    it('交換を登録すれば、戻った値でも確認が出ない', () => {
      expect(checkOdoEntry({ date: '2026-10-20', odoKm: 500 }, readings, replacements)).toEqual([]);
    });

    it('並べ替えは実走行距離で行う', () => {
      const n = normalizeReadings([...readings, { date: '2026-10-15', odoKm: 300 }], replacements);
      expect(n.map((r) => r.odoKm)).toEqual([40000, 41000, 41500]);
    });
  });
});
