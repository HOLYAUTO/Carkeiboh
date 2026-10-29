/**
 * スポンサー広告枠に出す1件の選び方（React・通信に依存しない部分。tests/lib/sponsor-pick.test.ts で確かめる）。
 * 同じ場所に複数の広告があるときは、重み（weight）に比例した割合で出す。
 */

export type SponsorPlacement = 'home' | 'costs' | 'shops';

export const SPONSOR_PLACEMENT_LABELS: Record<SponsorPlacement, string> = {
  home: 'ホーム',
  costs: '維持費',
  shops: '整備工場',
};

export interface PickableAd {
  id: string;
  placements: string[];
  weight: number;
  is_published: boolean;
  starts_on: string;
  ends_on: string | null;
}

/** 掲載中か（日付は日本時間の YYYY-MM-DD。両端を含む）。スタッフは下書きも読めるため、画面でも必ず確かめる */
export function isSponsorLive(ad: Pick<PickableAd, 'is_published' | 'starts_on' | 'ends_on'>, today: string): boolean {
  return ad.is_published && ad.starts_on <= today && (ad.ends_on == null || ad.ends_on >= today);
}

/**
 * placement に出せる掲載中の広告から1件を選ぶ。なければ null。
 * random は 0 以上 1 未満（画面を開くたびに Math.random() を1回だけ引き、同じ画面では同じ広告を出し続ける）
 */
export function pickSponsorAd<T extends PickableAd>(ads: readonly T[], placement: SponsorPlacement, today: string, random: number): T | null {
  const candidates = ads
    .filter((a) => a.placements.includes(placement) && isSponsorLive(a, today))
    // 並びを決めておき、同じ random なら同じ広告になるようにする
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const total = candidates.reduce((sum, a) => sum + Math.max(1, a.weight), 0);
  if (total === 0) return null;
  let point = Math.min(Math.max(random, 0), 0.999999) * total;
  for (const a of candidates) {
    point -= Math.max(1, a.weight);
    if (point < 0) return a;
  }
  return candidates[candidates.length - 1];
}
