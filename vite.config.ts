import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';

export default defineConfig({
  plugins: [react(), {
    name: 'local-teaching-study',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__local-study/climate-images.sortboard.zip', async (_request, response) => {
        try {
          const data = await readFile(new URL('./output/seminar/climate-images.sortboard.zip', import.meta.url));
          response.setHeader('Content-Type', 'application/zip');
          response.setHeader('Cache-Control', 'no-store');
          response.end(data);
        } catch {
          response.statusCode = 404;
          response.end('Import the prepared study ZIP to begin.');
        }
      });
    },
  }],
  server: {
    port: 5173,
    strictPort: true,
  },
  test: {
    setupFiles: ['./src/testSetup.ts'],
    exclude: [...configDefaults.exclude, 'e2e/**'],
    // JSDOM hydration tests become CPU-bound with Vitest's machine-wide worker
    // default. Two isolated workers keep their IndexedDB state independent and
    // their 5 s interaction waits deterministic.
    minWorkers: 1,
    maxWorkers: 2,
  },
});
