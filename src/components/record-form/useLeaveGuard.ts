import { useNavigation, usePreventRemove } from 'expo-router';
import { useLayoutEffect, useRef } from 'react';
import { Alert } from 'react-native';

/**
 * 入力途中（dirty）で戻ろうとしたら確かめる。保存したあとは allowLeave() を呼んで確かめずに戻す
 */
export function useLeaveGuard(dirty: boolean) {
  const navigation = useNavigation();
  const allowed = useRef(false);
  // 止めた移動をやり直すときは、必ず `repeat()` を使う（止めるのを解いてから移動する）。
  // `navigation.dispatch(data.action)` でやり直すと、まだ止めているためまた止められ、この関数が呼ばれ続けて
  // アプリが固まる（2026-11-07 報告：保存して「OK」を押すと画面が変わらず、ボタンが何も効かなくなった）
  usePreventRemove(dirty, ({ repeat }) => {
    if (allowed.current) {
      repeat();
      return;
    }
    Alert.alert('入力中の内容を破棄しますか', '戻ると、この画面で入力した内容は保存されません。', [
      { text: '入力を続ける', style: 'cancel' },
      { text: '破棄して戻る', style: 'destructive', onPress: repeat },
    ]);
  });
  // 左上の「戻る」は、iOS でも JS で戻すボタンにしてあり（src/app/_layout.tsx）、押すと上の確認が必ず出る。
  // 横スワイプで戻る操作は確認を出せないことがあるため、入力中は止める（入力していなければスワイプで戻れる）
  useLayoutEffect(() => {
    navigation.setOptions({ gestureEnabled: !dirty });
  }, [navigation, dirty]);
  return {
    allowLeave: () => {
      allowed.current = true;
    },
  };
}
