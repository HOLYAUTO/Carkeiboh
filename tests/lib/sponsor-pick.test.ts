import { describe, expect, it } from 'vitest';
import { isSponsorLive, pickSponsorAd, type PickableAd } from '../../src/lib/sponsor-pick';

const ad = (id: string, partial: Partial<PickableAd> = {}): PickableAd => ({
  id,
  placements: ['home'],
  weight: 1,
  is_published: true,
  starts_on: '2026-10-01',
  ends_on: null,
  ...partial,
});

const today = '2026-10-29';

describe('掲載中かどうか', () => {
  it('公開中で、開始日から終了日まで（両端を含む）', () => {
    expect(isSponsorLive(ad('a', { starts_on: today, ends_on: today }), today)).toBe(true);
    expect(isSponsorLive(ad('a', { starts_on: '2026-10-30' }), today)).toBe(false);
    expect(isSponsorLive(ad('a', { ends_on: '2026-10-28' }), today)).toBe(false);
    expect(isSponsorLive(ad('a', { is_published: false }), today)).toBe(false);
  });
});

describe('出す広告の選び方', () => {
  it('その場所に出せる掲載中の広告がなければ null', () => {
    const ads = [ad('a', { placements: ['costs'] }), ad('b', { is_published: false }), ad('c', { ends_on: '2026-10-01' })];
    expect(pickSponsorAd(ads, 'home', today, 0.5)).toBeNull();
    expect(pickSponsorAd([], 'home', today, 0.5)).toBeNull();
  });

  it('重みに比例して選ぶ（重み 1 と 3 なら 1:3）', () => {
    const ads = [ad('b', { weight: 3 }), ad('a', { weight: 1 })];
    // id の順（a → b）に並べ、0〜0.25 が a、0.25〜1 が b
    expect(pickSponsorAd(ads, 'home', today, 0)?.id).toBe('a');
    expect(pickSponsorAd(ads, 'home', today, 0.24)?.id).toBe('a');
    expect(pickSponsorAd(ads, 'home', today, 0.25)?.id).toBe('b');
    expect(pickSponsorAd(ads, 'home', today, 0.9999999)?.id).toBe('b');
  });

  it('同じ random なら、受け取った順番によらず同じ広告', () => {
    const ads = [ad('x'), ad('y'), ad('z')];
    expect(pickSponsorAd(ads, 'home', today, 0.5)?.id).toBe(pickSponsorAd([...ads].reverse(), 'home', today, 0.5)?.id);
  });

  it('おおよそ重みどおりの割合で出る', () => {
    const ads = [ad('a', { weight: 1 }), ad('b', { weight: 4 })];
    const counts = { a: 0, b: 0 } as Record<string, number>;
    for (let i = 0; i < 1000; i++) counts[pickSponsorAd(ads, 'home', today, i / 1000)!.id]++;
    expect(counts).toEqual({ a: 200, b: 800 });
  });
});
