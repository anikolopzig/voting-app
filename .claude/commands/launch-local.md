---
description: Start the local dev environment (functions emulator + Vite dev server)
allowed-tools: Bash, Read
---

Bring up GroupVote locally for development and testing. Both processes stay
running in the background so the session can continue.

Every shell must load nvm first (Node 20 lives there, and so does the `firebase`
CLI): prefix each command with

```
export NVM_DIR=$HOME/.nvm && . "$NVM_DIR/nvm.sh"
```

## Steps

1. **Check nothing is already up.** If :5173 or :5001 is already listening
   (`ss -ltn '( sport = :5173 or sport = :5001 )'`), say so and reuse it rather
   than starting a duplicate.
2. **Check the emulator secret.** `backend/.secret.local` must exist — the
   emulator reads `GEMINI_API_KEY` from it. If it's missing, **skip the emulator**,
   start Vite only, and warn that `/api/suggest` (AI option suggestions) will fail
   locally until the file exists (see `RUNBOOK.md` → One-time setup).
3. **Start the functions emulator** from the repo root, in the background:
   `firebase emulators:start --only functions`
   It serves `/api/suggest` on :5001. The
   `requires the module firebase-admin` warning is **non-fatal** — ignore it.
4. **Start the Vite dev server** from `frontend/`, in the background:
   `npm run dev`
   `frontend/vite.config.js` proxies `/api/suggest` to the emulator, so dev
   behaves like prod.
5. **Confirm both came up** by reading the background output, then report:
   - the app URL — http://localhost:5173
   - whether the emulator is live or was skipped
   - any startup error, verbatim

Do not open a browser. Do not build — `npm run dev` serves from source with HMR,
so edits are live.

If a process dies on startup, show its actual output and check `RUNBOOK.md` →
Pitfalls before guessing at a cause.
