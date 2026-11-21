import { Alert } from 'react-native';

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 失敗を知らせる。title は「保存できませんでした」など、何ができなかったか */
export function alertError(title: string, e: unknown) {
  Alert.alert(title, errorMessage(e));
}

/** 確かめてから進む。ok を押したら true、cancel を押したら false */
export function askToConfirm(title: string, message: string, buttons: { cancel: string; ok: string }): Promise<boolean> {
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: buttons.cancel, style: 'cancel', onPress: () => resolve(false) },
      { text: buttons.ok, onPress: () => resolve(true) },
    ]),
  );
}

/**
 * 元に戻せない操作（削除・解除など）の前に確かめる。
 * 押されたら action を実行し、失敗したら errorTitle で知らせる。setBusy を渡すと実行中は true にする
 */
export function confirmDestructive({
  title,
  message,
  confirmText,
  errorTitle,
  action,
  setBusy,
}: {
  title: string;
  message: string;
  confirmText: string;
  errorTitle: string;
  action: () => Promise<void>;
  setBusy?: (busy: boolean) => void;
}) {
  Alert.alert(title, message, [
    { text: 'キャンセル', style: 'cancel' },
    {
      text: confirmText,
      style: 'destructive',
      onPress: async () => {
        setBusy?.(true);
        try {
          await action();
        } catch (e) {
          alertError(errorTitle, e);
        } finally {
          setBusy?.(false);
        }
      },
    },
  ]);
}
