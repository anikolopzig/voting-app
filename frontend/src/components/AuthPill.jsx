import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import { REQUIRE_EMAIL_VERIFICATION } from '../utils/flags.js';
import AuthForm from './AuthForm.jsx';

// Account chip for the far-LEFT of the pinned top bar. Collapsed it's a small pill
// ("User: guest" vs "User: <email>", truncated to 11 chars). Clicking opens a
// laconic Gmail-style account menu: avatar + email/guest + sign out (signed in) or
// an inline sign-in form (guest / unverified, reused from <AuthForm>). Auth only
// gates AI suggestions — voting is account-free — so this is the one always-visible
// sign-in cue and the place to sign in/out.

function GuestIcon() {
  return (
    <svg viewBox="0 0 24 24" width="34" height="34" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="4" fill="currentColor" />
      <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" fill="currentColor" />
    </svg>
  );
}

export default function AuthPill() {
  const { user, authReady, signOutUser } = useAuth();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  // Close on outside click / Escape while open (mirrors MemberStack).
  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function onKeyDown(e) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const signedIn = authReady && !!user;
  const verified = signedIn && (!REQUIRE_EMAIL_VERIFICATION || user.emailVerified);
  const email = signedIn ? user.email : '';

  // Collapsed pill label: "User: guest" is exactly 11 chars (shows whole); a longer
  // email truncates to "User: <5 chars>...".
  const identity = !authReady ? '…' : signedIn ? email : 'guest';
  const label = `User: ${identity}`;
  const collapsed = label.length > 11 ? `${label.slice(0, 11)}...` : label;

  const localPart = email.split('@')[0] || '';
  const greetName = localPart ? localPart.charAt(0).toUpperCase() + localPart.slice(1) : '';

  return (
    <div className="auth-pill-wrap" ref={rootRef}>
      <button
        type="button"
        className="auth-pill"
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {collapsed}
      </button>

      {open && (
        <div className="auth-menu" role="dialog" aria-label="Account">
          <div className="auth-menu__head">
            <span className="auth-menu__email" title={signedIn ? email : 'Not signed in'}>
              {signedIn ? email : 'Not signed in'}
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

          <div className={'auth-menu__avatar' + (signedIn ? '' : ' auth-menu__avatar--guest')}>
            {signedIn ? email.charAt(0).toUpperCase() : <GuestIcon />}
          </div>

          <p className="auth-menu__greeting">
            {signedIn ? `Hi, ${greetName}!` : 'Browsing as a guest'}
          </p>

          {verified ? (
            <button
              type="button"
              className="btn btn--ghost btn--block"
              onClick={() => {
                signOutUser();
                setOpen(false);
              }}
            >
              Sign out
            </button>
          ) : (
            // Guest → inline sign-in/sign-up form; signed-in-but-unverified → the
            // verify card (both include their own actions, incl. Sign out).
            <AuthForm prompt="Sign in" defaultOpen />
          )}
        </div>
      )}
    </div>
  );
}
