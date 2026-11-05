import { Ionicons } from '@expo/vector-icons';
import { useNavigation, usePreventRemove } from 'expo-router';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from '@domain/costs.ts';
import {
  calculateFuelCost,
  fuelEconomySegments,
  isValidFuelLiters,
  isValidFuelUnitPrice,
  type FuelPriceBasis,
  type FuelType,
} from '@domain/fuel.ts';
import { checkOdoEntry } from '@domain/odo.ts';
import { distanceUnitLabel, fromKm, toKm, type DistanceUnit } from '@domain/units.ts';
import {
  fuelFills,
  logInputSession,
  saveExpense,
  saveOdoReading,
  saveOilChange,
  saveWearCheck,
  useInvalidate,
  type ExpenseRow,
  type OdometerReadingRow,
  type OilChangeRow,
  type VehicleBundle,
  type WearCheckRow,
  type WearKind,
} from '../lib/data';
import { parseDecimal, parseInteger, parseMillimeters } from '../lib/format';
import type { RecordDraft } from '@shared/record-draft.ts';
import { cardShadow, fonts, MIN_TAP, radius, spacing, useColors } from '../theme';
import { FuelBreakdown, FuelEconomyPreview, FuelFields } from './FuelFields';
import { QuickInput } from './QuickInput';
import { AppText, Button, Card, DateField, Field, Notice, ToggleRow } from './ui';

/** 「記録する」で選ぶ項目。オイル交換・支出の各項目に加え、タイヤ・ブレーキの点検と走行距離だけの記録もできる */
export type RecordKind = ExpenseCategory | WearKind | 'odometer';

const WEAR_LABELS: Record<WearKind, string> = { tire: 'タイヤ', brake: 'ブレーキ' };

export function isWearKind(kind: string): kind is WearKind {
  return kind === 'tire' || kind === 'brake';
}

export function wearTitle(w: Pick<WearCheckRow, 'kind' | 'replaced'>): string {
  if (w.kind === 'tire') return w.replaced ? 'タイヤ交換' : 'タイヤの点検';
  return w.replaced ? 'ブレーキパッド交換' : 'ブレーキの点検';
}

const KINDS: { kind: RecordKind; icon: keyof typeof Ionicons.glyphMap }[] = [
  { kind: 'oil_change', icon: 'water-outline' },
  { kind: 'tire', icon: 'disc-outline' },
  { kind: 'brake', icon: 'stop-circle-outline' },
  { kind: 'fuel', icon: 'speedometer-outline' },
  { kind: 'maintenance', icon: 'construct-outline' },
  { kind: 'shaken', icon: 'shield-checkmark-outline' },
  { kind: 'insurance', icon: 'document-text-outline' },
  { kind: 'car_tax', icon: 'receipt-outline' },
  { kind: 'parking_toll', icon: 'car-outline' },
  { kind: 'loan_lease', icon: 'card-outline' },
  { kind: 'other', icon: 'ellipsis-horizontal-circle-outline' },
  { kind: 'odometer', icon: 'analytics-outline' },
];

export function kindLabel(kind: RecordKind): string {
  if (kind === 'odometer') return '走行距離だけ';
  return isWearKind(kind) ? WEAR_LABELS[kind] : EXPENSE_CATEGORY_LABELS[kind];
}

export function KindPicker({ onSelect }: { onSelect: (k: RecordKind) => void }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
      {KINDS.map(({ kind, icon }) => (
        <Pressable
          key={kind}
          accessibilityRole="button"
          accessibilityLabel={`${kindLabel(kind)}を記録する`}
          onPress={() => onSelect(kind)}
          style={({ pressed }) => ({
            width: '31%',
            minHeight: 88,
            borderRadius: radius.card,
            backgroundColor: colors.card,
            ...cardShadow,
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: spacing.sm,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={icon} size={22} color={colors.accentText} />
          </View>
          <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.text, textAlign: 'center' }}>{kindLabel(kind)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** 見出しの左上の「戻る」。標準の戻るボタンと同じく、山かっこと文字で出す */
function HeaderBackButton({ onPress }: { onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="戻る"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: MIN_TAP, paddingRight: spacing.xs, opacity: pressed ? 0.6 : 1 })}
    >
      <Ionicons name="chevron-back" size={24} color={colors.accentText} />
      <Text style={{ fontFamily: fonts.regular, fontSize: 17, color: colors.accentText }}>戻る</Text>
    </Pressable>
  );
}

export type EditTarget =
  | { type: 'oil'; row: OilChangeRow; expense: ExpenseRow | null }
  | { type: 'expense'; row: ExpenseRow }
  | { type: 'odometer'; row: OdometerReadingRow }
  | { type: 'wear'; row: WearCheckRow };

/** タイヤ・ブレーキの入力欄の文言。残りの目安は、分からない人が空欄で進めるよう任意にする */
const WEAR_FORM: Record<WearKind, { replaced: string; remaining: string; hint: string }> = {
  tire: {
    replaced: 'タイヤを交換した',
    remaining: '溝の深さ（いちばん浅いところ・任意）',
    hint: '分からなければ空欄で大丈夫です。新品は8mm前後、1.6mm でスリップサインが出ます。',
  },
  brake: {
    replaced: 'ブレーキパッドを交換した',
    remaining: 'パッドの厚さ（いちばん薄いところ・任意）',
    hint: '整備工場で言われた数字を入れてください。分からなければ空欄で大丈夫です。',
  },
};

function confirmWarnings(messages: string[]): Promise<boolean> {
  if (messages.length === 0) return Promise.resolve(true);
  return new Promise((resolve) =>
    Alert.alert('入力を確認してください', messages.join('\n\n'), [
      { text: '修正する', style: 'cancel', onPress: () => resolve(false) },
      { text: 'このまま登録', onPress: () => resolve(true) },
    ]),
  );
}

export function RecordForm({
  bundle,
  kind,
  target,
  onSaved,
}: {
  bundle: VehicleBundle;
  kind: RecordKind;
  target?: EditTarget;
  /** 保存した記録を `/records/[id]` で開くための ID（例：`expense:…`）を渡す */
  onSaved: (recordRef: string) => void;
}) {
  const invalidate = useInvalidate();
  const navigation = useNavigation();
  const initialDate =
    target?.type === 'oil' || target?.type === 'wear'
      ? target.row.performed_on
      : target?.type === 'expense'
        ? target.row.spent_on
        : target?.type === 'odometer'
          ? target.row.read_on
          : bundle.today;
  // 走行距離は DB では km。入力欄は車両の単位（km / mile）で見せる
  const unit: DistanceUnit = bundle.vehicle.distance_unit === 'mile' ? 'mile' : 'km';
  const initialOdo = target ? target.row.odo_km : null;
  const initialOdoText = initialOdo != null ? String(fromKm(initialOdo, unit)) : '';
  const initialAmount = target?.type === 'oil' ? target.expense?.amount_yen : target?.type === 'expense' ? target.row.amount_yen : null;

  // 給油：油種は前回の給油と同じものから始める。満タンは新しい記録ではオンから始める
  const isFuel = kind === 'fuel';
  const fuelRow = target?.type === 'expense' && target.row.category === 'fuel' ? target.row : null;
  const initialLiters = fuelRow?.fuel_liters != null ? String(Number(fuelRow.fuel_liters)) : '';
  const initialUnitPrice = fuelRow?.fuel_unit_price != null ? String(Number(fuelRow.fuel_unit_price)) : '';
  const initialFuelType: FuelType = fuelRow?.fuel_type ?? bundle.expenses.find((e) => e.category === 'fuel' && e.fuel_type)?.fuel_type ?? 'regular';
  const initialBasis: FuelPriceBasis = fuelRow?.fuel_price_basis ?? 'tax_included';
  const initialFullTank = fuelRow ? fuelRow.fuel_full_tank === true : true;

  const [date, setDate] = useState<string>(initialDate);
  const [odo, setOdo] = useState(initialOdoText);
  const [amountInput, setAmount] = useState(initialAmount != null ? String(initialAmount) : '');
  const [liters, setLiters] = useState(initialLiters);
  const [unitPrice, setUnitPrice] = useState(initialUnitPrice);
  const [fuelType, setFuelType] = useState<FuelType>(initialFuelType);
  const [basis, setBasis] = useState<FuelPriceBasis>(initialBasis);
  const [fullTank, setFullTank] = useState(initialFullTank);
  // 金額を自分で入れた（またはレシートから読んだ）ら、給油量×単価の計算で上書きしない。空にすると自動に戻る
  const [amountManual, setAmountManual] = useState(() => {
    if (initialAmount == null) return false;
    const l = parseDecimal(initialLiters, 2);
    const pr = parseDecimal(initialUnitPrice, 1);
    if (l == null || pr == null) return true;
    return calculateFuelCost({ date: initialDate, fuelType: initialFuelType, liters: l, unitPriceYen: pr, basis: initialBasis }).totalYen !== initialAmount;
  });
  const [filterChanged, setFilterChanged] = useState(target?.type === 'oil' ? target.row.filter_changed : false);
  const initialNote = target?.type === 'expense' || target?.type === 'wear' ? (target.row.note ?? '') : '';
  const initialReplaced = target?.type === 'wear' ? target.row.replaced : false;
  const initialRemaining = target?.type === 'wear' && target.row.remaining_mm != null ? String(Number(target.row.remaining_mm)) : '';
  const [note, setNote] = useState(initialNote);
  const [replaced, setReplaced] = useState(initialReplaced);
  const [remaining, setRemaining] = useState(initialRemaining);
  const [busy, setBusy] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);
  const allowLeave = useRef(false);

  const isOil = kind === 'oil_change';
  const isOdoOnly = kind === 'odometer';
  const wear = isWearKind(kind) ? kind : null;
  const odoInput = parseInteger(odo);
  const odoKm = odoInput == null ? null : toKm(odoInput, unit);
  const litersN = parseDecimal(liters, 2);
  const unitPriceN = parseDecimal(unitPrice, 1);
  const litersValid = litersN == null || isValidFuelLiters(litersN);
  const unitPriceValid = unitPriceN == null || isValidFuelUnitPrice(unitPriceN);
  const fuelCost =
    isFuel && litersN != null && unitPriceN != null && litersValid && unitPriceValid
      ? calculateFuelCost({ date, fuelType, liters: litersN, unitPriceYen: unitPriceN, basis })
      : null;
  // 金額を自分で入れていなければ、給油量×単価で計算した合計を金額にする
  const amount = !amountManual && fuelCost ? String(fuelCost.totalYen) : amountInput;
  const amountYen = parseInteger(amount);
  const changeAmount = (v: string) => {
    setAmount(v);
    setAmountManual(v.trim() !== '');
  };

  // 満タンで走行距離と給油量があれば、前回の満タンからの燃費をその場で見せる
  const economy = useMemo(() => {
    if (!isFuel || !fullTank || odoKm == null || !Number.isFinite(odoKm) || litersN == null || !litersValid) return null;
    const others = fuelFills(bundle.expenses.filter((e) => e.id !== fuelRow?.id));
    const candidate = { id: '__editing__', date, odoKm, liters: litersN, fullTank: true, amountYen: 0 };
    const replacements = bundle.meterReplacements.map((m) => ({ replacedOn: m.replaced_on, odoBeforeKm: m.odo_before_km, odoAfterKm: m.odo_after_km }));
    return fuelEconomySegments([...others, candidate], replacements).find((seg) => seg.toId === '__editing__') ?? null;
  }, [isFuel, fullTank, odoKm, litersN, litersValid, date, bundle.expenses, bundle.meterReplacements, fuelRow?.id]);
  const remainingMm = parseMillimeters(remaining);
  const odoRequired = isOil || isOdoOnly;
  // ponytail: タイヤ・ブレーキの費用は「整備」の支出で記録する（オイルのように記録へ紐づけない）。
  // 実証実験で費用まで一度に入れたいという声が多ければ、expenses に wear_check_id を足す
  const amountRequired = !isOil && !isOdoOnly && !wear;

  const odoValid = odoKm == null ? !odoRequired : Number.isFinite(odoKm) && odoKm <= 2_000_000;
  const amountValid = amountYen == null ? !amountRequired : Number.isFinite(amountYen) && amountYen > 0 && amountYen < 100_000_000;
  const remainingValid = remainingMm == null || (Number.isFinite(remainingMm) && remainingMm <= 30);
  const fuelValid = !isFuel || (litersValid && unitPriceValid);
  const valid = !!date && odoValid && amountValid && remainingValid && fuelValid;

  // 入力の計測（実証実験の KPI 用）。画面を開いてから保存・離脱までと、写真・音声で埋まった項目を覚える
  const values = { date, odo, amount, note, remaining, filterChanged: String(filterChanged), liters, unitPrice };
  const latestValues = useRef(values);
  const metrics = useRef({
    openedAt: new Date(),
    method: 'manual' as 'manual' | 'photo' | 'voice',
    draftValues: {} as Partial<Record<keyof typeof values, string>>,
    warningsShown: 0,
    saved: false,
    touched: false,
  });
  const finishSession = (outcome: 'saved' | 'abandoned', recordRef: string | null) => {
    const m = metrics.current;
    const filled = Object.entries(m.draftValues) as [keyof typeof values, string][];
    logInputSession({
      vehicleId: bundle.vehicle.id,
      kind,
      mode: target ? 'edit' : 'new',
      method: m.method,
      outcome,
      openedAt: m.openedAt,
      // 端末の時計が途中で戻っても、開いた時刻より前にはしない（DB の check で弾かれて計測が消えるため）
      finishedAt: new Date(Math.max(Date.now(), m.openedAt.getTime())),
      draftFields: filled.length,
      draftFieldsChanged: filled.filter(([field, v]) => latestValues.current[field] !== v).length,
      warningsShown: m.warningsShown,
      recordRef,
    });
  };
  // 保存せずに画面を離れたら「離脱」として送る。既存の記録を開いて見ただけ（何も変えずに戻った・削除した）は入力ではないので送らない。
  // ponytail: アプリを強制終了したときは送れない（離脱率は少なめに出る）。必要なら開いた時点で1行作り、終わりで更新する
  useEffect(
    () => () => {
      const m = metrics.current;
      if (m.saved || (target && !m.touched)) return;
      finishSession('abandoned', null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // 入力途中で戻ろうとしたら確かめる（保存後は確かめない）
  const dirty =
    date !== initialDate ||
    odo !== initialOdoText ||
    liters !== initialLiters ||
    unitPrice !== initialUnitPrice ||
    fuelType !== initialFuelType ||
    basis !== initialBasis ||
    fullTank !== initialFullTank ||
    amount !== (initialAmount != null ? String(initialAmount) : '') ||
    note !== initialNote ||
    replaced !== initialReplaced ||
    remaining !== initialRemaining ||
    filterChanged !== (target?.type === 'oil' ? target.row.filter_changed : false);
  usePreventRemove(dirty, ({ data }) => {
    if (allowLeave.current) {
      navigation.dispatch(data.action);
      return;
    }
    Alert.alert('入力中の内容を破棄しますか', '戻ると、この画面で入力した内容は保存されません。', [
      { text: '入力を続ける', style: 'cancel' },
      { text: '破棄して戻る', style: 'destructive', onPress: () => navigation.dispatch(data.action) },
    ]);
  });
  useEffect(() => {
    latestValues.current = values;
    if (dirty) metrics.current.touched = true;
  });
  // iOS の見出しの標準の「戻る」は、上の確認で離脱を止めている間、押しても何も起きないことがある（2026-10-31 報告）。
  // 「戻る」を JS で戻すボタンに替えて必ず確認が出るようにし、入力中は横スワイプで戻る操作も止める
  useLayoutEffect(() => {
    navigation.setOptions({
      headerLeft: () => <HeaderBackButton onPress={() => navigation.goBack()} />,
      gestureEnabled: !dirty,
    });
  }, [navigation, dirty]);

  /** 写真・音声で読み取った値を入れる。読み取れなかった項目は今の入力を残す */
  const applyDraft = (d: RecordDraft, via: 'photo' | 'voice') => {
    const filled: string[] = [];
    const m = metrics.current;
    m.method = via;
    if (d.date) {
      setDate(d.date);
      m.draftValues.date = d.date;
      filled.push('日付');
    }
    if (d.odo != null) {
      setOdo(String(d.odo));
      m.draftValues.odo = String(d.odo);
      filled.push('走行距離');
    }
    if (d.amountYen != null && !isOdoOnly && !wear) {
      setAmount(String(d.amountYen));
      setAmountManual(true);
      m.draftValues.amount = String(d.amountYen);
      filled.push('金額');
    }
    if (isFuel) {
      if (d.fuelLiters != null) {
        setLiters(String(d.fuelLiters));
        m.draftValues.liters = String(d.fuelLiters);
        filled.push('給油量');
      }
      if (d.fuelUnitPrice != null) {
        setUnitPrice(String(d.fuelUnitPrice));
        // レシート・店頭の単価は税込。音声で「税抜」と言うことは考えない
        setBasis('tax_included');
        m.draftValues.unitPrice = String(d.fuelUnitPrice);
        filled.push('単価');
      }
      if (d.fuelType) {
        setFuelType(d.fuelType);
        filled.push('油種');
      }
      if (d.fullTank != null) setFullTank(d.fullTank);
    }
    if (d.filterChanged != null && isOil) {
      setFilterChanged(d.filterChanged);
      m.draftValues.filterChanged = String(d.filterChanged);
      filled.push('フィルター');
    }
    if (d.note && !isOil && !isOdoOnly) {
      setNote(d.note.slice(0, 200));
      m.draftValues.note = d.note.slice(0, 200);
      filled.push('メモ');
    }
    // タイヤ・ブレーキは走行距離を中心に読み取る（金額は使わない）。整備・走行距離と出ても選び直しを勧めない
    const sameKind = d.category === kind || (wear && (d.category === 'maintenance' || d.category === 'odometer'));
    const otherKind = d.category && !sameKind ? `内容は「${kindLabel(d.category)}」のようです。項目が違う場合は選び直してください。` : '';
    setDraftNotice(
      filled.length > 0
        ? `${filled.join('・')}を入れました。間違いがないか確かめてから記録してください。${otherKind}`
        : `読み取れる内容がありませんでした。もう一度試すか、手で入力してください。${otherKind}`,
    );
  };

  const save = async () => {
    if (!valid) return;
    if (odoKm != null) {
      // 編集中の記録自身とは比べない
      const others = bundle.points
        .filter((p) => !(initialOdo != null && p.date === initialDate && p.odo_km === initialOdo))
        .map((p) => ({ date: p.date, odoKm: p.odo_km }));
      const replacements = bundle.meterReplacements.map((m) => ({
        replacedOn: m.replaced_on,
        odoBeforeKm: m.odo_before_km,
        odoAfterKm: m.odo_after_km,
      }));
      const warnings = checkOdoEntry({ date, odoKm }, others, replacements, unit);
      metrics.current.warningsShown += warnings.length;
      if (!(await confirmWarnings(warnings.map((w) => w.message)))) return;
    }
    setBusy(true);
    try {
      const vehicleId = bundle.vehicle.id;
      let recordRef: string;
      if (isOil) {
        const saved = await saveOilChange({
          id: target?.type === 'oil' ? target.row.id : undefined,
          vehicleId,
          date,
          odoKm: odoKm!,
          oilChanged: true,
          filterChanged,
          amountYen,
        });
        recordRef = `oil:${saved.id}`;
      } else if (isWearKind(kind)) {
        const saved = await saveWearCheck({
          id: target?.type === 'wear' ? target.row.id : undefined,
          vehicleId,
          kind,
          date,
          odoKm,
          replaced,
          remainingMm,
          note: note.trim() || null,
        });
        recordRef = `wear:${saved.id}`;
      } else if (isOdoOnly) {
        const saved = await saveOdoReading({ id: target?.type === 'odometer' ? target.row.id : undefined, vehicleId, date, odoKm: odoKm! });
        recordRef = `odometer:${saved.id}`;
      } else {
        const saved = await saveExpense({
          id: target?.type === 'expense' ? target.row.id : undefined,
          vehicleId,
          category: kind,
          date,
          amountYen: amountYen!,
          odoKm,
          note: note.trim() || null,
          fuel: isFuel ? { liters: litersN, unitPrice: unitPriceN, priceBasis: unitPriceN != null ? basis : null, fuelType, fullTank } : null,
        });
        recordRef = `expense:${saved.id}`;
      }
      metrics.current.saved = true;
      finishSession('saved', recordRef);
      await invalidate();
      allowLeave.current = true;
      onSaved(recordRef);
    } catch (e) {
      Alert.alert('保存できませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={{ gap: spacing.md }}>
      {!target && <QuickInput kind={isWearKind(kind) ? 'odometer' : kind} today={bundle.today} unit={unit} onDraft={applyDraft} />}
      {draftNotice && <Notice title="読み取った内容を確認してください">{draftNotice}</Notice>}
      <Card>
        <AppText variant="heading">{kindLabel(kind)}</AppText>
        <DateField label="日付" value={date} onChange={(v) => v && setDate(v)} />
        <Field
          label={odoRequired ? '走行距離（ODO）' : '走行距離（ODO・任意）'}
          value={odo}
          onChangeText={setOdo}
          keyboardType="number-pad"
          suffix={distanceUnitLabel(unit)}
          hint={
            odoKm != null && !Number.isFinite(odoKm)
              ? '数字で入力してください'
              : isFuel
                ? '満タンの給油で入れると、燃費を計算します。'
                : undefined
          }
        />
        {isFuel && (
          <FuelFields
            fuelType={fuelType}
            onFuelType={setFuelType}
            liters={liters}
            onLiters={setLiters}
            litersValid={litersValid}
            unitPrice={unitPrice}
            onUnitPrice={setUnitPrice}
            unitPriceValid={unitPriceValid}
            basis={basis}
            onBasis={setBasis}
            fullTank={fullTank}
            onFullTank={setFullTank}
          />
        )}
        {wear && (
          <>
            <ToggleRow title={WEAR_FORM[wear].replaced} description="点検・確認だけなら、オフのまま記録します。" value={replaced} onChange={setReplaced} />
            <Field
              label={WEAR_FORM[wear].remaining}
              value={remaining}
              onChangeText={setRemaining}
              keyboardType="decimal-pad"
              suffix="mm"
              hint={remainingValid ? WEAR_FORM[wear].hint : '数字で入力してください（例：3.5）'}
            />
          </>
        )}
        {!isOdoOnly && !wear && (
          <Field
            label={isOil ? '金額（任意）' : '金額'}
            value={amount}
            onChangeText={changeAmount}
            keyboardType="number-pad"
            suffix="円"
            hint={isOil ? '入力すると維持費に1件として数えます。' : isFuel ? '給油量と単価を入れると、税込の合計を自動で入れます。' : undefined}
          />
        )}
        {fuelCost && (
          <FuelBreakdown
            cost={fuelCost}
            fuelType={fuelType}
            amountYen={amountYen}
            onUseTotal={() => {
              setAmount(String(fuelCost.totalYen));
              setAmountManual(false);
            }}
          />
        )}
        {economy && <FuelEconomyPreview kmPerLiter={economy.kmPerLiter} distanceKm={economy.distanceKm} liters={economy.liters} unit={unit} />}
        {isOil && (
          <ToggleRow
            title="フィルターも交換した"
            description="オイルフィルターは別の周期で管理し、通知も別に出します。"
            value={filterChanged}
            onChange={setFilterChanged}
          />
        )}
        {!isOil && !isOdoOnly && <Field label="メモ（任意）" value={note} onChangeText={setNote} maxLength={200} />}
        {wear && <AppText variant="caption">費用は「整備」から記録してください。</AppText>}
        {kind === 'maintenance' && (
          <AppText variant="caption">オイル交換は「オイル交換」から記録してください（金額が二重に数えられるのを防ぐため）。</AppText>
        )}
      </Card>
      <Button title={target ? '保存する' : '記録する'} disabled={!valid} loading={busy} onPress={save} />
    </View>
  );
}

