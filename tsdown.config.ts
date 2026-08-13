import { defineConfig } from 'tsdown';

export default defineConfig({
  clean: true,
  cwd: 'packages/core',
  dts: true,
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  logLevel: 'error',
  outDir: 'dist',
  sourcemap: true,
});
