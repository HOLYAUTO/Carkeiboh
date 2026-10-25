import { Ionicons } from '@expo/vector-icons';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, Text, View } from 'react-native';
import {
  isDraftSufficient,
  mergeDrafts,
  parseReceiptText,
  parseSpokenRecord,
  type DraftCategory,
  type RecordDraft,
} from '@shared/record-draft.ts';
import { recognizeTextOnDevice } from '../../modules/carkeibo-ocr';
import { invokeFunction } from '../lib/supabase';
import { colors, fonts, MIN_TAP, radius, spacing } from '../theme';
import { AppText, Button, Card } from './ui';

/** 読み取りに送る写真の長辺。レシートの小さな文字が読める程度に残し、通信量を抑える */
const PHOTO_MAX_SIDE = 1600;

type SpeechModule = (typeof import('expo-speech-recognition'))['ExpoSpeechRecognitionModule'];

/** 音声認識は開発ビルドにだけ入るネイティブモジュール。Expo Go などで読み込めなければ使えないと案内する */
async function loadSpeech(): Promise<SpeechModule | null> {
  try {
    return (await import('expo-speech-recognition')).ExpoSpeechRecognitionModule;
  } catch {
    return null;
  }
}

function askOpenSettings(title: string, message: string) {
  Alert.alert(title, message, [
    { text: 'キャンセル', style: 'cancel' },
    { text: '設定を開く', onPress: () => Linking.openSettings() },
  ]);
}

/**
 * 写真・音声でかんたん入力。読み取った値は下書きとしてフォームに入れ、利用者が確かめてから保存する。
 * - 写真：レシート・メーター・整備明細を撮る（または選ぶ）と、まず端末の中で読み取る。
 *   金額・日付（メーターなら走行距離）がそろわないときだけサーバー（AI）で読み直す（画像は保存しない）
 * - 音声：端末の音声認識で文字にし、端末内で日付・金額・走行距離を読み取る
 */
export function QuickInput({ kind, today, onDraft }: { kind: DraftCategory; today: string; onDraft: (draft: RecordDraft) => void }) {
  const [reading, setReading] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const speech = useRef<SpeechModule | null>(null);
  const subscriptions = useRef<{ remove: () => void }[]>([]);

  const clearSubscriptions = () => {
    subscriptions.current.forEach((s) => s.remove());
    subscriptions.current = [];
  };

  // 画面を離れたら聞き取りを止める
  useEffect(
    () => () => {
      clearSubscriptions();
      speech.current?.abort();
    },
    [],
  );

  const readPhoto = async (source: 'camera' | 'library') => {
    if (source === 'camera') {
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (!permission.granted) {
        if (!permission.canAskAgain) askOpenSettings('カメラを使えません', '設定でカメラの使用を許可してください。');
        return;
      }
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;
    const asset = result.assets[0];

    setReading(true);
    try {
      const context = ImageManipulator.manipulate(asset.uri);
      if (Math.max(asset.width, asset.height) > PHOTO_MAX_SIDE) {
        context.resize(asset.width >= asset.height ? { width: PHOTO_MAX_SIDE } : { height: PHOTO_MAX_SIDE });
      }
      const image = await context.renderAsync();
      const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });

      // まず端末の中で読む（外部に送らない・無料）。決まった書き方のレシートやメーターはここで足りる
      const lines = await recognizeTextOnDevice(saved.uri);
      const onDevice = lines ? parseReceiptText(lines, kind, today) : {};
      if (isDraftSufficient(kind, onDevice)) {
        onDraft(onDevice);
        return;
      }

      // 足りなければサーバー（AI）で読み直す。サーバーで読めなくても、端末で読めた分は入れる
      if (!saved.base64) throw new Error('写真を読み込めませんでした。');
      try {
        const onServer = await invokeFunction<RecordDraft>('read-record-photo', { image: saved.base64, kind });
        onDraft(mergeDrafts(onDevice, onServer));
      } catch (e) {
        if (Object.keys(onDevice).length === 0) throw e;
        onDraft(onDevice);
      }
    } catch (e) {
      Alert.alert('読み取れませんでした', e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
    }
  };

  const choosePhoto = () =>
    Alert.alert('写真で入力', 'レシート・メーター・整備明細を写すと、日付・金額・走行距離を読み取ります。', [
      { text: '撮影する', onPress: () => readPhoto('camera') },
      { text: '写真を選ぶ', onPress: () => readPhoto('library') },
      { text: 'キャンセル', style: 'cancel' },
    ]);

  const startListening = async () => {
    const module = speech.current ?? (await loadSpeech());
    speech.current = module;
    if (!module || !module.isRecognitionAvailable()) {
      Alert.alert('音声入力を使えません', 'この端末では音声認識を使えません。手で入力してください。');
      return;
    }
    const permission = await module.requestPermissionsAsync();
    if (!permission.granted) {
      if (!permission.canAskAgain) askOpenSettings('マイクを使えません', '設定でマイクと音声認識の使用を許可してください。');
      return;
    }

    let finalText = '';
    clearSubscriptions();
    subscriptions.current = [
      module.addListener('result', (e) => {
        const text = e.results[0]?.transcript ?? '';
        setTranscript(text);
        if (e.isFinal) finalText = text;
      }),
      module.addListener('error', (e) => {
        if (e.error === 'aborted') return;
        Alert.alert(
          '聞き取れませんでした',
          e.error === 'no-speech' || e.error === 'speech-timeout' ? 'もう一度、マイクに向かって話してください。' : e.message,
        );
      }),
      module.addListener('end', () => {
        setListening(false);
        clearSubscriptions();
        if (finalText.trim()) onDraft(parseSpokenRecord(finalText, today));
      }),
    ];
    setTranscript('');
    setListening(true);
    module.start({
      lang: 'ja-JP',
      interimResults: true,
      continuous: false,
      addsPunctuation: false,
      contextualStrings: ['ガソリン', '給油', 'オイル交換', 'フィルター', '走行距離', 'キロ', '円', '車検', '高速', '駐車場'],
    });
  };

  if (listening) {
    return (
      <Card style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
          <ActivityIndicator color={colors.accent} />
          <AppText variant="heading">聞き取り中…</AppText>
        </View>
        <AppText style={{ minHeight: 44 }}>{transcript || '例：「昨日ガソリン満タンで4500円、走行距離41200キロ」'}</AppText>
        <Button title="話し終わった" variant="secondary" icon="stop-circle-outline" onPress={() => speech.current?.stop()} />
      </Card>
    );
  }

  return (
    <View style={{ flexDirection: 'row', gap: spacing.sm }}>
      <QuickButton icon="camera-outline" label={reading ? '読み取り中…' : '写真で入力'} busy={reading} onPress={choosePhoto} />
      <QuickButton icon="mic-outline" label="音声で入力" busy={false} disabled={reading} onPress={startListening} />
    </View>
  );
}

function QuickButton({
  icon,
  label,
  busy,
  disabled,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  busy: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy || disabled, busy }}
      disabled={busy || disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: MIN_TAP + 8,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: spacing.sm,
        borderRadius: radius.control,
        backgroundColor: colors.accentSoft,
        opacity: pressed || disabled ? 0.6 : 1,
      })}
    >
      {busy ? <ActivityIndicator color={colors.accent} /> : <Ionicons name={icon} size={20} color={colors.accentText} />}
      <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.accentText }}>{label}</Text>
    </Pressable>
  );
}
