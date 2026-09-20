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
      // RolePlaymate / KVGenius embed this UI in an iframe / WebView.
      'Content-Security-Policy': "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*",
    },
  },
});
