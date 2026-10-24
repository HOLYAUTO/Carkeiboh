import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import { AppText, Badge, Button, Card, ErrorView, Loading, Screen } from '../../components/ui';
import { logShopAction, useShops } from '../../lib/data';
import { distanceKm, formatDistance } from '../../lib/geo';
import { useCurrentPosition } from '../../lib/location';
import { callShop, openRoute, openShopWebsite } from '../../lib/maps';
import { spacing } from '../../theme';

/** 整備工場の詳細。いちばん上の「ルートを検索」から、すぐ地図アプリで道順を出せる */
export default function ShopDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const shops = useShops();
  const { position } = useCurrentPosition();
  const shop = shops.data?.find((s) => s.id === id);

  useEffect(() => {
    if (shop) logShopAction(shop.id, 'view');
  }, [shop?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (shops.isPending) return <Loading />;
  if (shops.isError) return <ErrorView message="読み込めませんでした。" onRetry={() => shops.refetch()} />;
  if (!shop) return <ErrorView message="この整備工場は現在掲載されていません。" />;

  return (
    <Screen>
      <Stack.Screen options={{ title: shop.name }} />
      <Card>
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Badge label="PR・掲載店" tone="neutral" />
          {position && <Badge label={`現在地から${formatDistance(distanceKm(position, shop))}`} />}
        </View>
        <AppText variant="heading">{shop.name}</AppText>
        <AppText selectable>{shop.address}</AppText>
        <Button title="ルートを検索" icon="navigate-outline" onPress={() => openRoute(shop)} />
        {shop.phone && <Button title={`電話する（${shop.phone}）`} variant="secondary" icon="call-outline" onPress={() => callShop(shop)} />}
      </Card>

      {(shop.business_hours || shop.description || shop.services.length > 0) && (
        <Card>
          {shop.business_hours && (
            <View style={{ gap: 2 }}>
              <AppText variant="label">営業時間</AppText>
              <AppText>{shop.business_hours}</AppText>
            </View>
          )}
          {shop.services.length > 0 && (
            <View style={{ gap: spacing.xs }}>
              <AppText variant="label">対応している作業</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
                {shop.services.map((s) => (
                  <Badge key={s} label={s} tone="neutral" />
                ))}
              </View>
            </View>
          )}
          {shop.description && <AppText>{shop.description}</AppText>}
        </Card>
      )}
      {shop.website_url && <Button title="Webサイトを開く" variant="plain" icon="open-outline" onPress={() => openShopWebsite(shop)} />}
    </Screen>
  );
}
