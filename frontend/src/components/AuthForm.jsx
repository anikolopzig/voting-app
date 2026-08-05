import { useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { auth } from '../firebase.js';
import { REQUIRE_EMAIL_VERIFICATION } from '../utils/flags.js';

// Inline sign-in / sign-up card shown IN PLACE OF the AI-suggestions panel when
// the viewer isn't signed in (or isn't verified). Signing in is the action, so we
// show the affordance rather than hiding it (CLAUDE.md: don't render dead
// controls — but DO offer the one that unlocks the feature). Once the user is
// signed-in-and-verified, the parent swaps this out for <SuggestOptions/>.
// Voting never routes through here.

// Map Firebase's auth/* error codes to friendly copy; fall back to the raw message.
const AUTH_MESSAGES = {
  'auth/invalid-email': 'That email address looks invalid.',
  'auth/missing-password': 'Please enter a password.',
  'auth/weak-password': 'Password should be at least 6 characters.',
  'auth/email-already-in-use': 'An account with that email already exists — try signing in.',
  'auth/invalid-credential': 'Wrong email or password.',
  'auth/wrong-password': 'Wrong email or password.',
  'auth/user-not-found': 'Wrong email or password.',
  'auth/too-many-requests': 'Too many attempts — wait a moment and try again.',
  'auth/network-request-failed': 'Network error — check your connection and retry.',
};
function messageFor(err) {
  return AUTH_MESSAGES[err?.code] || err?.message || 'Something went wrong. Please try again.';
}

// DEV ONLY: the Auth emulator never sends real email — it just logs the
// verification link. This applies the pending link for the current user so local
// testing can reach the verified state in one click. `import.meta.env.DEV` is a
// build-time constant, so this whole path is dead-code-eliminated from prod builds.
async function devVerifyCurrentUser(email) {
  const project = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const host = 'http://127.0.0.1:9099';
  const list = await fetch(`${host}/emulator/v1/projects/${project}/oobCodes`).then((r) => r.json());
  const codes = (list.oobCodes || []).filter(
    (o) => o.requestType === 'VERIFY_EMAIL' && o.email === email,
  );
  if (!codes.length) return false;
  const oobCode = codes[codes.length - 1].oobCode; // newest
  await fetch(`${host}/identitytoolkit.googleapis.com/v1/accounts:update?key=fake-api-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oobCode }),
  });
  return true;
}

export default function AuthForm({ prompt = 'Sign in to use AI suggestions', defaultOpen = false }) {
  const { user, authReady, signIn, signUp, signOutUser, sendVerification, refreshUser } = useAuth();
  const [open, setOpen] = useState(defaultOpen);
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Small async wrapper: reset messages, flip busy, surface any auth/* error.
  async function run(fn, successNotice) {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await fn();
      if (successNotice) setNotice(successNotice);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  // Refresh, then tell the user the result: if still unverified the click was a
  // no-op before (they hadn't opened the link) — now say so. On success the parent
  // recomputes canUseAI and swaps this card out for <SuggestOptions/>.
  async function handleRefresh() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await refreshUser();
      if (!auth.currentUser?.emailVerified) {
        setError('Not verified yet — open the verification link first, then hit refresh.');
      }
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  }

  // DEV convenience: apply the emulator's pending verification link, then refresh
  // so emailVerified flips and the AI panel unlocks.
  async function handleDevVerify() {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const applied = await devVerifyCurrentUser(user.email);
      if (!applied) {
        setError('No pending verification link found — hit “Resend email”, then try again.');
        return;
      }
      await refreshUser();
    } catch (err) {
      setError('Dev verify failed: ' + (err?.message || 'unknown error'));
    } finally {
      setBusy(false);
    }
  }

  // Signed in but not yet verified (only reachable when verification is required):
  // hold here with resend / refresh / sign-out until the inbox link is clicked.
  if (authReady && user && REQUIRE_EMAIL_VERIFICATION && !user.emailVerified) {
    return (
      <div className="card panel auth-card">
        <span className="field__label suggest__title">Verify your email</span>
        <p className="section-note">
          You’re signed in as <strong>{user.email}</strong>. One more step — verify your email
          to unlock AI suggestions.
        </p>
        {import.meta.env.DEV && (
          <p className="section-note auth-dev-note">
            Dev mode: no real email is sent. The verification link is printed in the emulator
            logs (and the Emulator UI at :4000) — or just click “⚡ Verify now (dev)”.
          </p>
        )}
        {error && <p className="inline-error">{error}</p>}
        {notice && <p className="section-note">{notice}</p>}
        <div className="auth-actions">
          <button type="button" className="btn btn--primary" disabled={busy} onClick={handleRefresh}>
            {busy ? 'Checking…' : 'I’ve verified — refresh'}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            disabled={busy}
            onClick={() =>
              run(
                sendVerification,
                import.meta.env.DEV
                  ? 'New link generated — see the emulator logs.'
                  : 'Verification email resent.',
              )
            }
          >
            Resend email
          </button>
        </div>
        {import.meta.env.DEV && (
          <button
            type="button"
            className="btn btn--ghost btn--block"
            disabled={busy}
            onClick={handleDevVerify}
          >
            ⚡ Verify now (dev)
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--block" onClick={signOutUser}>
          Sign out
        </button>
      </div>
    );
  }

  // Collapsed: a single call-to-action, mirroring the SuggestOptions collapsed state.
  if (!open) {
    return (
      <button type="button" className="btn btn--ghost" onClick={() => setOpen(true)}>
        🔒 {prompt}
      </button>
    );
  }

  function handleSubmit(e) {
    e.preventDefault();
    if (mode === 'signup') {
      run(
        () => signUp(email.trim(), password),
        'Account created — check your inbox to verify your email.',
      );
    } else {
      run(() => signIn(email.trim(), password));
    }
  }

  return (
    <form className="card panel auth-card" onSubmit={handleSubmit}>
      <div className="suggest__head">
        <span className="field__label suggest__title">
          {mode === 'signup' ? 'Create an account' : 'Sign in'}
        </span>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close"
          onClick={() => setOpen(false)}
        >
          ✕
        </button>
      </div>
      <p className="section-note">AI suggestions need an account. Voting never does.</p>

      <label className="field">
        <span className="field__label">Email</span>
        <input
          className="input"
          type="email"
          autoComplete="email"
          value={email}
          placeholder="you@example.com"
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <label className="field">
        <span className="field__label">Password</span>
        <input
          className="input"
          type="password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          placeholder="••••••••"
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>

      {error && <p className="inline-error">{error}</p>}
      {notice && <p className="section-note">{notice}</p>}

      <button
        type="submit"
        className="btn btn--primary btn--block"
        disabled={busy || !email.trim() || !password}
      >
        {busy ? 'Working…' : mode === 'signup' ? 'Sign up' : 'Sign in'}
      </button>
      <button
        type="button"
        className="btn btn--ghost btn--block"
        onClick={() => {
          setMode(mode === 'signup' ? 'signin' : 'signup');
          setError('');
          setNotice('');
        }}
      >
        {mode === 'signup' ? 'Have an account? Sign in' : 'New here? Create an account'}
      </button>
    </form>
  );
}
