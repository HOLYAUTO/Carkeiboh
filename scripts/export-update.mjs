// publish-update.sh から eas env:exec 経由で呼ぶ。EAS の環境変数を読み込んだうえで、Supabase の接続先だけをイジログの値に固定して書き出す。
// eas env:exec は Windows ではコマンドを cmd.exe で動かすため、`EXPO_PUBLIC_SUPABASE_URL=… npx …` の書き方が使えない。上書きはここで行う
import { spawnSync } from 'node:child_process';

const url = process.argv[2];
if (!url) {
  console.error('使い方: node scripts/export-update.mjs <Supabase の URL>');
  process.exit(1);
}
const result = spawnSync('npx expo export --platform all --output-dir dist', {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, EXPO_PUBLIC_SUPABASE_URL: url },
});
process.exit(result.status ?? 1);
