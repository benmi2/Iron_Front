import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5330, strictPort: false },
  build: { target: 'es2022', chunkSizeWarningLimit: 3000 },
});
