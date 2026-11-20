import { Ionicons } from '@expo/vector-icons';
import { router, useNavigation, usePreventRemove } from 'expo-router';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { businessAmount, canBeOnAccount, withConsumptionTax } from '@domain/bookkeeping.ts';
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
import { dailyPace, estimatedMeterReading } from '@domain/pace.ts';
import { distanceUnitLabel, fromKm, toKm } from '@domain/units.ts';
import {
  fuelFills,
  logInputSession,
  saveExpense,
  saveOdoReading,
  saveOilChange,
  saveWearCheck,
  useInvalidate,
  useVehicleCertificate,
  vehicleUnit,
  type ExpenseRow,
  type OdometerReadingRow,
  type OilChangeRow,
  type VehicleBundle,
  type WearCheckRow,
  type WearKind,
} from '../lib/data';
import { parseDecimal, parseInteger, parseMillimeters, yen } from '../lib/format';
import type { RecordDraft } from '@shared/record-draft.ts';
import { vehicleTaxSpec } from '@shared/db-mapping.ts';
import { automobileTaxFor, fiscalYearOf, vehicleTaxSpecLabel, weightTaxFor } from '@domain/vehicle-tax.ts';
import { taxPrefecture } from '@domain/vehicle-certificate.ts';
import { cardShadow, fonts, radius, spacing, useColors } from '../theme';
import { ComputedAmount } from './ComputedAmount';
import { FuelEconomyPreview, FuelFields } from './FuelFields';
import { QuickInput } from './QuickInput';
import { AppText, Button, Card, DateField, Field, Notice, Segmented, ToggleRow } from './ui';
import { alertError } from '../lib/alerts';

const PAYMENT_OPTIONS: { value: 'now' | 'on_account'; label: string }[] = [
  { value: 'now', label: 'その場で払った' },
  { value: 'on_account', label: 'かけ（掛けカード）' },
];

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

/** 走行距離の見込みを入れておく項目（走行距離を使う記録） */
const ODO_ESTIMATE_KINDS = new Set<RecordKind>(['oil_change', 'odometer', 'fuel', 'tire', 'brake']);

/** その日のメーターの見込み（km）。記録が無ければ null */
function estimateMeterKm(bundle: VehicleBundle, date: string): number | null {
  const readings = bundle.state.readings;
  if (readings.length === 0) return null;
  const replacements = bundle.meterReplacements.map((m) => ({ replacedOn: m.replaced_on, odoBeforeKm: m.odo_before_km, odoAfterKm: m.odo_after_km }));
  return estimatedMeterReading(readings, replacements, dailyPace(readings, bundle.vehicle.annual_km_estimate), date);
}

function litersText(n: number | null): string {
  return n == null ? '' : n.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
}

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
  prefill,
  initialDraft,
}: {
  bundle: VehicleBundle;
  kind: RecordKind;
  target?: EditTarget;
  /** 新しい記録に最初から入れておく値（スタンドに来たときの給油など） */
  prefill?: { note?: string };
  /** 写真で読み取った内容（レシートをまとめて取り込む画面から開いたとき）。開いたときに一度だけ入れる */
  initialDraft?: RecordDraft;
  /** 保存した記録を `/records/[id]` で開くための ID（例：`expense:…`）を渡す */
  onSaved: (recordRef: string) => void;
}) {
  const invalidate = useInvalidate();
  const navigation = useNavigation();
  const certificate = useVehicleCertificate(bundle.vehicle);
  const initialDate =
    target?.type === 'oil' || target?.type === 'wear'
      ? target.row.performed_on
      : target?.type === 'expense'
        ? target.row.spent_on
        : target?.type === 'odometer'
          ? target.row.read_on
          : bundle.today;
  // 走行距離は DB では km。入力欄は車両の単位（km / mile）で見せる
  const unit = vehicleUnit(bundle.vehicle);
  const initialOdo = target ? target.row.odo_km : null;
  const initialOdoText = initialOdo != null ? String(fromKm(initialOdo, unit)) : '';
  const expenseRow = target?.type === 'oil' ? target.expense : target?.type === 'expense' ? target.row : null;
  // 支払い方法：かけ（後払い）は税抜の金額・単価を入れてもらい、消費税をアプリで足す。
  // 新しい記録は、同じ項目の前回の記録と同じ支払い方法から始める（かけで給油する人が毎回選び直さなくてよいように）
  const canPayOnAccount = kind !== 'odometer' && !isWearKind(kind) && canBeOnAccount(kind);
  const lastSameKind = bundle.expenses.find((e) => e.category === kind);
  const initialOnAccount =
    canPayOnAccount &&
    (expenseRow
      ? expenseRow.on_account === true || expenseRow.fuel_price_basis === 'tax_excluded'
      : !target && (lastSameKind?.on_account === true || lastSameKind?.fuel_price_basis === 'tax_excluded'));
  const initialAmount =
    expenseRow == null ? null : expenseRow.on_account && expenseRow.entered_amount_yen != null ? expenseRow.entered_amount_yen : expenseRow.amount_yen;
  const initialExempt = expenseRow?.exempt_yen != null ? String(expenseRow.exempt_yen) : '';

  // 給油：油種は前回の給油と同じものから始める。満タンは新しい記録ではオンから始める
  const isFuel = kind === 'fuel';
  const fuelRow = target?.type === 'expense' && target.row.category === 'fuel' ? target.row : null;
  const initialLiters = fuelRow?.fuel_liters != null ? String(Number(fuelRow.fuel_liters)) : '';
  const initialUnitPrice = fuelRow?.fuel_unit_price != null ? String(Number(fuelRow.fuel_unit_price)) : '';
  const initialFuelType: FuelType = fuelRow?.fuel_type ?? bundle.expenses.find((e) => e.category === 'fuel' && e.fuel_type)?.fuel_type ?? 'regular';
  const initialBasis: FuelPriceBasis = initialOnAccount ? 'tax_excluded' : 'tax_included';
  const initialFullTank = fuelRow ? fuelRow.fuel_full_tank === true : true;

  const [date, setDate] = useState<string>(initialDate);
  const [odoInputText, setOdo] = useState(initialOdoText);
  // 新しい記録は、走行距離にペースからの見込みを最初から入れておく（自分で入れるまで。日付を変えたら見込みも変わる）
  const [odoTouched, setOdoTouched] = useState(!!target);
  const [amountInput, setAmount] = useState(initialAmount != null ? String(initialAmount) : '');
  const [liters, setLiters] = useState(initialLiters);
  const [unitPrice, setUnitPrice] = useState(initialUnitPrice);
  const [fuelType, setFuelType] = useState<FuelType>(initialFuelType);
  const [onAccount, setOnAccount] = useState(initialOnAccount);
  const [exempt, setExempt] = useState(initialExempt);
  // 車検の「うち法定費用」は、自分で入れるまで計算した重量税を入れておく（編集で既に値があれば上書きしない）
  const [exemptManual, setExemptManual] = useState(initialExempt !== '' || !!target);
  const basis: FuelPriceBasis = onAccount ? 'tax_excluded' : 'tax_included';
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
  const initialNote = target?.type === 'expense' || target?.type === 'wear' ? (target.row.note ?? '') : !target ? (prefill?.note ?? '') : '';
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
  const estimateKm = !target && ODO_ESTIMATE_KINDS.has(kind) ? estimateMeterKm(bundle, date) : null;
  const odoFromEstimate = !odoTouched && odoInputText === '' && estimateKm != null;
  const odo = odoFromEstimate ? String(fromKm(estimateKm, unit)) : odoInputText;
  const changeOdo = (v: string) => {
    setOdo(v);
    setOdoTouched(true);
  };
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
  // 自動車税・車検の重量税は、車検証の項目（車両情報と周期）から計算する
  // 県ごとの税率は、車検証の使用の本拠の位置の都道府県で決める
  const prefecture = certificate.data ? taxPrefecture(certificate.data) : null;
  const taxSpec = { ...vehicleTaxSpec(bundle.vehicle), prefecture };
  const taxSpecComplete = !!(taxSpec.vehicleClass && taxSpec.firstRegisteredOn && taxSpec.powertrain);
  const carTax = kind === 'car_tax' ? automobileTaxFor(taxSpec, fiscalYearOf(date)) : null;
  const weightTax = kind === 'shaken' ? weightTaxFor(taxSpec, date) : null;
  const taxSpecLabel = vehicleTaxSpecLabel(taxSpec);
  const carTaxInputLabel = carTax ? `${vehicleTaxSpecLabel(taxSpec)}（${fiscalYearOf(date)}年度）` : '';
  const needsTaxSpec = (kind === 'car_tax' && !carTax) || (kind === 'shaken' && !weightTax);
  // 入力した数字（給油量×単価）。計算後の金額と並べて見せる
  const fuelInputLabel = fuelCost ? `${litersText(litersN)}L × ${litersText(unitPriceN)}円/L（${onAccount ? '税抜' : '税込'}）` : '';
  // 金額を自分で入れていなければ、給油量×単価で計算した合計を金額にする
  const autoAmountYen = fuelCost?.totalYen ?? carTax?.amountYen ?? null;
  const amount = !amountManual && autoAmountYen != null ? String(autoAmountYen) : amountInput;
  const fieldYen = parseInteger(amount);
  // かけ（給油以外）は、入れた税抜の金額に消費税を足して税込にする。車検は法定費用（消費税のかからない分）を除いて足す
  const isShaken = kind === 'shaken';
  const exemptText = !exemptManual && weightTax ? String(weightTax.amountYen) : exempt;
  const exemptN = isShaken ? parseInteger(exemptText) : null;
  const taxExcludedEntry = onAccount && canPayOnAccount && !isFuel;
  const fieldOk = fieldYen != null && Number.isFinite(fieldYen) && fieldYen > 0;
  const exemptOk = exemptN == null || (Number.isFinite(exemptN) && exemptN >= 0 && (!fieldOk || exemptN <= fieldYen!));
  const onAccountTotal = taxExcludedEntry && fieldOk && exemptOk ? withConsumptionTax(fieldYen!, date, exemptN ?? 0) : null;
  const amountYen = onAccountTotal ? onAccountTotal.totalYen : fieldYen;
  // 仕事で使う割合を設定していれば、経費にする額も見せる
  const businessPercent = bundle.vehicle.business_use_percent ?? null;
  const businessOf = (totalYen: number | undefined) =>
    businessPercent != null && totalYen != null ? { percent: businessPercent, yen: businessAmount(totalYen, businessPercent) } : null;
  const fuelBusiness = businessOf(fuelCost?.totalYen);
  const onAccountBusiness = businessOf(onAccountTotal?.totalYen);
  const carTaxBusiness = businessOf(carTax?.amountYen);
  // 自分で入れた金額（レシートなど）が給油量×単価の計算と違えば知らせる
  const fuelMismatchYen = fuelCost && fieldOk && fieldYen !== fuelCost.totalYen ? fieldYen : null;
  const applyFuelTotal = () => {
    if (!fuelCost) return;
    setAmount(String(fuelCost.totalYen));
    setAmountManual(false);
  };
  const carTaxMismatchYen = carTax && fieldOk && fieldYen !== carTax.amountYen ? fieldYen : null;
  const applyCarTax = () => {
    setAmount('');
    setAmountManual(false);
  };
  const changeExempt = (v: string) => {
    setExempt(v);
    setExemptManual(v.trim() !== '');
  };
  const onAccountInputLabel = onAccountTotal ? `税抜 ${yen(fieldYen!)}${exemptN ? `（うち法定費用 ${yen(exemptN)}）` : ''}` : '';
  const changeAmount = (v: string) => {
    setAmount(v);
    setAmountManual(v.trim() !== '');
  };

  // 満タンで走行距離と給油量があれば、前回の満タンからの燃費をその場で見せる
  // 給油の記録は多くても数百件なので、毎回計算する（useMemo にすると、計算後の金額の表示と組み合わせたとき React Compiler の lint が通らない）
  const economy = (() => {
    // 見込みの走行距離では燃費を出さない（メーターの数字を入れてから）
    if (!isFuel || !fullTank || odoFromEstimate || odoKm == null || !Number.isFinite(odoKm) || litersN == null || !litersValid) return null;
    const others = fuelFills(bundle.expenses.filter((e) => e.id !== fuelRow?.id));
    const candidate = { id: '__editing__', date, odoKm, liters: litersN, fullTank: true, amountYen: 0 };
    const replacements = bundle.meterReplacements.map((m) => ({ replacedOn: m.replaced_on, odoBeforeKm: m.odo_before_km, odoAfterKm: m.odo_after_km }));
    return fuelEconomySegments([...others, candidate], replacements).find((seg) => seg.toId === '__editing__') ?? null;
  })();
  const remainingMm = parseMillimeters(remaining);
  const odoRequired = isOil || isOdoOnly;
  // ponytail: タイヤ・ブレーキの費用は「整備」の支出で記録する（オイルのように記録へ紐づけない）。
  // 実証実験で費用まで一度に入れたいという声が多ければ、expenses に wear_check_id を足す
  const amountRequired = !isOil && !isOdoOnly && !wear;

  const odoValid = odoKm == null ? !odoRequired : Number.isFinite(odoKm) && odoKm <= 2_000_000;
  const amountValid = amountYen == null ? !amountRequired : Number.isFinite(amountYen) && amountYen > 0 && amountYen < 100_000_000;
  const remainingValid = remainingMm == null || (Number.isFinite(remainingMm) && remainingMm <= 30);
  const fuelValid = !isFuel || (litersValid && unitPriceValid);
  const valid = !!date && odoValid && amountValid && remainingValid && fuelValid && exemptOk;

  // 入力の計測（実証実験の KPI 用）。画面を開いてから保存・離脱までと、写真・音声で埋まった項目を覚える
  const values = { date, odo, amount, note, remaining, filterChanged: String(filterChanged), liters, unitPrice, exempt: exemptText };
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
    // 見込みを入れただけでは入力中にしない
    odoInputText !== initialOdoText ||
    liters !== initialLiters ||
    unitPrice !== initialUnitPrice ||
    fuelType !== initialFuelType ||
    onAccount !== initialOnAccount ||
    exempt !== initialExempt ||
    fullTank !== initialFullTank ||
    // 自動で入れた金額（自動車税など）だけでは入力中にしない
    amountInput !== (initialAmount != null ? String(initialAmount) : '') ||
    note !== initialNote ||
    replaced !== initialReplaced ||
    remaining !== initialRemaining ||
    filterChanged !== (target?.type === 'oil' ? target.row.filter_changed : false);
  // 止めた移動をやり直すときは、必ず `repeat()` を使う（止めるのを解いてから移動する）。
  // `navigation.dispatch(data.action)` でやり直すと、まだ止めているためまた止められ、この関数が呼ばれ続けて
  // アプリが固まる（2026-11-07 報告：保存して「OK」を押すと画面が変わらず、ボタンが何も効かなくなった）
  usePreventRemove(dirty, ({ repeat }) => {
    if (allowLeave.current) {
      repeat();
      return;
    }
    Alert.alert('入力中の内容を破棄しますか', '戻ると、この画面で入力した内容は保存されません。', [
      { text: '入力を続ける', style: 'cancel' },
      { text: '破棄して戻る', style: 'destructive', onPress: repeat },
    ]);
  });
  useEffect(() => {
    latestValues.current = values;
    if (dirty) metrics.current.touched = true;
  });
  // 左上の「戻る」は、iOS でも JS で戻すボタンにしてあり（src/app/_layout.tsx）、押すと上の確認が必ず出る。
  // 横スワイプで戻る操作は確認を出せないことがあるため、入力中は止める（入力していなければスワイプで戻れる）
  useLayoutEffect(() => {
    navigation.setOptions({ gestureEnabled: !dirty });
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
      setOdoTouched(true);
      m.draftValues.odo = String(d.odo);
      filled.push('走行距離');
    }
    if (d.amountYen != null && !isOdoOnly && !wear) {
      setAmount(String(d.amountYen));
      setAmountManual(true);
      // レシート・音声の金額は、その場で払った税込の金額
      setOnAccount(false);
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
        // レシート・店頭の単価は税込（その場で払った）。音声で「税抜」と言うことは考えない
        setOnAccount(false);
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

  const appliedInitialDraft = useRef(false);
  useEffect(() => {
    if (initialDraft && !appliedInitialDraft.current) {
      appliedInitialDraft.current = true;
      applyDraft(initialDraft, 'photo');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!valid) return;
    if (odoFromEstimate) {
      const ok = await new Promise<boolean>((resolve) =>
        Alert.alert('走行距離は見込みのままです', `メーターの数字（${odo}${distanceUnitLabel(unit)}）と合っていますか。違えば直してから記録してください。`, [
          { text: '直す', style: 'cancel', onPress: () => resolve(false) },
          { text: '合っている', onPress: () => resolve(true) },
        ]),
      );
      if (!ok) return;
    }
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
      const payment = {
        onAccount: canPayOnAccount && onAccount,
        enteredAmountYen: taxExcludedEntry ? fieldYen : null,
        exemptYen: isShaken ? exemptN : null,
      };
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
          payment,
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
          payment,
        });
        recordRef = `expense:${saved.id}`;
      }
      metrics.current.saved = true;
      finishSession('saved', recordRef);
      await invalidate();
      allowLeave.current = true;
      onSaved(recordRef);
    } catch (e) {
      alertError('保存できませんでした', e);
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
          onChangeText={changeOdo}
          keyboardType="number-pad"
          suffix={distanceUnitLabel(unit)}
          hint={
            odoKm != null && !Number.isFinite(odoKm)
              ? '数字で入力してください'
              : odoFromEstimate
                ? 'これまでのペースからの見込みです。メーターの数字と違えば直してください。'
                : isFuel
                ? '満タンの給油で入れると、燃費を計算します。'
                : undefined
          }
        />
        {canPayOnAccount && (
          <>
            <AppText variant="label">支払い</AppText>
            <Segmented options={PAYMENT_OPTIONS} value={onAccount ? 'on_account' : 'now'} onChange={(v) => setOnAccount(v === 'on_account')} />
            {onAccount && (
              <>
                <AppText variant="caption">掛けカードの請求書の税抜の単価を入れてください。消費税などはアプリで足します。</AppText>
                {isFuel && !target && <Button title="月の明細からまとめて登録する" variant="plain" onPress={() => router.push('/records/fuel-statement')} />}
              </>
            )}
          </>
        )}
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
            onAccount={onAccount}
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
            label={`${taxExcludedEntry ? '金額（税抜）' : '金額'}${isOil ? '（任意）' : ''}`}
            value={amount}
            onChangeText={changeAmount}
            keyboardType="number-pad"
            suffix="円"
            hint={
              isFuel
                ? '給油量と単価を入れると、金額を自動で入れます。'
                : isOil
                  ? '入力すると維持費に1件として数えます。'
                  : undefined
            }
          />
        )}
        {isShaken && (
          <Field
            label="うち法定費用（任意）"
            value={exemptText}
            onChangeText={changeExempt}
            keyboardType="number-pad"
            suffix="円"
            hint={
              !exemptOk
                ? '金額より小さい数字を入れてください'
                : !exemptManual && weightTax
                  ? '重量税を自動で入れました。自賠責保険料・印紙代があれば足してください。'
                  : '重量税・自賠責保険料・印紙代の合計です。請求書に書いてあれば入れてください。'
            }
          />
        )}
        {fuelCost && (
          <ComputedAmount
            input={fuelInputLabel}
            totalYen={fuelCost.totalYen}
            business={fuelBusiness}
            mismatch={fuelMismatchYen != null ? { enteredYen: fuelMismatchYen, onUseComputed: applyFuelTotal } : null}
          />
        )}
        {carTax && (
          <ComputedAmount
            input={carTaxInputLabel}
            totalYen={carTax.amountYen}
            business={carTaxBusiness}
            mismatch={carTaxMismatchYen != null ? { enteredYen: carTaxMismatchYen, onUseComputed: applyCarTax } : null}
          />
        )}
        {needsTaxSpec && (
          <>
            <AppText variant="caption">
              {taxSpecComplete
                ? `このクルマ（${taxSpecLabel}）の${kind === 'car_tax' ? '自動車税' : '重量税'}は自動で計算できません。${kind === 'car_tax' ? '納付書' : '請求書'}の金額を入れてください。`
                : kind === 'car_tax'
                  ? '車検証の内容を入れると、自動車税を自動で計算します。'
                  : '車検証の内容を入れると、重量税を自動で計算します。'}
            </AppText>
            {!taxSpecComplete && <Button title="車検証の内容を入れる" variant="secondary" onPress={() => router.push('/settings/certificate')} />}
          </>
        )}
        {!fuelCost && onAccountTotal && (
          <ComputedAmount
            input={onAccountInputLabel}
            totalYen={onAccountTotal.totalYen}
            business={onAccountBusiness}
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

