/**
 * スポンサー広告枠の読み書き。Google などの外部の広告サービスは使わず、HOLY・たにぐち自動車が登録した広告だけを出す。
 * 出す1件の選び方は sponsor-pick.ts（単体テストあり）。
 */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './auth';
import { todayJst } from './data';
import { base64ToBytes, deleteRow, saveRow, unwrap } from './db';
import { isSponsorLive, type SponsorPlacement } from './sponsor-pick';
import { supabase } from './supabase';
import type { StaffOrg } from './staff';

export type { SponsorPlacement };

export interface SponsorAdRow {
  id: string;
  org: StaffOrg;
  sponsor_name: string;
  title: string;
  body: string | null;
  image_path: string | null;
  link_url: string | null;
  placements: SponsorPlacement[];
  is_published: boolean;
  starts_on: string;
  ends_on: string | null;
  weight: number;
  created_at: string;
  updated_at: string;
}

const BUCKET = 'sponsor-images';
const COLUMNS = 'id, org, sponsor_name, title, body, image_path, link_url, placements, is_published, starts_on, ends_on, weight, created_at, updated_at';

/** 広告の画像の URL（公開バケット）。差し替えるとパスが変わるので、キャッシュに古い画像が残らない */
export function sponsorImageUrl(path: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

/** 掲載中の広告。スタッフは下書きも読めるため、掲載中の条件をここでも付ける */
export function useSponsorAds() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['sponsorAds', userId],
    enabled: !!userId,
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const today = todayJst();
      const rows = unwrap(
        await supabase.from('sponsor_ads').select(COLUMNS).eq('is_published', true).lte('starts_on', today),
      ) as SponsorAdRow[];
      return rows.filter((a) => isSponsorLive(a, today));
    },
  });
}

export type SponsorAction = 'impression' | 'click';

/** 同じ起動のあいだに同じ枠で同じ広告を何度出しても、表示の記録は1回にする（画面を行き来するたびに数えない） */
const recordedImpressions = new Set<string>();

/** 表示・タップの記録（広告主への報告に使う）。記録できなくても利用者の操作は止めない */
export function logSponsorEvent(adId: string, action: SponsorAction, placement: SponsorPlacement) {
  if (action === 'impression') {
    const key = `${adId}:${placement}`;
    if (recordedImpressions.has(key)) return;
    recordedImpressions.add(key);
  }
  supabase
    .from('sponsor_ad_events')
    .insert({ ad_id: adId, action, placement })
    .then(({ error }) => {
      if (error) console.warn('広告の記録に失敗しました', error.message);
    });
}

// ---------------------------------------------------------------------------
// 運営スタッフ向け（権限は DB の RLS で守る）
// ---------------------------------------------------------------------------

/** 下書き・掲載終了を含むすべて（他社の広告も、枠の空き具合を見るために読める） */
export function useManagedSponsorAds() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['managedSponsorAds', userId],
    enabled: !!userId,
    queryFn: async () =>
      unwrap(await supabase.from('sponsor_ads').select(COLUMNS).order('starts_on', { ascending: false }).limit(200)) as SponsorAdRow[],
  });
}

export interface SponsorStats {
  impressions: number;
  clicks: number;
  users: number;
}

/** 期間（日本時間の日付、両端を含む）の表示・タップの数。自社の広告（HOLY はすべて）の分だけ返る */
export function useSponsorStats(from: string, to: string) {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['sponsorStats', userId, from, to],
    enabled: !!userId,
    queryFn: async () => {
      const rows = unwrap(await supabase.rpc('sponsor_ad_stats', { p_from: from, p_to: to })) as {
        ad_id: string;
        impressions: number;
        clicks: number;
        users: number;
      }[];
      return new Map<string, SponsorStats>(
        rows.map((r) => [r.ad_id, { impressions: Number(r.impressions), clicks: Number(r.clicks), users: Number(r.users) }]),
      );
    },
  });
}

export interface SponsorAdInput {
  id?: string;
  org: StaffOrg;
  sponsorName: string;
  title: string;
  body: string | null;
  imagePath: string | null;
  linkUrl: string | null;
  placements: SponsorPlacement[];
  isPublished: boolean;
  startsOn: string;
  endsOn: string | null;
  weight: number;
}

export async function saveSponsorAd(input: SponsorAdInput): Promise<{ id: string }> {
  const row = {
    org: input.org,
    sponsor_name: input.sponsorName,
    title: input.title,
    body: input.body,
    image_path: input.imagePath,
    link_url: input.linkUrl,
    placements: input.placements,
    is_published: input.isPublished,
    starts_on: input.startsOn,
    ends_on: input.endsOn,
    weight: input.weight,
  };
  return saveRow('sponsor_ads', row, input.id);
}

export async function deleteSponsorAd(ad: Pick<SponsorAdRow, 'id' | 'image_path'>) {
  await deleteRow('sponsor_ads', ad.id);
  if (ad.image_path) await removeSponsorImage(ad.image_path);
}

/** 画像を置き、そのパスを返す。毎回新しい名前で置く（同じ名前で上書きすると、配信のキャッシュで古い画像が出ることがあるため） */
export async function uploadSponsorImage(jpegBase64: string): Promise<string> {
  const path = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, base64ToBytes(jpegBase64), { contentType: 'image/jpeg', upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

export async function removeSponsorImage(path: string) {
  // 消せなくても操作は止めない（どこからも使われない画像が残るだけ）
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) console.warn('広告の画像の削除に失敗しました', error.message);
}
