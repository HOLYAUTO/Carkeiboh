import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { removeVehiclePhoto, saveVehiclePhoto, useInvalidate, useVehiclePhotoUrl, type VehicleRow } from '../lib/data';
import { cardShadow, fonts, radius, spacing, themedStyles, useColors } from '../theme';
import { alertError, confirmDestructive } from '../lib/alerts';

/** 保存する写真の長辺。ホームの横幅いっぱいに出してもきれいに見え、通信量を抑えられる大きさ */
const PHOTO_MAX_SIDE = 1600;
const ASPECT = 16 / 9;

/**
 * ホームの一番上の愛車の写真。押すと撮影・写真の選択・削除ができる。
 * 写真がなければ、追加をうながす枠を出す
 */
export function VehiclePhoto({ vehicle }: { vehicle: VehicleRow }) {
  const colors = useColors();
  const styles = useStyles();
  const invalidate = useInvalidate();
  const url = useVehiclePhotoUrl(vehicle.photo_path);
  const [busy, setBusy] = useState(false);

  const pick = async (source: 'camera' | 'library') => {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        if (!permission.canAskAgain) {
          Alert.alert('カメラを使えません', '設定でカメラの使用を許可してください。', [
            { text: 'キャンセル', style: 'cancel' },
            { text: '設定を開く', onPress: () => Linking.openSettings() },
          ]);
        }
        return;
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;
    const asset = result.assets[0];

    setBusy(true);
    try {
      const context = ImageManipulator.manipulate(asset.uri);
      if (Math.max(asset.width, asset.height) > PHOTO_MAX_SIDE) {
        context.resize(asset.width >= asset.height ? { width: PHOTO_MAX_SIDE } : { height: PHOTO_MAX_SIDE });
      }
      const image = await context.renderAsync();
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
      if (!saved.base64) throw new Error('写真を読み込めませんでした。');
      await saveVehiclePhoto(vehicle, saved.base64);
      await invalidate();
    } catch (e) {
      alertError('写真を保存できませんでした', e);
    } finally {
      setBusy(false);
    }
  };

  const remove = () =>
    confirmDestructive({
      title: '写真を外しますか',
      message: 'ホームに表示している愛車の写真を削除します。',
      confirmText: '外す',
      errorTitle: '写真を外せませんでした',
      setBusy,
      action: async () => {
        await removeVehiclePhoto(vehicle);
        await invalidate();
      },
    });

  const openMenu = () =>
    Alert.alert(vehicle.photo_path ? '愛車の写真を変える' : '愛車の写真を追加', undefined, [
      { text: '撮影する', onPress: () => pick('camera') },
      { text: '写真を選ぶ', onPress: () => pick('library') },
      ...(vehicle.photo_path ? [{ text: '写真を外す', style: 'destructive' as const, onPress: remove }] : []),
      { text: 'キャンセル', style: 'cancel' as const },
    ]);

  if (!vehicle.photo_path) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${vehicle.name}の写真を追加する`}
        onPress={openMenu}
        disabled={busy}
        style={({ pressed }) => [styles.frame, styles.empty, pressed && { opacity: 0.6 }]}
      >
        {busy ? (
          <ActivityIndicator color={colors.accent} />
        ) : (
          <>
            <View style={styles.emptyIcon}>
              <Ionicons name="car-sport-outline" size={28} color={colors.accentText} />
            </View>
            <Text style={styles.emptyTitle}>愛車の写真を追加</Text>
            <Text style={styles.emptyCaption}>撮影するか、撮っておいた写真から選べます</Text>
          </>
        )}
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${vehicle.name}の写真。押すと写真を変えられます`}
      onPress={openMenu}
      disabled={busy}
      style={({ pressed }) => [styles.frame, cardShadow, pressed && { opacity: 0.85 }]}
    >
      <Image
        source={url.data ? { uri: url.data, cacheKey: vehicle.photo_path } : undefined}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={200}
        accessible={false}
      />
      {(busy || url.isPending) && (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <ActivityIndicator color={colors.white} />
        </View>
      )}
      <View style={styles.badge} pointerEvents="none">
        <Ionicons name="camera-outline" size={16} color={colors.white} />
        <Text style={styles.badgeText}>写真を変える</Text>
      </View>
    </Pressable>
  );
}

const useStyles = themedStyles((colors) =>
  StyleSheet.create({
    frame: {
      width: '100%',
      aspectRatio: ASPECT,
      borderRadius: radius.card,
      overflow: 'hidden',
      backgroundColor: colors.surfaceVariant,
    },
    empty: {
      backgroundColor: colors.card,
      borderWidth: 1.5,
      borderStyle: 'dashed',
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      padding: spacing.lg,
    },
    emptyIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.xs,
    },
    emptyTitle: { fontFamily: fonts.semibold, fontSize: 15, color: colors.text },
    emptyCaption: { fontFamily: fonts.regular, fontSize: 12, color: colors.textSecondary, textAlign: 'center' },
    center: { alignItems: 'center', justifyContent: 'center' },
    badge: {
      position: 'absolute',
      right: spacing.sm,
      bottom: spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: 'rgba(29,29,31,0.55)',
    },
    badgeText: { fontFamily: fonts.medium, fontSize: 12, color: colors.white },
  }),
);
