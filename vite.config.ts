import dns from 'node:dns';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { sheetsApiPlugin } from './server/plugin';

dns.setDefaultResultOrder('ipv4first');

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), sheetsApiPlugin()],
  server: {
    host: true,
    port: 5173,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  worker: {
    format: 'es',
  },
});
