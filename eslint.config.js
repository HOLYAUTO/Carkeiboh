// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Edge Functions（Deno）は deno check で検査する（npm run check:functions）
    ignores: ['dist/*', '.expo/*', 'supabase/functions/**'],
  },
]);
