// Firebase initialization — modular v9+ SDK.
// Config is read from Vite env vars (see .env.example). These values are
// client-visible by design; access is controlled by Realtime Database rules.
import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getAuth, connectAuthEmulator } from 'firebase/auth';

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

// The Realtime Database app. Voting is ACCOUNT-FREE, so this app is NEVER signed
// in and its DB writes are always anonymous (matching the world-open test-mode
// rules). Keeping Auth off this app is load-bearing: if a signed-in user's token
// rode along on DB requests, the real (non-emulated) production RTDB would reject
// a dev Auth-emulator token as "credentials invalid" and every write would fail.
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);

// Firebase Auth — used ONLY to gate the AI-suggestions feature (voting stays
// account-free; see utils/storage.js). It lives on a SEPARATE Firebase app
// instance ('auth') so signing in here can never attach a token to `db` above.
// Email/password needs no new env vars — `authDomain` + `apiKey` are enough.
const authApp = initializeApp(firebaseConfig, 'auth');
export const auth = getAuth(authApp);

// In local dev, point Auth at the emulator so sign-up/sign-in never touch the
// real project (matches the functions emulator the Vite proxy already targets).
// The functions emulator must set FIREBASE_AUTH_EMULATOR_HOST so its token
// verification trusts these emulator-issued tokens — see firebase.json + RUNBOOK.
if (import.meta.env.DEV) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}
