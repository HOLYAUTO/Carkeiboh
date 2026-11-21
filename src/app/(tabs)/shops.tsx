import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, RefreshControl, View } from 'react-native';
import { SponsorSlot } from '../../components/SponsorSlot';
import { AppText, Badge, Button, Card, EmptyState, IconButton, QueryFallback, Screen, ScreenHeader, Skeleton } from '../../components/ui';
import { useShops, type ShopRow } from '../../lib/data';
import { formatDistance, sortByDistance } from '../../lib/geo';
import { useCurrentPosition } from '../../lib/location';
import { callShop, openRoute } from '../../lib/maps';
import { spacing, useColors } from '../../theme';

const header = (
  <ScreenHeader
    tag="PIT"
    overline="近くの掲載店"
    title="整備工場"
    right={<IconButton icon="settings-outline" label="設定" onPress={() => router.push('/settings')} />}
  />
);

/** 近くの整備工場（掲載店）。選ぶと地図アプリでルート検索、または電話できる */
export default function Shops() {
  const colors = useColors();
  const shops = useShops();
  const location = useCurrentPosition();
  const sorted = useMemo(() => sortByDistance(shops.data ?? [], location.position), [shops.data, location.position]);

  if (shops.isPending) {
    return (
      <Screen header={header}>
        <Skeleton height={140} />
        <Skeleton height={140} />
      </Screen>
    );
  }
  if (!shops.isSuccess) return <QueryFallback queries={[shops]} />;

  return (
    <Screen header={header} refreshControl={<RefreshControl refreshing={shops.isRefetching} onRefresh={() => void shops.refetch()} tintColor={colors.textSecondary} />}>
      {/* 掲載料をいただいている店舗であることを明示する（広告であることが分かるように） */}
      <AppText variant="caption">【PR】イジログに掲載している整備工場です。距離は現在地からの直線距離です。</AppText>
      {(location.state.status === 'denied' || location.state.status === 'unavailable') && (
        <Card>
          <AppText variant="caption">
            {location.state.status === 'denied'
              ? '現在地の使用が許可されていないため、近い順に並べられません。現在地はこの並べ替えにだけ使い、送信しません。'
              : '現在地を取得できませんでした。'}
          </AppText>
          <Button title="現在地を使う" variant="secondary" icon="locate-outline" onPress={location.request} />
        </Card>
      )}
      {sorted.length === 0 ? (
        <Card>
          <EmptyState icon="construct-outline" title="掲載中の整備工場はまだありません" description="掲載が始まると、ここに近い順で表示します。" />
        </Card>
      ) : (
        sorted.map((shop) => <ShopCard key={shop.id} shop={shop} distanceKm={shop.distanceKm} />)
      )}

      <SponsorSlot placement="shops" />
    </Screen>
  );
}

function ShopCard({ shop, distanceKm }: { shop: ShopRow; distanceKm: number | null }) {
  const colors = useColors();
  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${shop.name}の詳細`}
        onPress={() => router.push({ pathname: '/shops/[id]', params: { id: shop.id } })}
        style={({ pressed }) => ({ gap: spacing.xs, opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <AppText variant="heading" style={{ flex: 1 }}>
            {shop.name}
          </AppText>
          {distanceKm != null && <Badge label={formatDistance(distanceKm)} />}
          <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
        </View>
        <AppText variant="caption">{shop.address}</AppText>
        {shop.services.length > 0 && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs }}>
            {shop.services.map((s) => (
              <Badge key={s} label={s} tone="neutral" />
            ))}
          </View>
        )}
      </Pressable>
      <View style={{ flexDirection: 'row', gap: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <Button title="ルート検索" icon="navigate-outline" onPress={() => openRoute(shop)} />
        </View>
        {shop.phone && (
          <View style={{ flex: 1 }}>
            <Button title="電話する" variant="secondary" icon="call-outline" onPress={() => callShop(shop)} />
          </View>
        )}
      </View>
    </Card>
  );
}
