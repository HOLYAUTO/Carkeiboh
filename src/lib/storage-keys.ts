/** 端末（AsyncStorage）に覚えておく値のキー。同じキーを別々の場所で書かないよう、ここだけで決める */
export const STORAGE_KEYS = {
  theme: 'ijilog.theme',
  selectedVehicleId: 'ijilog.selectedVehicleId',
  /** 給油を記録した時刻。立ち寄りのあいだに記録していたら通知しない */
  lastFuelSavedAt: 'ijilog.lastFuelSavedAt',
  fuelDetectMode: 'ijilog.fuelDetectMode',
  fuelPromptDismissed: 'ijilog.fuelPromptDismissed',
  fuelVisitNotified: 'ijilog.fuelVisit.notified',
  /** 後ろに区画のキーを付ける */
  fuelStationsTilePrefix: 'ijilog.fuelStations.',
  /** 後ろにスタンドの ID を付ける */
  fuelVisitEnterPrefix: 'ijilog.fuelVisit.enter.',
} as const;
