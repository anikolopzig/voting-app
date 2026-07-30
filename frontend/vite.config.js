import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // In dev, forward the client's same-origin /api/suggest call to the local
  // Functions emulator, so the client code has no dev/prod branch. In prod the
  // Firebase Hosting rewrite in firebase.json does the same mapping.
  // Run both: `firebase emulators:start --only functions` + `npm run dev`.
  server: {
    proxy: {
      '/api/suggest': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        rewrite: () => '/groupvote-12796/us-central1/suggestOptions',
      },
    },
  },
});
