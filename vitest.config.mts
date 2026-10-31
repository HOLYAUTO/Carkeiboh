import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // tsconfig の paths と同じ（src/lib の純粋な関数を試験から読むため）
    alias: { '@domain': fileURLToPath(new URL('./supabase/functions/_shared/domain', import.meta.url)) },
  },
  test: {
    // Edge Functions 側の試験は supabase/functions/ に置く（Deno の import を含むので、アプリの tsc の対象外）
    include: ['tests/**/*.test.ts', 'supabase/functions/_shared/__tests__/*.test.ts'],
  },
});
