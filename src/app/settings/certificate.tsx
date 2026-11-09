import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import type { CertificateDraft } from '@shared/certificate-draft.ts';
import { maskCertificate, taxPrefecture, type VehicleCertificate } from '@domain/vehicle-certificate.ts';
import { automobileTaxFor, fiscalYearOf, vehicleTaxSpecLabel, weightTaxFor } from '@domain/vehicle-tax.ts';
import { vehicleTaxSpec } from '@shared/db-mapping.ts';
import { yen } from '../../lib/format';
import { AppText, Button, Card, Divider, ErrorView, Field, Loading, Notice, Num, Screen, SectionTitle, Segmented } from '../../components/ui';
import {
  ALL_FIELDS,
  CERTIFICATE_SECTIONS,
  displayValue,
  inputHint,
  inputText,
  parseInput,
  type CertKey,
  type FieldSpec,
} from '../../lib/certificate-fields';
import { saveVehicleCertificate, useInvalidate, useVehicleBundle, useVehicleCertificate, type VehicleBundle } from '../../lib/data';
import { invokeFunction } from '../../lib/supabase';
import { spacing } from '../../theme';

/** 車検証の写真は細かい字が多いので、レシートより大きめにして送る */
const PHOTO_MAX_SIDE = 2000;

/**
 * 車検証の記載内容。ふだんは個人情報（所有者・使用者の氏名・住所、使用の本拠の位置）と車台番号を伏せて見せ、
 * 「内容を直す」で入力する。写真から読み取ることもできる（写真は保存しない）。
 * 種別・用途・自家用/事業用・排気量・重さなどは、自動車税・重量税の自動計算に使う。
 */
export default function CertificateScreen() {
  const { vehicle, bundle } = useVehicleBundle();
  const cert = useVehicleCertificate(vehicle.data);
  if (bundle.isPending || cert.isPending) return <Loading />;
  if (bundle.isError || cert.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => (bundle.isError ? bundle.refetch() : cert.refetch())} />;
  return <Certificate bundle={bundle.data} saved={cert.data} />;
}

function toTexts(c: VehicleCertificate): Record<CertKey, string> {
  return Object.fromEntries(ALL_FIELDS.map((f) => [f.key, inputText(f, c[f.key])])) as Record<CertKey, string>;
}

function Certificate({ bundle, saved }: { bundle: VehicleBundle; saved: VehicleCertificate }) {
  const invalidate = useInvalidate();
  const [editing, setEditing] = useState(false);
  const [showPersonal, setShowPersonal] = useState(false);
  const [texts, setTexts] = useState(() => toTexts(saved));
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const values = Object.fromEntries(ALL_FIELDS.map((f) => [f.key, parseInput(f, texts[f.key])])) as Record<CertKey, unknown>;
  const invalid = ALL_FIELDS.filter((f) => values[f.key] === undefined);
  const shown = showPersonal ? saved : maskCertificate(saved);
  const prefecture = taxPrefecture(saved);
  const hasAny = ALL_FIELDS.some((f) => saved[f.key] != null);
  // 入れた内容から計算した税額（計算後の数字だけを見せる）
  const taxSpec = { ...vehicleTaxSpec(bundle.vehicle), prefecture };
  const fiscalYear = fiscalYearOf(bundle.today);
  const carTax = automobileTaxFor(taxSpec, fiscalYear);
  const nextInspection = saved.expiresOn && saved.expiresOn > bundle.today ? saved.expiresOn : bundle.today;
  const weightTax = weightTaxFor(taxSpec, nextInspection);
  const specLabel = vehicleTaxSpecLabel(taxSpec, true);

  const setText = (key: CertKey, v: string) => setTexts((t) => ({ ...t, [key]: v }));

  const applyDraft = (d: CertificateDraft) => {
    const filled = ALL_FIELDS.filter((f) => d[f.key] != null);
    setTexts((t) => {
      const next = { ...t };
      for (const f of filled) next[f.key] = inputText(f, d[f.key]);
      return next;
    });
    setEditing(true);
    setNotice(
      filled.length > 0
        ? `${filled.length}項目を読み取りました。車検証と見比べて、違うところを直してから保存してください。`
        : '読み取れる内容がありませんでした。明るい場所で、車検証の全体が写るように撮り直してください。',
    );
  };

  const readPhoto = async (source: 'camera' | 'library') => {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        if (!permission.canAskAgain)
          Alert.alert('カメラを使えません', '設定でカメラの使用を許可してください。', [
            { text: 'キャンセル', style: 'cancel' },
            { text: '設定を開く', onPress: () => Linking.openSettings() },
          ]);
        return;
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;
    const asset = result.assets[0];
    setReading(true);
    try {
      const context = ImageManipulator.manipulate(asset.uri);
      if (Math.max(asset.width, asset.height) > PHOTO_MAX_SIDE) {
        context.resize(asset.width >= asset.height ? { width: PHOTO_MAX_SIDE } : { height: PHOTO_MAX_SIDE });
      }
      const image = await context.renderAsync();
      const photo = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
      if (!photo.base64) throw new Error('写真を読み込めませんでした。');
      applyDraft(await invokeFunction<CertificateDraft>('read-vehicle-certificate', { image: photo.base64 }));
    } catch (e) {
      Alert.alert('読み取れませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  };

  const choosePhoto = () =>
    Alert.alert('車検証を写真で読み取る', '車検証（電子車検証は「自動車検査証記録事項」）の全体が写るように撮ってください。写真は読み取りだけに使い、保存しません。', [
      { text: 'キャンセル', style: 'cancel' },
      { text: 'アルバムから選ぶ', onPress: () => readPhoto('library') },
      { text: '撮影する', onPress: () => readPhoto('camera') },
    ]);

  const save = async () => {
    if (invalid.length > 0) return;
    setBusy(true);
    try {
      const shaken = bundle.deadlines.find((d) => d.kind === 'shaken');
      await saveVehicleCertificate(bundle.vehicle, values as unknown as VehicleCertificate, shaken?.due_on ?? null);
      await invalidate();
      setEditing(false);
      setNotice(null);
    } catch (e) {
      Alert.alert('保存できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    setTexts(toTexts(saved));
    setEditing(false);
    setNotice(null);
  };

  return (
    <Screen>
      <Button title="車検証を写真で読み取る" variant="secondary" loading={reading} onPress={choosePhoto} />
      {notice && <Notice title="読み取った内容を確認してください">{notice}</Notice>}
      {!editing && (
        <AppText variant="caption">
          {hasAny
            ? '所有者・使用者の氏名・住所と車台番号は伏せて表示しています。自動車税・重量税の自動計算にも使います。'
            : '車検証の内容を入れると、自動車税・車検の重量税を自動で計算します。写真で読み取るか、「内容を直す」から入れてください。'}
        </AppText>
      )}

      {!editing && (carTax || weightTax) && (
        <Card>
          <AppText variant="label">入力した数字</AppText>
          <AppText>{specLabel}</AppText>
          <Divider />
          {carTax && <TaxRow label={`${fiscalYear}年度の${taxSpec.vehicleClass === 'kei' ? '軽自動車税' : '自動車税'}`} value={yen(carTax.amountYen)} />}
          {weightTax && <TaxRow label={`次の車検の重量税（${weightTax.years}年分）`} value={yen(weightTax.amountYen)} />}
        </Card>
      )}

      {CERTIFICATE_SECTIONS.map((section) => (
        <View key={section.title} style={{ gap: spacing.sm }}>
          <SectionTitle
            action={
              !editing && section.personal && hasAny ? { label: showPersonal ? '伏せる' : '表示する', onPress: () => setShowPersonal((v) => !v) } : undefined
            }
          >
            {section.title}
          </SectionTitle>
          <Card>
            {section.fields.map((f) =>
              editing ? (
                <FieldInput key={f.key} field={f} text={texts[f.key]} onChange={(v) => setText(f.key, v)} invalid={values[f.key] === undefined} />
              ) : (
                <ViewRow key={f.key} label={f.label} value={displayValue(f, shown[f.key])} />
              ),
            )}
            {!editing && section.personal && prefecture && <AppText variant="caption">{`自動車税の都道府県：${prefecture}`}</AppText>}
          </Card>
        </View>
      ))}

      {editing ? (
        <>
          {invalid.length > 0 && <AppText variant="caption">{`入力を確かめてください：${invalid.map((f) => f.label).join('、')}`}</AppText>}
          <Button title="保存する" disabled={invalid.length > 0} loading={busy} onPress={save} />
          <Button title="やめる" variant="secondary" disabled={busy} onPress={cancel} />
          <AppText variant="caption">満了日を入れると、車検の期限（通知）も更新します。</AppText>
        </>
      ) : (
        <Button title="内容を直す" onPress={() => setEditing(true)} />
      )}
    </Screen>
  );
}

function TaxRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md }}>
      <AppText>{label}</AppText>
      <Num size={18}>{value}</Num>
    </View>
  );
}

function ViewRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md }}>
      <AppText variant="caption" style={{ flexShrink: 0 }}>
        {label}
      </AppText>
      <AppText style={{ flexShrink: 1, textAlign: 'right' }}>{value}</AppText>
    </View>
  );
}

function FieldInput({ field, text, onChange, invalid }: { field: FieldSpec; text: string; onChange: (v: string) => void; invalid: boolean }) {
  if (field.type === 'choice') {
    return (
      <View style={{ gap: 6 }}>
        <AppText variant="label">{field.label}</AppText>
        <Segmented options={field.options} value={text} onChange={onChange} />
      </View>
    );
  }
  return (
    <Field
      label={field.label}
      value={text}
      onChangeText={onChange}
      keyboardType={field.type === 'int' ? 'number-pad' : 'default'}
      suffix={field.type === 'int' ? field.suffix : undefined}
      multiline={field.type === 'text' && field.multiline}
      maxLength={field.type === 'text' ? field.max : undefined}
      hint={invalid ? '入力の形を確かめてください' : inputHint(field)}
    />
  );
}
