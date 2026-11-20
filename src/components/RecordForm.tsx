import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { businessAmount, withConsumptionTax } from '@domain/bookkeeping.ts';
import { calculateFuelCost, fuelEconomySegments, isValidFuelLiters, isValidFuelUnitPrice } from '@domain/fuel.ts';
import { checkOdoEntry } from '@domain/odo.ts';
import { distanceUnitLabel, fromKm, toKm } from '@domain/units.ts';
import { fiscalYearOf } from '@domain/vehicle-tax.ts';
import type { RecordDraft } from '@shared/record-draft.ts';
import { toMeterReplacements } from '@shared/db-mapping.ts';
import { alertError, askToConfirm } from '../lib/alerts';
import {
  fuelFills,
  saveExpense,
  saveOdoReading,
  saveOilChange,
  saveWearCheck,
  useInvalidate,
  useVehicleCertificate,
  vehicleUnit,
  type VehicleBundle,
} from '../lib/data';
import { parseDecimal, parseInteger, parseMillimeters, yen } from '../lib/format';
import { isWearKind, kindLabel, type EditTarget, type RecordKind } from '../lib/record-kinds';
import { spacing } from '../theme';
import { ComputedAmount } from './ComputedAmount';
import { FuelEconomyPreview, FuelFields } from './FuelFields';
import { QuickInput } from './QuickInput';
import { PaymentFields, TaxSpecNotice, WearFields } from './record-form/sections';
import { useInputMetrics } from './record-form/useInputMetrics';
import { useLeaveGuard } from './record-form/useLeaveGuard';
import {
  canPayOnAccount,
  estimateMeterKm,
  initialAmountIsManual,
  initialValues,
  isDirty,
  recordDate,
  recordTaxes,
  type FormValues,
} from './record-form/values';
import { AppText, Button, Card, DateField, Field, Notice, ToggleRow } from './ui';

function litersText(n: number | null): string {
  return n == null ? '' : n.toLocaleString('ja-JP', { maximumFractionDigits: 2 });
}

/** 1件の記録を入れる・直すフォーム。項目（kind）によって出す入力欄を変える */
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
  const certificate = useVehicleCertificate(bundle.vehicle);
  // 走行距離は DB では km。入力欄は車両の単位（km / mile）で見せる
  const unit = vehicleUnit(bundle.vehicle);
  const [initial] = useState(() => initialValues(bundle, kind, unit, target, prefill?.note));
  const [form, setForm] = useState(initial);
  const update = (patch: Partial<FormValues>) => setForm((f) => ({ ...f, ...patch }));
  const { date, liters, unitPrice, fuelType, onAccount, fullTank, note, replaced, remaining, filterChanged } = form;
  // 新しい記録は、走行距離にペースからの見込みを最初から入れておく（自分で入れるまで。日付を変えたら見込みも変わる）
  const [odoTouched, setOdoTouched] = useState(!!target);
  // 金額を自分で入れた（またはレシートから読んだ）ら、給油量×単価の計算で上書きしない。空にすると自動に戻る
  const [amountManual, setAmountManual] = useState(() => initialAmountIsManual(initial));
  // 車検の「うち法定費用」は、自分で入れるまで計算した重量税を入れておく（編集で既に値があれば上書きしない）
  const [exemptManual, setExemptManual] = useState(initial.exempt !== '' || !!target);
  const [busy, setBusy] = useState(false);
  const [draftNotice, setDraftNotice] = useState<string | null>(null);

  const isOil = kind === 'oil_change';
  const isOdoOnly = kind === 'odometer';
  const isFuel = kind === 'fuel';
  const isShaken = kind === 'shaken';
  const wear = isWearKind(kind) ? kind : null;
  const payableOnAccount = canPayOnAccount(kind);
  const fuelRowId = target?.type === 'expense' && target.row.category === 'fuel' ? target.row.id : null;

  // 走行距離
  const estimateKm = target ? null : estimateMeterKm(bundle, kind, date);
  const odoFromEstimate = !odoTouched && form.odoText === '' && estimateKm != null;
  const odo = odoFromEstimate ? String(fromKm(estimateKm, unit)) : form.odoText;
  const odoInput = parseInteger(odo);
  const odoKm = odoInput == null ? null : toKm(odoInput, unit);
  const odoRequired = isOil || isOdoOnly;

  // 給油
  const litersN = parseDecimal(liters, 2);
  const unitPriceN = parseDecimal(unitPrice, 1);
  const litersValid = litersN == null || isValidFuelLiters(litersN);
  const unitPriceValid = unitPriceN == null || isValidFuelUnitPrice(unitPriceN);
  const basis = onAccount ? 'tax_excluded' : 'tax_included';
  const fuelCost =
    isFuel && litersN != null && unitPriceN != null && litersValid && unitPriceValid
      ? calculateFuelCost({ date, fuelType, liters: litersN, unitPriceYen: unitPriceN, basis })
      : null;

  // 自動車税・重量税
  const taxes = recordTaxes(kind, bundle.vehicle, certificate.data, date);
  const { carTax, weightTax } = taxes;

  // 金額。自分で入れていなければ、給油量×単価や自動車税で計算した額を入れる
  const autoAmountYen = fuelCost?.totalYen ?? carTax?.amountYen ?? null;
  const amount = !amountManual && autoAmountYen != null ? String(autoAmountYen) : form.amount;
  const fieldYen = parseInteger(amount);
  const fieldOk = fieldYen != null && Number.isFinite(fieldYen) && fieldYen > 0;
  // かけ（給油以外）は、入れた税抜の金額に消費税を足して税込にする。車検は法定費用（消費税のかからない分）を除いて足す
  const exemptText = !exemptManual && weightTax ? String(weightTax.amountYen) : form.exempt;
  const exemptN = isShaken ? parseInteger(exemptText) : null;
  const exemptOk = exemptN == null || (Number.isFinite(exemptN) && exemptN >= 0 && (!fieldOk || exemptN <= fieldYen!));
  const taxExcludedEntry = onAccount && payableOnAccount && !isFuel;
  const onAccountTotal = taxExcludedEntry && fieldOk && exemptOk ? withConsumptionTax(fieldYen!, date, exemptN ?? 0) : null;
  const amountYen = onAccountTotal ? onAccountTotal.totalYen : fieldYen;
  // ponytail: タイヤ・ブレーキの費用は「整備」の支出で記録する（オイルのように記録へ紐づけない）。
  // 実証実験で費用まで一度に入れたいという声が多ければ、expenses に wear_check_id を足す
  const amountRequired = !isOil && !isOdoOnly && !wear;
  // 仕事で使う割合を設定していれば、経費にする額も見せる
  const businessPercent = bundle.vehicle.business_use_percent ?? null;
  const businessOf = (totalYen: number | undefined) =>
    businessPercent != null && totalYen != null ? { percent: businessPercent, yen: businessAmount(totalYen, businessPercent) } : null;
  // 自分で入れた金額（レシートなど）が計算と違えば知らせる
  const mismatchWith = (computedYen: number | undefined) => (computedYen != null && fieldOk && fieldYen !== computedYen ? fieldYen : null);
  const applyComputedAmount = (amountText: string) => {
    update({ amount: amountText });
    setAmountManual(false);
  };

  // 満タンで走行距離と給油量があれば、前回の満タンからの燃費をその場で見せる
  // 給油の記録は多くても数百件なので、毎回計算する（useMemo にすると、計算後の金額の表示と組み合わせたとき React Compiler の lint が通らない）
  const economy = (() => {
    // 見込みの走行距離では燃費を出さない（メーターの数字を入れてから）
    if (!isFuel || !fullTank || odoFromEstimate || odoKm == null || !Number.isFinite(odoKm) || litersN == null || !litersValid) return null;
    const others = fuelFills(bundle.expenses.filter((e) => e.id !== fuelRowId));
    const candidate = { id: '__editing__', date, odoKm, liters: litersN, fullTank: true, amountYen: 0 };
    return fuelEconomySegments([...others, candidate], toMeterReplacements(bundle.meterReplacements)).find((seg) => seg.toId === '__editing__') ?? null;
  })();

  const remainingMm = parseMillimeters(remaining);
  const odoValid = odoKm == null ? !odoRequired : Number.isFinite(odoKm) && odoKm <= 2_000_000;
  const amountValid = amountYen == null ? !amountRequired : Number.isFinite(amountYen) && amountYen > 0 && amountYen < 100_000_000;
  const remainingValid = remainingMm == null || (Number.isFinite(remainingMm) && remainingMm <= 30);
  const fuelValid = !isFuel || (litersValid && unitPriceValid);
  const valid = !!date && odoValid && amountValid && remainingValid && fuelValid && exemptOk;

  // 見込みの走行距離や自動で入れた金額だけでは、入力途中にしない（比べるのは入力欄に入れた値）
  const dirty = isDirty(form, initial);
  const { allowLeave } = useLeaveGuard(dirty);
  const metrics = useInputMetrics({
    vehicleId: bundle.vehicle.id,
    kind,
    isEdit: !!target,
    values: { date, odo, amount, note, remaining, filterChanged: String(filterChanged), liters, unitPrice, exempt: exemptText },
    dirty,
  });

  /** 写真・音声で読み取った値を入れる。読み取れなかった項目は今の入力を残す */
  const applyDraft = (d: RecordDraft, via: 'photo' | 'voice') => {
    const patch: Partial<FormValues> = {};
    const drafted: Record<string, string> = {};
    const filled: string[] = [];
    if (d.date) {
      patch.date = drafted.date = d.date;
      filled.push('日付');
    }
    if (d.odo != null) {
      patch.odoText = drafted.odo = String(d.odo);
      setOdoTouched(true);
      filled.push('走行距離');
    }
    if (d.amountYen != null && !isOdoOnly && !wear) {
      patch.amount = drafted.amount = String(d.amountYen);
      setAmountManual(true);
      // レシート・音声の金額は、その場で払った税込の金額
      patch.onAccount = false;
      filled.push('金額');
    }
    if (isFuel) {
      if (d.fuelLiters != null) {
        patch.liters = drafted.liters = String(d.fuelLiters);
        filled.push('給油量');
      }
      if (d.fuelUnitPrice != null) {
        patch.unitPrice = drafted.unitPrice = String(d.fuelUnitPrice);
        // レシート・店頭の単価は税込（その場で払った）。音声で「税抜」と言うことは考えない
        patch.onAccount = false;
        filled.push('単価');
      }
      if (d.fuelType) {
        patch.fuelType = d.fuelType;
        filled.push('油種');
      }
      if (d.fullTank != null) patch.fullTank = d.fullTank;
    }
    if (d.filterChanged != null && isOil) {
      patch.filterChanged = d.filterChanged;
      drafted.filterChanged = String(d.filterChanged);
      filled.push('フィルター');
    }
    if (d.note && !isOil && !isOdoOnly) {
      patch.note = drafted.note = d.note.slice(0, 200);
      filled.push('メモ');
    }
    update(patch);
    metrics.drafted(via, drafted);
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

  /** 走行距離の見込みのまま・前後の記録と合わないときは、確かめてから保存する */
  const confirmOdo = async (): Promise<boolean> => {
    if (odoFromEstimate) {
      const ok = await askToConfirm(
        '走行距離は見込みのままです',
        `メーターの数字（${odo}${distanceUnitLabel(unit)}）と合っていますか。違えば直してから記録してください。`,
        { cancel: '直す', ok: '合っている' },
      );
      if (!ok) return false;
    }
    if (odoKm == null) return true;
    // 編集中の記録自身とは比べない
    const self = target?.row.odo_km != null ? { date: recordDate(target), odoKm: target.row.odo_km } : null;
    const others = bundle.points
      .filter((p) => !(self && p.date === self.date && p.odo_km === self.odoKm))
      .map((p) => ({ date: p.date, odoKm: p.odo_km }));
    const warnings = checkOdoEntry({ date, odoKm }, others, toMeterReplacements(bundle.meterReplacements), unit);
    metrics.warned(warnings.length);
    if (warnings.length === 0) return true;
    return askToConfirm('入力を確認してください', warnings.map((w) => w.message).join('\n\n'), { cancel: '修正する', ok: 'このまま登録' });
  };

  /** 項目に合わせて保存し、`/records/[id]` で開くための ID を返す */
  const saveRecord = async (): Promise<string> => {
    const vehicleId = bundle.vehicle.id;
    // 編集している記録の ID（同じ種類の記録を編集しているときだけ。違えば新しく作る）
    const idOf = (type: EditTarget['type']) => (target?.type === type ? target.row.id : undefined);
    const payment = { onAccount: payableOnAccount && onAccount, enteredAmountYen: taxExcludedEntry ? fieldYen : null, exemptYen: isShaken ? exemptN : null };
    if (isOil) {
      const saved = await saveOilChange({ id: idOf('oil'), vehicleId, date, odoKm: odoKm!, oilChanged: true, filterChanged, amountYen, payment });
      return `oil:${saved.id}`;
    }
    if (isWearKind(kind)) {
      const saved = await saveWearCheck({ id: idOf('wear'), vehicleId, kind, date, odoKm, replaced, remainingMm, note: note.trim() || null });
      return `wear:${saved.id}`;
    }
    if (isOdoOnly) {
      const saved = await saveOdoReading({ id: idOf('odometer'), vehicleId, date, odoKm: odoKm! });
      return `odometer:${saved.id}`;
    }
    const saved = await saveExpense({
      id: idOf('expense'),
      vehicleId,
      category: kind,
      date,
      amountYen: amountYen!,
      odoKm,
      note: note.trim() || null,
      fuel: isFuel ? { liters: litersN, unitPrice: unitPriceN, priceBasis: unitPriceN != null ? basis : null, fuelType, fullTank } : null,
      payment,
    });
    return `expense:${saved.id}`;
  };

  const save = async () => {
    if (!valid || !(await confirmOdo())) return;
    setBusy(true);
    try {
      const recordRef = await saveRecord();
      metrics.saved(recordRef);
      await invalidate();
      allowLeave();
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
        <DateField label="日付" value={date} onChange={(v) => v && update({ date: v })} />
        <Field
          label={odoRequired ? '走行距離（ODO）' : '走行距離（ODO・任意）'}
          value={odo}
          onChangeText={(v) => {
            update({ odoText: v });
            setOdoTouched(true);
          }}
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
        {payableOnAccount && <PaymentFields onAccount={onAccount} onChange={(v) => update({ onAccount: v })} showStatementLink={isFuel && !target} />}
        {isFuel && (
          <FuelFields
            fuelType={fuelType}
            onFuelType={(v) => update({ fuelType: v })}
            liters={liters}
            onLiters={(v) => update({ liters: v })}
            litersValid={litersValid}
            unitPrice={unitPrice}
            onUnitPrice={(v) => update({ unitPrice: v })}
            unitPriceValid={unitPriceValid}
            onAccount={onAccount}
            fullTank={fullTank}
            onFullTank={(v) => update({ fullTank: v })}
          />
        )}
        {wear && (
          <WearFields
            kind={wear}
            replaced={replaced}
            onReplaced={(v) => update({ replaced: v })}
            remaining={remaining}
            onRemaining={(v) => update({ remaining: v })}
            remainingValid={remainingValid}
          />
        )}
        {!isOdoOnly && !wear && (
          <Field
            label={`${taxExcludedEntry ? '金額（税抜）' : '金額'}${isOil ? '（任意）' : ''}`}
            value={amount}
            onChangeText={(v) => {
              update({ amount: v });
              setAmountManual(v.trim() !== '');
            }}
            keyboardType="number-pad"
            suffix="円"
            hint={isFuel ? '給油量と単価を入れると、金額を自動で入れます。' : isOil ? '入力すると維持費に1件として数えます。' : undefined}
          />
        )}
        {isShaken && (
          <Field
            label="うち法定費用（任意）"
            value={exemptText}
            onChangeText={(v) => {
              update({ exempt: v });
              setExemptManual(v.trim() !== '');
            }}
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
            // 入力した数字（給油量×単価）。計算後の金額と並べて見せる
            input={`${litersText(litersN)}L × ${litersText(unitPriceN)}円/L（${onAccount ? '税抜' : '税込'}）`}
            totalYen={fuelCost.totalYen}
            business={businessOf(fuelCost.totalYen)}
            mismatch={mismatchWith(fuelCost.totalYen) != null ? { enteredYen: fieldYen!, onUseComputed: () => applyComputedAmount(String(fuelCost.totalYen)) } : null}
          />
        )}
        {carTax && (
          <ComputedAmount
            input={`${taxes.specLabel}（${fiscalYearOf(date)}年度）`}
            totalYen={carTax.amountYen}
            business={businessOf(carTax.amountYen)}
            mismatch={mismatchWith(carTax.amountYen) != null ? { enteredYen: fieldYen!, onUseComputed: () => applyComputedAmount('') } : null}
          />
        )}
        {taxes.needsSpec && (kind === 'car_tax' || kind === 'shaken') && <TaxSpecNotice kind={kind} specComplete={taxes.specComplete} specLabel={taxes.specLabel} />}
        {!fuelCost && onAccountTotal && (
          <ComputedAmount
            input={`税抜 ${yen(fieldYen!)}${exemptN ? `（うち法定費用 ${yen(exemptN)}）` : ''}`}
            totalYen={onAccountTotal.totalYen}
            business={businessOf(onAccountTotal.totalYen)}
          />
        )}
        {economy && <FuelEconomyPreview kmPerLiter={economy.kmPerLiter} distanceKm={economy.distanceKm} liters={economy.liters} unit={unit} />}
        {isOil && (
          <ToggleRow
            title="フィルターも交換した"
            description="オイルフィルターは別の周期で管理し、通知も別に出します。"
            value={filterChanged}
            onChange={(v) => update({ filterChanged: v })}
          />
        )}
        {!isOil && !isOdoOnly && <Field label="メモ（任意）" value={note} onChangeText={(v) => update({ note: v })} maxLength={200} />}
        {wear && <AppText variant="caption">費用は「整備」から記録してください。</AppText>}
        {kind === 'maintenance' && (
          <AppText variant="caption">オイル交換は「オイル交換」から記録してください（金額が二重に数えられるのを防ぐため）。</AppText>
        )}
      </Card>
      <Button title={target ? '保存する' : '記録する'} disabled={!valid} loading={busy} onPress={save} />
    </View>
  );
}
