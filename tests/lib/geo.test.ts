import { describe, expect, it } from 'vitest';
import { distanceKm, formatDistance, routeUrl, sortByDistance, telUrl } from '../../src/lib/geo';

const tokyo = { latitude: 35.681236, longitude: 139.767125 };
const osaka = { latitude: 34.702485, longitude: 135.495951 };

describe('距離', () => {
  it('東京駅〜大阪駅は直線で約400km', () => {
    expect(distanceKm(tokyo, osaka)).toBeGreaterThan(395);
    expect(distanceKm(tokyo, osaka)).toBeLessThan(410);
  });

  it('同じ地点は0', () => {
    expect(distanceKm(tokyo, tokyo)).toBe(0);
  });

  it.each([
    [0.02, '約 100m'],
    [0.849, '約 850m'],
    [3.24, '約 3.2km'],
    [24.6, '約 25km'],
    [1234.4, '約 1,234km'],
  ])('%f km → %s', (km, text) => {
    expect(formatDistance(km)).toBe(text);
  });
});

describe('並べ替え', () => {
  const shops = [
    { name: 'い', latitude: 34.70, longitude: 135.49, display_priority: 0 },
    { name: 'ろ', latitude: 35.68, longitude: 139.76, display_priority: 0 },
    { name: 'は', latitude: 35.6805, longitude: 139.767, display_priority: 10 },
  ];

  it('近い順。ほぼ同じ距離なら優先度の高い方が先', () => {
    expect(sortByDistance(shops, tokyo).map((s) => s.name)).toEqual(['は', 'ろ', 'い']);
  });

  it('現在地がなければ優先度 → 名前の順で、距離は null', () => {
    const sorted = sortByDistance(shops, null);
    expect(sorted.map((s) => s.name)).toEqual(['は', 'い', 'ろ']);
    expect(sorted.every((s) => s.distanceKm === null)).toBe(true);
  });
});

describe('地図・電話の URL', () => {
  it('Apple マップは車のルート', () => {
    expect(routeUrl('apple', tokyo, 'たにぐち自動車')).toBe(
      'https://maps.apple.com/?daddr=35.681236,139.767125&q=%E3%81%9F%E3%81%AB%E3%81%90%E3%81%A1%E8%87%AA%E5%8B%95%E8%BB%8A&dirflg=d',
    );
  });

  it('Google マップは車のルート', () => {
    expect(routeUrl('google', tokyo, 'x')).toBe('https://www.google.com/maps/dir/?api=1&destination=35.681236,139.767125&travelmode=driving');
  });

  it('電話番号の記号を取り除く', () => {
    expect(telUrl('03-1234-5678')).toBe('tel:0312345678');
  });
});
