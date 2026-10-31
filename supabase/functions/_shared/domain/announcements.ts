/**
 * お知らせ（運営からのアップデート・修正のお知らせと、たにぐち自動車の最新情報）の出し分け。
 * アプリのホーム・一覧と、プッシュ通知を送る announce-dispatch の両方で使う。
 */

export type AnnouncementCategory = 'app_update' | 'shop_news';

export const ANNOUNCEMENT_LABELS: Record<AnnouncementCategory, string> = {
  app_update: 'アップデート・修正',
  shop_news: 'たにぐち自動車の最新情報',
};

export interface AnnouncementLike {
  category: AnnouncementCategory;
  title: string;
  body: string;
  /** ISO 8601 の日時 */
  published_at: string;
}

/**
 * 利用者に見せるお知らせ（新しい順）。たにぐち自動車の最新情報は「受け取る」を選んだ利用者だけ
 * （まだ選んでいない null は受け取らない扱い）
 */
export function visibleAnnouncements<T extends AnnouncementLike>(items: readonly T[], shopNewsOptIn: boolean | null): T[] {
  return items
    .filter((a) => a.category === 'app_update' || shopNewsOptIn === true)
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
}

/** 一覧を最後に開いた後に公開されたもの。一度も開いていなければすべて未読 */
export function unreadAnnouncements<T extends AnnouncementLike>(items: readonly T[], seenAt: string | null): T[] {
  if (!seenAt) return [...items];
  const seen = Date.parse(seenAt);
  return items.filter((a) => Date.parse(a.published_at) > seen);
}

/** プッシュ通知の本文の長さの上限（端末の通知欄で数行に収まる程度） */
export const ANNOUNCEMENT_PUSH_BODY_MAX = 100;

/** プッシュ通知の題名と本文。題名の頭に、どこからのお知らせかを付ける */
export function announcementPushMessage(a: Pick<AnnouncementLike, 'category' | 'title' | 'body'>): { title: string; body: string } {
  const prefix = a.category === 'shop_news' ? 'たにぐち自動車より' : 'イジログからのお知らせ';
  const flat = a.body.replace(/\s+/g, ' ').trim();
  const chars = [...flat];
  const body = chars.length > ANNOUNCEMENT_PUSH_BODY_MAX ? `${chars.slice(0, ANNOUNCEMENT_PUSH_BODY_MAX - 1).join('')}…` : flat;
  return { title: `${prefix}：${a.title}`, body };
}
