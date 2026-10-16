import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { appVersion } from '../scripts/version.mjs';

export default defineConfig({
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  server: {
    port: 5173,
    // Lets a tunnel (cloudflared / ngrok) reach the dev server when testing inside Telegram.
    allowedHosts: true,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
