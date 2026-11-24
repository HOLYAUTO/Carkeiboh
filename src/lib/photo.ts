/**
 * 写真を撮る・アルバムから選んで、縮めた JPEG の base64 にする（読み取り用。写真は保存しない）。
 */
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Alert, Linking } from 'react-native';
import { withCode } from './error-codes';

export interface PickedPhoto {
  uri: string;
  base64: string;
}

/** source が camera なら1枚、library なら multiple のとき複数（最大 limit 枚） */
export async function pickPhotos(source: 'camera' | 'library', opts: { maxSide: number; multiple?: boolean; limit?: number }): Promise<PickedPhoto[]> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      if (!permission.canAskAgain)
        Alert.alert('カメラを使えません', withCode('設定でカメラの使用を許可してください。', 'IJ-PERM-001'), [
          { text: 'キャンセル', style: 'cancel' },
          { text: '設定を開く', onPress: () => Linking.openSettings() },
        ]);
      return [];
    }
  }
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    quality: 1,
    ...(source === 'library' && opts.multiple ? { allowsMultipleSelection: true, selectionLimit: opts.limit ?? 10 } : {}),
  };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled) return [];
  const out: PickedPhoto[] = [];
  for (const asset of result.assets.slice(0, opts.limit ?? 10)) {
    const context = ImageManipulator.manipulate(asset.uri);
    if (Math.max(asset.width, asset.height) > opts.maxSide) {
      context.resize(asset.width >= asset.height ? { width: opts.maxSide } : { height: opts.maxSide });
    }
    const image = await context.renderAsync();
    const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.75, base64: true });
    if (saved.base64) out.push({ uri: saved.uri, base64: saved.base64 });
  }
  return out;
}
