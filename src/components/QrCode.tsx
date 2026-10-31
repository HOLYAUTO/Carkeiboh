import { create } from 'qrcode';
import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

/** 読み取りに必要な周りの余白（モジュール4つ分） */
const QUIET_ZONE = 4;

/**
 * QRコード。カメラで確実に読めるよう、画面の色に関係なく白地に黒で描く。
 * 黒いマスは1本のパスにまとめて描く（マスごとに部品を作ると重いため）
 */
export function QrCode({ value, size, label }: { value: string; size: number; label: string }) {
  const { path, count } = useMemo(() => {
    const { modules } = create(value, { errorCorrectionLevel: 'M' });
    let d = '';
    for (let y = 0; y < modules.size; y++) {
      for (let x = 0; x < modules.size; x++) {
        if (modules.get(y, x)) d += `M${x + QUIET_ZONE} ${y + QUIET_ZONE}h1v1h-1z`;
      }
    }
    return { path: d, count: modules.size + QUIET_ZONE * 2 };
  }, [value]);

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${count} ${count}`} accessibilityRole="image" accessibilityLabel={label}>
      <Rect width={count} height={count} fill="#ffffff" />
      <Path d={path} fill="#000000" />
    </Svg>
  );
}
