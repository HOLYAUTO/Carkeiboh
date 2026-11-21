import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { ANNOUNCEMENT_LABELS, type AnnouncementCategory } from '@domain/announcements.ts';
import { StaffOnly } from '../../../components/StaffOnly';
import { AppText, Button, Card, DateField, Divider, ErrorView, Field, QueryFallback, Screen, Segmented, ToggleRow } from '../../../components/ui';
import {
  deleteAnnouncement,
  saveAnnouncement,
  useManagedAnnouncements,
  type AnnouncementRow,
} from '../../../lib/announcements';
import { jstDateTime, jstParts, jstToIso } from '../../../lib/format';
import type { StaffOrg } from '../../../lib/staff';
import { spacing } from '../../../theme';
import { alertError, confirmDestructive } from '../../../lib/alerts';

/** お知らせを書く・直す（運営スタッフ）。id が 'new' なら新しく書く */
export default function EditAnnouncement() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StaffOnly>{(org) => <Loader id={id} org={org} />}</StaffOnly>;
}

function Loader({ id, org }: { id: string; org: StaffOrg }) {
  const list = useManagedAnnouncements();
  if (id === 'new') return <Form org={org} current={null} />;
  if (!list.isSuccess) return <QueryFallback queries={[list]} />;
  const current = list.data.find((a) => a.id === id);
  if (!current) return <ErrorView message="このお知らせは削除されています。" />;
  return <Form org={org} current={current} />;
}

function Form({ org, current }: { org: StaffOrg; current: AnnouncementRow | null }) {
  const qc = useQueryClient();
  // たにぐち自動車は最新情報だけを出せる（DB の RLS でも同じ制限をかけている）
  const categories: AnnouncementCategory[] = org === 'holy' ? ['app_update', 'shop_news'] : ['shop_news'];
  const initialPublish = jstParts(current?.published_at ?? new Date().toISOString());
  const [category, setCategory] = useState<AnnouncementCategory>(current?.category ?? categories[0]);
  const [title, setTitle] = useState(current?.title ?? '');
  const [body, setBody] = useState(current?.body ?? '');
  const [linkUrl, setLinkUrl] = useState(current?.link_url ?? '');
  const [linkLabel, setLinkLabel] = useState(current?.link_label ?? '');
  const [publishDate, setPublishDate] = useState<string | null>(initialPublish.date);
  const [publishTime, setPublishTime] = useState(initialPublish.time);
  const [expiresOn, setExpiresOn] = useState<string | null>(current?.expires_at ? jstParts(current.expires_at).date : null);
  const [isPublished, setIsPublished] = useState(current?.is_published ?? false);
  const [sendPush, setSendPush] = useState(current?.send_push ?? false);
  const [busy, setBusy] = useState(false);
  const pushed = !!current?.pushed_at;

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ['managedAnnouncements'] }),
      qc.invalidateQueries({ queryKey: ['announcements'] }),
      qc.invalidateQueries({ queryKey: ['announcement'] }),
    ]);

  const save = async () => {
    const t = title.trim();
    const b = body.trim();
    const url = linkUrl.trim();
    const errors: string[] = [];
    if (t.length < 1 || [...t].length > 60) errors.push('題名は1〜60文字で入力してください。');
    if (b.length < 1 || [...b].length > 2000) errors.push('本文は1〜2,000文字で入力してください。');
    if (url && !/^https:\/\/\S+$/.test(url)) errors.push('リンクは https:// から始まる URL を入力してください。');
    const publishedAt = publishDate ? jstToIso(publishDate, publishTime) : null;
    if (!publishedAt) errors.push('公開の時刻は「9:00」のように入力してください。');
    // 掲載の終わりは、その日の終わり（日本時間）まで
    const expiresAt = expiresOn ? new Date(`${expiresOn}T23:59:59+09:00`).toISOString() : null;
    if (publishedAt && expiresAt && expiresAt <= publishedAt) errors.push('掲載の終わりは、公開より後の日にしてください。');
    if (errors.length > 0) {
      Alert.alert('入力を確認してください', errors.join('\n'));
      return;
    }

    setBusy(true);
    try {
      await saveAnnouncement({
        id: current?.id,
        category,
        title: t,
        body: b,
        linkUrl: url || null,
        linkLabel: url ? linkLabel.trim() || null : null,
        isPublished,
        publishedAt: publishedAt!,
        expiresAt,
        sendPush,
      });
      await refresh();
      router.back();
    } catch (e) {
      alertError('保存できませんでした', e);
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    confirmDestructive({
      title: 'このお知らせを削除しますか',
      message: '利用者の画面からも消えます。送った通知は取り消せません。',
      confirmText: '削除する',
      errorTitle: '削除できませんでした',
      setBusy,
      action: async () => {
        await deleteAnnouncement(current!.id);
        await refresh();
        router.back();
      },
    });

  return (
    <Screen>
      {categories.length > 1 ? (
        <Segmented<AnnouncementCategory>
          options={categories.map((c) => ({ value: c, label: ANNOUNCEMENT_LABELS[c] }))}
          value={category}
          onChange={setCategory}
        />
      ) : (
        <AppText variant="label">{ANNOUNCEMENT_LABELS[category]}</AppText>
      )}
      <AppText variant="caption">
        {category === 'app_update'
          ? 'すべての利用者のホームとお知らせの一覧に出します。'
          : '「受け取る」を選んだ利用者だけのホームとお知らせの一覧に出します。'}
      </AppText>

      <Card>
        <Field label="題名（60文字まで）" value={title} onChangeText={setTitle} maxLength={60} placeholder="例：バージョン1.1 を配信しました" />
        <Field
          label="本文（2,000文字まで）"
          value={body}
          onChangeText={setBody}
          maxLength={2000}
          multiline
          textAlignVertical="top"
          placeholder="例：記録の一覧で、日付が正しく並ばない不具合を直しました。"
        />
        <Field label="リンク（任意）" value={linkUrl} onChangeText={setLinkUrl} autoCapitalize="none" keyboardType="url" placeholder="https://" />
        {linkUrl.trim() !== '' && (
          <Field label="リンクのボタンの文言（任意）" value={linkLabel} onChangeText={setLinkLabel} maxLength={30} placeholder="詳しく見る" />
        )}
      </Card>

      <Card>
        <AppText variant="heading">公開</AppText>
        <DateField label="公開する日" value={publishDate} onChange={setPublishDate} />
        <Field label="公開する時刻（日本時間）" value={publishTime} onChangeText={setPublishTime} keyboardType="numbers-and-punctuation" placeholder="9:00" />
        <DateField label="掲載の終わり（任意・この日まで表示）" value={expiresOn} onChange={setExpiresOn} optional />
        <Divider />
        <ToggleRow
          title="公開する"
          description="オフのあいだは下書きです。オンにすると、公開の日時からホームとお知らせの一覧に出します。"
          value={isPublished}
          onChange={setIsPublished}
        />
        <Divider />
        <ToggleRow
          title="プッシュ通知も送る"
          description={
            pushed
              ? `送信済み（${jstDateTime(current!.pushed_at!)}）。通知は1回だけ送ります。`
              : '公開の日時から10分以内に、1回だけ送ります。大切なお知らせだけにしてください。'
          }
          value={sendPush}
          onChange={setSendPush}
          disabled={pushed}
        />
      </Card>

      <View style={{ gap: spacing.sm }}>
        <Button title={current ? '保存する' : '作成する'} loading={busy} onPress={save} />
        {current && <Button title="削除する" variant="destructive" disabled={busy} onPress={remove} />}
      </View>
    </Screen>
  );
}
