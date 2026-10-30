import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // tsconfig の paths と同じ（src/lib の純粋な関数を試験から読むため）
    alias: { '@domain': fileURLToPath(new URL('./supabase/functions/_shared/domain', import.meta.url)) },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
