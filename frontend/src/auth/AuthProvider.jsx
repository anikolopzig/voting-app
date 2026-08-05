// Auth context for the AI-suggestions feature ONLY. Voting stays account-free —
// this never touches utils/storage.js (the per-room name identity) or roles.js.
// It exposes the current Firebase user plus the handful of actions AuthForm needs.
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
} from 'firebase/auth';
import { auth } from '../firebase.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  // `authReady` flips true after the first onAuthStateChanged so callers can tell
  // "signed out" from "still resolving". We read auth.currentUser fresh on each
  // render and use `tick` to force re-renders — that way an in-place emailVerified
  // change (after reload) propagates, which a cached user object reference wouldn't.
  const [authReady, setAuthReady] = useState(false);
  const [, setTick] = useState(0);
  const bump = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, () => {
      setAuthReady(true);
      bump();
    });
    return unsubscribe;
  }, [bump]);

  // Re-fetch the user's verification state (Firebase caches emailVerified until a
  // reload) and force a fresh ID token so its email_verified claim — which the
  // Cloud Function checks — reflects the new state on the next getIdToken().
  const refreshUser = useCallback(async () => {
    if (!auth.currentUser) return;
    await auth.currentUser.reload();
    await auth.currentUser.getIdToken(true);
    bump();
  }, [bump]);

  const value = {
    user: auth.currentUser,
    authReady,
    signIn: (email, password) => signInWithEmailAndPassword(auth, email, password),
    signUp: async (email, password) => {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await sendEmailVerification(cred.user);
      return cred;
    },
    signOutUser: () => signOut(auth),
    sendVerification: () =>
      auth.currentUser ? sendEmailVerification(auth.currentUser) : Promise.resolve(),
    refreshUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
