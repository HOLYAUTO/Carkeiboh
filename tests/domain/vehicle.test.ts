import { describe, expect, it } from 'vitest';
import { DEFAULT_REMINDER_SETTINGS } from '../../supabase/functions/_shared/domain/reminders.ts';
import { buildVehicleState, vehicleNotifications, type VehicleData } from '../../supabase/functions/_shared/domain/vehicle.ts';

const base: VehicleData = {
  name: 'N-BOX',
  annualKmEstimate: 7300,
  oilInterval: { km: 5000, months: 6 },
  filterInterval: { km: 10000, months: 12 },
  settings: { ...DEFAULT_REMINDER_SETTINGS },
  oilChanges: [
    { id: 'oc1', date: '2026-04-01', odoKm: 30000, oilChanged: true, filterChanged: true },
    { id: 'oc2', date: '2026-07-01', odoKm: 34000, oilChanged: true, filterChanged: false },
  ],
  otherReadings: [{ date: '2026-10-01', odoKm: 37000 }],
  meterReplacements: [],
  deadlines: [{ id: 's1', kind: 'shaken', dueOn: '2027-01-20' }],
};

describe('車両1台分の状態', () => {
  it('オイルは最新の交換、フィルターは最後にフィルターを替えた交換から予測する', () => {
    const s = buildVehicleState(base, '2026-10-23');
    expect(s.oil?.baselineId).toBe('oc2');
    expect(s.filter?.baselineId).toBe('oc1');
    // 4/1→10/1 の 183日で 7,000km の実績ペース
    expect(s.oil?.forecast.paceBasis).toBe('actual');
    expect(s.oil?.forecast.dueOdoKm).toBe(39000);
    expect(s.filter?.forecast.dueOdoKm).toBe(40000);
    expect(s.upcoming.map((u) => u.kind)).toContain('shaken');
  });

  it('記録がなければ予測しない', () => {
    const s = buildVehicleState({ ...base, oilChanges: [] }, '2026-10-23');
    expect(s.oil).toBeNull();
    expect(s.filter).toBeNull();
  });

  it('メーター交換後も実走行距離で予測する', () => {
    const s = buildVehicleState(
      {
        ...base,
        otherReadings: [{ date: '2026-10-01', odoKm: 1000 }],
        meterReplacements: [{ replacedOn: '2026-09-01', odoBeforeKm: 36000, odoAfterKm: 0 }],
      },
      '2026-10-01',
    );
    expect(s.readings.at(-1)?.odoKm).toBe(37000);
    expect(s.oil?.forecast.estimatedOdoKm).toBe(37000);
  });

  it('通知の一覧を車名付きで返す', () => {
    const n = vehicleNotifications(base, '2026-10-20', new Set());
    expect(n.find((x) => x.kind === 'shaken')?.title).toBe('N-BOX：車検満了まであと92日');
  });
});
