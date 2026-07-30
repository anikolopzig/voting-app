// Firebase initialization — modular v9+ SDK.
// Config is read from Vite env vars (see .env.example). These values are
// client-visible by design; access is controlled by Realtime Database rules.
import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Fail loudly during development if the env file was never filled in — this is
// the #1 setup mistake and the resulting Firebase errors are cryptic.
if (!firebaseConfig.databaseURL) {
  // eslint-disable-next-line no-console
  console.error(
    '[GroupVote] Missing Firebase config. Copy .env.example to .env and fill in ' +
      'your project values, then restart the dev server.'
  );
}

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
