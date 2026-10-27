/**
 * ML Kit が端末に取得しておくモデルの指定（com.google.mlkit.vision.DEPENDENCIES）は、AndroidManifest に1つしか書けない。
 * expo-camera も同じ項目に barcode_ui を書いているため、このモジュールのライブラリ側で書くと Android のビルドが衝突して失敗する。
 * アプリ側で2つをまとめて書き、ライブラリの値を置き換える（tools:replace）
 */
const { AndroidConfig, withAndroidManifest } = require('expo/config-plugins');

const MLKIT_DEPENDENCIES = 'com.google.mlkit.vision.DEPENDENCIES';
// ocr_japanese：日本語の文字認識（このモジュール）、barcode_ui：QRコードの読み取り（expo-camera）
const MLKIT_MODELS = 'ocr_japanese,barcode_ui';

module.exports = function withCarkeiboOcr(config) {
  return withAndroidManifest(config, (c) => {
    const manifest = AndroidConfig.Manifest.ensureToolsAvailable(c.modResults);
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    AndroidConfig.Manifest.addMetaDataItemToMainApplication(app, MLKIT_DEPENDENCIES, MLKIT_MODELS);
    const item = app['meta-data'].find((m) => m.$['android:name'] === MLKIT_DEPENDENCIES);
    item.$['tools:replace'] = 'android:value';
    return c;
  });
};
