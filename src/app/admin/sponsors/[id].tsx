import { useQueryClient } from '@tanstack/react-query';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { SPONSOR_IMAGE_ASPECT, SponsorCard } from '../../../components/SponsorSlot';
import { StaffOnly } from '../../../components/StaffOnly';
import { AppText, Button, Card, ChoiceChips, DateField, Divider, ErrorView, Field, QueryFallback, Screen, SectionTitle, Segmented, ToggleRow } from '../../../components/ui';
import { todayJst } from '../../../lib/data';
import { parseInteger } from '../../../lib/format';
import { SPONSOR_PLACEMENT_LABELS, type SponsorPlacement } from '../../../lib/sponsor-pick';
import {
  deleteSponsorAd,
  removeSponsorImage,
  saveSponsorAd,
  sponsorImageUrl,
  uploadSponsorImage,
  useManagedSponsorAds,
  type SponsorAdRow,
} from '../../../lib/sponsors';
import { STAFF_ORG_LABELS, type StaffOrg } from '../../../lib/staff';
import { spacing } from '../../../theme';
import { alertError, confirmDestructive } from '../../../lib/alerts';

/** 画像の横幅。画面いっぱいに出してもきれいに見え、通信量を抑えられる大きさ */
const IMAGE_WIDTH = 1200;
const PLACEMENTS: SponsorPlacement[] = ['home', 'costs', 'shops'];

/** 広告を登録する・直す（運営スタッフ）。id が 'new' なら新しく登録する */
export default function EditSponsor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <StaffOnly>{(org) => <Loader id={id} org={org} />}</StaffOnly>;
}

function Loader({ id, org }: { id: string; org: StaffOrg }) {
  const ads = useManagedSponsorAds();
  if (id === 'new') return <Form org={org} current={null} />;
  if (!ads.isSuccess) return <QueryFallback queries={[ads]} />;
  const current = ads.data.find((a) => a.id === id);
  if (!current) return <ErrorView message="この広告は削除されています。" code="IJ-DB-004" />;
  if (org !== 'holy' && current.org !== org) return <ErrorView message="他社が管理する広告は編集できません。" code="IJ-DB-001" />;
  return <Form org={org} current={current} />;
}

/** 選んだ写真を横2：縦1に中央で切り抜き、横幅をそろえた JPEG にする */
async function prepareImage(asset: ImagePicker.ImagePickerAsset): Promise<{ uri: string; base64: string }> {
  const { width: w, height: h } = asset;
  const crop =
    w / h > SPONSOR_IMAGE_ASPECT
      ? { originX: Math.round((w - h * SPONSOR_IMAGE_ASPECT) / 2), originY: 0, width: Math.round(h * SPONSOR_IMAGE_ASPECT), height: h }
      : { originX: 0, originY: Math.round((h - w / SPONSOR_IMAGE_ASPECT) / 2), width: w, height: Math.round(w / SPONSOR_IMAGE_ASPECT) };
  const context = ImageManipulator.manipulate(asset.uri).crop(crop);
  if (crop.width > IMAGE_WIDTH) context.resize({ width: IMAGE_WIDTH });
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  if (!saved.base64) throw new Error('画像を読み込めませんでした。');
  return { uri: saved.uri, base64: saved.base64 };
}

function Form({ org, current }: { org: StaffOrg; current: SponsorAdRow | null }) {
  const qc = useQueryClient();
  const [adOrg, setAdOrg] = useState<StaffOrg>(current?.org ?? org);
  const [sponsorName, setSponsorName] = useState(current?.sponsor_name ?? '');
  const [title, setTitle] = useState(current?.title ?? '');
  const [body, setBody] = useState(current?.body ?? '');
  const [linkUrl, setLinkUrl] = useState(current?.link_url ?? '');
  const [placements, setPlacements] = useState<SponsorPlacement[]>(current?.placements ?? ['home']);
  const [startsOn, setStartsOn] = useState<string | null>(current?.starts_on ?? todayJst());
  const [endsOn, setEndsOn] = useState<string | null>(current?.ends_on ?? null);
  const [weight, setWeight] = useState(String(current?.weight ?? 1));
  const [isPublished, setIsPublished] = useState(current?.is_published ?? false);
  // 画像：保存するまでは端末の中に置いておき、保存のときに送る
  const [newImage, setNewImage] = useState<{ uri: string; base64: string } | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [busy, setBusy] = useState(false);

  const keptPath = removeImage ? null : (current?.image_path ?? null);
  const imageUri = newImage?.uri ?? (keptPath ? sponsorImageUrl(keptPath) : null);

  const refresh = () =>
    Promise.all([qc.invalidateQueries({ queryKey: ['managedSponsorAds'] }), qc.invalidateQueries({ queryKey: ['sponsorAds'] })]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled) return;
    setBusy(true);
    try {
      setNewImage(await prepareImage(result.assets[0]));
      setRemoveImage(false);
    } catch (e) {
      alertError('画像を読み込めませんでした', e);
    } finally {
      setBusy(false);
    }
  };

  const togglePlacement = (p: SponsorPlacement) =>
    setPlacements((list) => (list.includes(p) ? list.filter((x) => x !== p) : PLACEMENTS.filter((x) => x === p || list.includes(x))));

  const save = async () => {
    const name = sponsorName.trim();
    const t = title.trim();
    const b = body.trim();
    const url = linkUrl.trim();
    const w = parseInteger(weight);
    const errors: string[] = [];
    if (name.length < 1 || [...name].length > 60) errors.push('広告主の名前は1〜60文字で入力してください。');
    if (t.length < 1 || [...t].length > 40) errors.push('題名は1〜40文字で入力してください。');
    if ([...b].length > 120) errors.push('説明は120文字までです。');
    if (url && !/^https:\/\/\S+$/.test(url)) errors.push('リンクは https:// から始まる URL を入力してください。');
    if (placements.length === 0) errors.push('出す場所を1つ以上選んでください。');
    if (!startsOn) errors.push('掲載の開始日を選んでください。');
    if (startsOn && endsOn && endsOn < startsOn) errors.push('掲載の終了日は、開始日より後にしてください。');
    if (w == null || Number.isNaN(w) || w < 1 || w > 100) errors.push('表示の重みは1〜100で入力してください。');
    if (errors.length > 0) {
      Alert.alert('入力を確認してください', errors.join('\n'));
      return;
    }

    setBusy(true);
    let uploaded: string | null = null;
    try {
      if (newImage) uploaded = await uploadSponsorImage(newImage.base64);
      await saveSponsorAd({
        id: current?.id,
        org: adOrg,
        sponsorName: name,
        title: t,
        body: b || null,
        imagePath: uploaded ?? keptPath,
        linkUrl: url || null,
        placements,
        isPublished,
        startsOn: startsOn!,
        endsOn,
        weight: w!,
      });
      // 差し替え・外した古い画像は、保存できてから消す
      if (current?.image_path && (uploaded || removeImage)) await removeSponsorImage(current.image_path);
      await refresh();
      router.back();
    } catch (e) {
      if (uploaded) await removeSponsorImage(uploaded);
      alertError('保存できませんでした', e);
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    confirmDestructive({
      title: 'この広告を削除しますか',
      message: '表示・タップの記録も消えます。掲載を止めるだけなら「公開する」をオフにしてください。',
      confirmText: '削除する',
      errorTitle: '削除できませんでした',
      setBusy,
      action: async () => {
        await deleteSponsorAd(current!);
        await refresh();
        router.back();
      },
    });

  return (
    <Screen>
      <SectionTitle>見え方</SectionTitle>
      <SponsorCard
        ad={{
          sponsorName: sponsorName.trim() || '広告主の名前',
          title: title.trim() || '題名',
          body: body.trim() || null,
          imageUri,
          linkUrl: linkUrl.trim() || null,
        }}
      />

      <Card>
        {org === 'holy' && (
          <View style={{ gap: 6 }}>
            <AppText variant="label">管理する会社</AppText>
            <Segmented<StaffOrg>
              options={[
                { value: 'holy', label: 'HOLY' },
                { value: 'taniguchi', label: 'たにぐち自動車' },
              ]}
              value={adOrg}
              onChange={setAdOrg}
            />
          </View>
        )}
        {org !== 'holy' && <AppText variant="caption">管理する会社：{STAFF_ORG_LABELS[adOrg]}</AppText>}
        <Field label="広告主の名前（「PR・〇〇」と表示）" value={sponsorName} onChangeText={setSponsorName} maxLength={60} placeholder="例：〇〇タイヤ" />
        <Field label="題名（40文字まで）" value={title} onChangeText={setTitle} maxLength={40} placeholder="例：冬タイヤ 早期予約で10%オフ" />
        <Field label="説明（任意・120文字まで）" value={body} onChangeText={setBody} maxLength={120} multiline textAlignVertical="top" />
        <Field label="リンク（任意）" value={linkUrl} onChangeText={setLinkUrl} autoCapitalize="none" keyboardType="url" placeholder="https://" />
        <View style={{ gap: spacing.sm }}>
          <AppText variant="label">画像（任意・横2：縦1に切り抜きます）</AppText>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            <View style={{ flex: 1 }}>
              <Button title={imageUri ? '画像を変える' : '画像を選ぶ'} variant="secondary" icon="image-outline" disabled={busy} onPress={pickImage} />
            </View>
            {imageUri && (
              <View style={{ flex: 1 }}>
                <Button
                  title="画像を外す"
                  variant="plain"
                  disabled={busy}
                  onPress={() => {
                    setNewImage(null);
                    setRemoveImage(true);
                  }}
                />
              </View>
            )}
          </View>
        </View>
      </Card>

      <Card>
        <AppText variant="heading">掲載</AppText>
        <View style={{ gap: 6 }}>
          <AppText variant="label">出す場所</AppText>
          <ChoiceChips options={PLACEMENTS.map((p) => ({ value: p, label: SPONSOR_PLACEMENT_LABELS[p] }))} value={placements} onChange={togglePlacement} />
        </View>
        <DateField label="掲載の開始日" value={startsOn} onChange={setStartsOn} />
        <DateField label="掲載の終了日（任意・この日まで）" value={endsOn} onChange={setEndsOn} optional />
        <Field
          label="表示の重み（1〜100）"
          value={weight}
          onChangeText={setWeight}
          keyboardType="number-pad"
          hint="同じ場所に複数の広告があるとき、重みに比例した割合で出します（例：重み3は重み1の3倍）。"
        />
        <Divider />
        <ToggleRow
          title="公開する"
          description="オフのあいだは下書きです。オンにすると、掲載期間中に利用者の画面に出します。"
          value={isPublished}
          onChange={setIsPublished}
        />
      </Card>

      <View style={{ gap: spacing.sm }}>
        <Button title={current ? '保存する' : '登録する'} loading={busy} onPress={save} />
        {current && <Button title="削除する" variant="destructive" disabled={busy} onPress={remove} />}
      </View>
    </Screen>
  );
}
