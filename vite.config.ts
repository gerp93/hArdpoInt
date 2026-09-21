import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/renderer',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src/renderer'),
      '@shared': path.resolve(__dirname, './src/shared'),
    },
  },
  server: {
    port: 5174,
    headers: {
      // Host apps may be file:// (packaged Electron) or localhost Vite — allow both.
      'Content-Security-Policy': "frame-ancestors *",
    },
  },
});
