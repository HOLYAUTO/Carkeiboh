import * as AppleAuthentication from 'expo-apple-authentication';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { AppText, Button, Card, Field, Screen } from '../components/ui';
import { APP_OWNER } from '../lib/config';
import { sendEmailCode, signInWithApple, signInWithGoogle, verifyEmailCode } from '../lib/auth';
import { radius, spacing, useColors } from '../theme';
import { alertError } from '../lib/alerts';

export default function Login() {
  const colors = useColors();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      alertError('ログインできませんでした', e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <View style={{ marginTop: 72, marginBottom: spacing.xl, gap: spacing.sm }}>
          <AppText variant="title" style={{ fontSize: 28, lineHeight: 36 }}>イジログ</AppText>
          <AppText style={{ color: colors.textSecondary }}>
            次のオイル交換まであと何km、今年クルマにいくらかかったか。開いた瞬間に分かる、クルマの家計簿です。
          </AppText>
        </View>

        <Card>
          {Platform.OS === 'ios' ? (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={radius.control}
              style={{ height: 48 }}
              onPress={() => run('apple', signInWithApple)}
            />
          ) : (
            <Button title="Appleでサインイン" variant="secondary" icon="logo-apple" loading={busy === 'apple'} onPress={() => run('apple', signInWithApple)} />
          )}
          <Button title="Googleでログイン" variant="secondary" icon="logo-google" loading={busy === 'google'} onPress={() => run('google', signInWithGoogle)} />
        </Card>

        <Card>
          <AppText variant="heading">メールでログイン</AppText>
          {!codeSent ? (
            <>
              <Field
                label="メールアドレス"
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                placeholder="you@example.com"
              />
              <Button
                title="確認コードを送る"
                disabled={!/^\S+@\S+\.\S+$/.test(email.trim())}
                loading={busy === 'send'}
                onPress={() => run('send', async () => {
                  await sendEmailCode(email.trim());
                  setCodeSent(true);
                })}
              />
            </>
          ) : (
            <>
              <AppText variant="caption">{email.trim()} に届いた6桁の確認コードを入力してください。</AppText>
              <Field
                label="確認コード"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                maxLength={6}
              />
              <Button
                title="ログイン"
                disabled={!/^\d{6}$/.test(code)}
                loading={busy === 'verify'}
                onPress={() => run('verify', () => verifyEmailCode(email.trim(), code))}
              />
              <Button title="メールアドレスを変える" variant="plain" onPress={() => { setCodeSent(false); setCode(''); }} />
            </>
          )}
        </Card>

        <AppText variant="caption" style={{ textAlign: 'center', marginTop: spacing.md }}>
          イジログは{APP_OWNER}のアプリです。
        </AppText>
      </Screen>
    </KeyboardAvoidingView>
  );
}
