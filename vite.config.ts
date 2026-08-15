import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // JSDOM hydration tests become CPU-bound with Vitest's machine-wide worker
    // default. Two isolated workers keep their IndexedDB state independent and
    // their 5 s interaction waits deterministic.
    minWorkers: 1,
    maxWorkers: 2,
  },
});
