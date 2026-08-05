import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // In dev, forward the client's same-origin /api/* calls to the local Functions
  // emulator, so the client code has no dev/prod branch. In prod the Firebase
  // Hosting rewrites in firebase.json do the same mapping.
  // Run both: `firebase emulators:start --only auth,functions` + `npm run dev`.
  //
  // One entry PER endpoint: each `rewrite` returns a constant path, so a single
  // '/api' key would funnel every route into the same function. Keep these in
  // step with the rewrites in firebase.json.
  server: {
    proxy: {
      '/api/suggest': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        rewrite: () => '/groupvote-12796/us-central1/suggestOptions',
      },
      '/api/expand': {
        target: 'http://127.0.0.1:5001',
        changeOrigin: true,
        rewrite: () => '/groupvote-12796/us-central1/expandOptions',
      },
    },
  },
});
