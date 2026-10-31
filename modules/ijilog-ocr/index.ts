import { requireOptionalNativeModule } from 'expo';

/**
 * 端末の中で写真の文字を読む（外部に送らない）。
 * iOS は Apple Vision、Android は ML Kit（日本語）。上から順に1行ずつ返す
 */
interface IjilogOcrNative {
  recognizeAsync(uri: string): Promise<string[]>;
}

// 開発ビルドにだけ入るネイティブモジュール。Expo Go などでは null になり、呼び出し側でサーバーの読み取りに回す
const native = requireOptionalNativeModule<IjilogOcrNative>('IjilogOcr');

export const isOnDeviceOcrAvailable = native != null;

/** 読み取った行。モジュールがない・読み取りに失敗したときは null */
export async function recognizeTextOnDevice(uri: string): Promise<string[] | null> {
  if (!native) return null;
  try {
    return await native.recognizeAsync(uri);
  } catch (e) {
    console.warn('端末での文字の読み取りに失敗しました', e);
    return null;
  }
}
