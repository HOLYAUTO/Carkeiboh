/**
 * お知らせ（アップデート・修正のお知らせ／たにぐち自動車の最新情報）の読み書き。
 * 出し分け（最新情報を受け取るか・未読か）は @domain/announcements.ts の関数を使う。
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { unreadAnnouncements, visibleAnnouncements, type AnnouncementCategory } from '@domain/announcements.ts';
import { useAuth } from './auth';
import { deleteRow, saveRow, unwrap } from './db';
import { supabase } from './supabase';
import type { StaffOrg } from './staff';

export interface AnnouncementRow {
  id: string;
  category: AnnouncementCategory;
  title: string;
  body: string;
  link_url: string | null;
  link_label: string | null;
  is_published: boolean;
  published_at: string;
  expires_at: string | null;
  send_push: boolean;
  pushed_at: string | null;
  org: StaffOrg;
  created_at: string;
  updated_at: string;
}

export interface AnnouncementPrefs {
  /** たにぐち自動車の最新情報を受け取るか。null はまだ選んでいない */
  shopNewsOptIn: boolean | null;
  seenAt: string | null;
}

const COLUMNS = 'id, category, title, body, link_url, link_label, is_published, published_at, expires_at, send_push, pushed_at, org, created_at, updated_at';

export function useAnnouncementPrefs() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['announcementPrefs', userId],
    enabled: !!userId,
    queryFn: async (): Promise<AnnouncementPrefs> => {
      const row = unwrap(
        await supabase.from('profiles').select('shop_news_opt_in, announcements_seen_at').eq('id', userId!).maybeSingle(),
      ) as { shop_news_opt_in: boolean | null; announcements_seen_at: string | null } | null;
      return { shopNewsOptIn: row?.shop_news_opt_in ?? null, seenAt: row?.announcements_seen_at ?? null };
    },
  });
}

/** 公開中のお知らせ（新しい順・50件まで）。スタッフは下書きも読めるため、公開中の条件をここでも付ける */
function usePublishedAnnouncements() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['announcements', userId],
    enabled: !!userId,
    // 公開したお知らせが早めに出るよう、1分たったら（前面に戻したときなどに）読み直す
    staleTime: 60_000,
    queryFn: async () => {
      const now = new Date().toISOString();
      return unwrap(
        await supabase
          .from('announcements')
          .select(COLUMNS)
          .eq('is_published', true)
          .lte('published_at', now)
          .or(`expires_at.is.null,expires_at.gt."${now}"`)
          .order('published_at', { ascending: false })
          .limit(50),
      ) as AnnouncementRow[];
    },
  });
}

/** 利用者に見せるお知らせと未読。最新情報は「受け取る」を選んだ利用者だけに出す */
export function useAnnouncements() {
  const list = usePublishedAnnouncements();
  const prefs = useAnnouncementPrefs();
  const visible = list.data && prefs.data ? visibleAnnouncements(list.data, prefs.data.shopNewsOptIn) : undefined;
  return {
    visible,
    unread: visible && prefs.data ? unreadAnnouncements(visible, prefs.data.seenAt) : undefined,
    prefs: prefs.data,
    isPending: list.isPending || prefs.isPending,
    isError: list.isError || prefs.isError,
    isRefetching: list.isRefetching,
    refetch: () => Promise.all([list.refetch(), prefs.refetch()]),
  };
}

/** 1件（通知から開いたときなど）。一覧に読み込み済みならそれを使う */
export function useAnnouncement(id: string | undefined) {
  const { session } = useAuth();
  const userId = session?.user.id;
  const qc = useQueryClient();
  return useQuery({
    queryKey: ['announcement', userId, id],
    enabled: !!userId && !!id,
    initialData: () => (qc.getQueryData(['announcements', userId]) as AnnouncementRow[] | undefined)?.find((a) => a.id === id),
    queryFn: async () => unwrap(await supabase.from('announcements').select(COLUMNS).eq('id', id!).maybeSingle()) as AnnouncementRow | null,
  });
}

export async function setShopNewsOptIn(optIn: boolean) {
  unwrap(await supabase.rpc('set_shop_news_opt_in', { p_opt_in: optIn }));
}

/** 一覧を開いたら既読にする（ホームの「新しいお知らせ」を消す） */
export async function markAnnouncementsSeen() {
  unwrap(await supabase.rpc('mark_announcements_seen'));
}

// ---------------------------------------------------------------------------
// 運営スタッフ向け（権限は DB の RLS で守る）
// ---------------------------------------------------------------------------

/** 下書き・予約・掲載終了を含むすべて */
export function useManagedAnnouncements() {
  const { session } = useAuth();
  const userId = session?.user.id;
  return useQuery({
    queryKey: ['managedAnnouncements', userId],
    enabled: !!userId,
    queryFn: async () =>
      unwrap(await supabase.from('announcements').select(COLUMNS).order('published_at', { ascending: false }).limit(200)) as AnnouncementRow[],
  });
}

export type AnnouncementStatus = 'draft' | 'scheduled' | 'live' | 'ended';

export function announcementStatus(a: Pick<AnnouncementRow, 'is_published' | 'published_at' | 'expires_at'>, now = Date.now()): AnnouncementStatus {
  if (!a.is_published) return 'draft';
  if (Date.parse(a.published_at) > now) return 'scheduled';
  if (a.expires_at && Date.parse(a.expires_at) <= now) return 'ended';
  return 'live';
}

export const ANNOUNCEMENT_STATUS_LABELS: Record<AnnouncementStatus, string> = {
  draft: '下書き',
  scheduled: '公開予約',
  live: '公開中',
  ended: '掲載終了',
};

export interface AnnouncementInput {
  id?: string;
  category: AnnouncementCategory;
  title: string;
  body: string;
  linkUrl: string | null;
  linkLabel: string | null;
  isPublished: boolean;
  publishedAt: string;
  expiresAt: string | null;
  sendPush: boolean;
}

export async function saveAnnouncement(input: AnnouncementInput): Promise<{ id: string }> {
  const row = {
    category: input.category,
    title: input.title,
    body: input.body,
    link_url: input.linkUrl,
    link_label: input.linkLabel,
    is_published: input.isPublished,
    published_at: input.publishedAt,
    expires_at: input.expiresAt,
    send_push: input.sendPush,
  };
  return saveRow('announcements', row, input.id);
}

export const deleteAnnouncement = (id: string) => deleteRow('announcements', id);
