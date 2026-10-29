import { describe, expect, it } from 'vitest';
import {
  ANNOUNCEMENT_PUSH_BODY_MAX,
  announcementPushMessage,
  unreadAnnouncements,
  visibleAnnouncements,
  type AnnouncementLike,
} from '../../supabase/functions/_shared/domain/announcements.ts';

const a = (title: string, category: AnnouncementLike['category'], publishedAt: string): AnnouncementLike => ({
  title,
  category,
  body: '本文',
  published_at: publishedAt,
});

const items = [
  a('古い修正', 'app_update', '2026-10-01T00:00:00Z'),
  a('新しいオイル', 'shop_news', '2026-10-20T00:00:00Z'),
  a('新しい版', 'app_update', '2026-10-25T00:00:00Z'),
];

describe('見せるお知らせ', () => {
  it('最新情報を受け取る利用者にはすべてを新しい順に出す', () => {
    expect(visibleAnnouncements(items, true).map((x) => x.title)).toEqual(['新しい版', '新しいオイル', '古い修正']);
  });

  it('受け取らない・まだ選んでいない利用者には、たにぐち自動車の最新情報を出さない', () => {
    expect(visibleAnnouncements(items, false).map((x) => x.title)).toEqual(['新しい版', '古い修正']);
    expect(visibleAnnouncements(items, null).map((x) => x.title)).toEqual(['新しい版', '古い修正']);
  });
});

describe('未読', () => {
  it('一覧を最後に開いた後に公開されたものだけ', () => {
    expect(unreadAnnouncements(items, '2026-10-20T00:00:00Z').map((x) => x.title)).toEqual(['新しい版']);
  });

  it('一度も開いていなければすべて未読', () => {
    expect(unreadAnnouncements(items, null)).toHaveLength(3);
  });
});

describe('プッシュ通知の文面', () => {
  it('どこからのお知らせかを題名に付ける', () => {
    expect(announcementPushMessage({ category: 'app_update', title: '1.1 を配信しました', body: '不具合を直しました' })).toEqual({
      title: 'カーケイボーからのお知らせ：1.1 を配信しました',
      body: '不具合を直しました',
    });
    expect(announcementPushMessage({ category: 'shop_news', title: '冬タイヤの予約開始', body: 'x' }).title).toBe('たにぐち自動車より：冬タイヤの予約開始');
  });

  it('改行はまとめ、長い本文は「…」で切る', () => {
    const msg = announcementPushMessage({ category: 'app_update', title: 't', body: `一行目\n\n二行目${'あ'.repeat(200)}` });
    expect(msg.body.startsWith('一行目 二行目')).toBe(true);
    expect([...msg.body]).toHaveLength(ANNOUNCEMENT_PUSH_BODY_MAX);
    expect(msg.body.endsWith('…')).toBe(true);
  });
});
