import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Lets a tunnel (cloudflared / ngrok) reach the dev server when testing inside Telegram.
    allowedHosts: true,
    proxy: { '/api': 'http://localhost:3000' },
  },
});
