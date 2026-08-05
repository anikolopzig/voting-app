# GroupVote — Deploy Runbook

Operational guide for building, running, and deploying GroupVote. The app is a
Vite/React client (`frontend/`) on **Firebase Hosting** plus one **Cloud Function**
(`backend/`) for AI option suggestions via the **Google Gemini** API.

- **Live URL:** https://groupvote-12796.web.app (also `.firebaseapp.com`)
- **Project:** `groupvote-12796` (pinned in `.firebaserc`)
- **`firebase` commands run from the repo ROOT** (where `firebase.json` lives).
- **`npm` commands run inside `frontend/` or `backend/`** — never the root.

> Node 20 via nvm. In a non-interactive shell (scripts), prefix with:
> `export NVM_DIR=$HOME/.nvm && . "$NVM_DIR/nvm.sh"`

---

## TL;DR — deploy an update

```bash
# from repo root
(cd frontend && npm run build)     # rebuild the client into frontend/dist/
firebase deploy                    # publish Hosting + the function together
```

Then sanity-check:

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://groupvote-12796.web.app/         # 200
curl -s -o /dev/null -w "%{http_code}\n" https://groupvote-12796.web.app/api/suggest  # 405 (POST-only)
```

---

## One-time setup (new machine or new collaborator)

1. **Blaze plan.** Cloud Functions require the pay-as-you-go plan (free tier covers
   this app). Firebase Console → Usage & billing → modify plan.
2. **Install the CLI + log in** (interactive — use a real terminal, not a piped shell):
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase projects:list          # confirm groupvote-12796 (current)
   ```
3. **Gemini API key** from https://aistudio.google.com/apikey (that's also where
   your credits live).
4. **Store the key in TWO places** (they serve different environments):
   ```bash
   firebase functions:secrets:set GEMINI_API_KEY        # deployed function (interactive)
   printf 'GEMINI_API_KEY=YOUR_KEY\n' > backend/.secret.local   # local emulator (gitignored)
   ```
5. **Install dependencies** in each package:
   ```bash
   (cd frontend && npm install)
   (cd backend  && npm install)
   ```
6. **Enable Email/Password auth** (for AI suggestions — voting stays account-free).
   Firebase Console → Authentication → Sign-in method → enable **Email/Password**.
   The auth emulator needs no console config; this is only for the deployed site.

---

## Local development

Two terminals:

```bash
# terminal 1 — from repo ROOT: Functions (/api/suggest on :5001) + Auth (:9099)
firebase emulators:start --only auth,functions

# terminal 2 — the client on :5173, proxying /api/suggest to the emulator
cd frontend && npm run dev
```

Open http://localhost:5173. `frontend/vite.config.js` proxies `/api/suggest` to the
functions emulator, so dev behaves like prod.

**Why both emulators:** AI suggestions are gated behind a Firebase Auth account
(voting is not), and `/api/suggest` **verifies the caller's ID token**. Starting
Auth + Functions *together* auto-wires `FIREBASE_AUTH_EMULATOR_HOST` so the
function trusts emulator-issued tokens; the client points at the auth emulator via
`connectAuthEmulator` in `src/firebase.js` (dev only). Sign up with any email in
the emulator — verification links print to the **emulator logs / Emulator UI**, no
real inbox needed. Start functions alone and every suggestion request 401s.

**Test the function directly** (no browser, no emulator):

```bash
export NVM_DIR=$HOME/.nvm && . "$NVM_DIR/nvm.sh"
cd backend && set -a && . ./.secret.local && set +a
node suggest.js "Where should we eat?" "Kolonaki, Athens"
```

---

## Deploy

```bash
(cd frontend && npm run build)   # ALWAYS build first — deploy uploads whatever is in frontend/dist/
firebase deploy                  # Hosting + function
```

**Deploy one product at a time** (isolates failures — recommended when something
breaks):

```bash
firebase deploy --only hosting     # publishes frontend/dist/ + rewrites (no Blaze/secret needed)
firebase deploy --only functions   # deploys backend/ (needs Blaze + GEMINI_API_KEY secret)
```

**Rollback Hosting** to a previous release: Firebase Console → Hosting → release
history → "Rollback". Functions: redeploy the previous code.

---

## Post-deploy smoke test

```bash
BASE=https://groupvote-12796.web.app
curl -s -o /dev/null -w "root:        %{http_code}\n" "$BASE/"            # 200
curl -s -o /dev/null -w "deep link:   %{http_code}\n" "$BASE/room/TEST12" # 200 (SPA rewrite)
curl -s -o /dev/null -w "api GET:     %{http_code}\n" "$BASE/api/suggest" # 405 (function live)
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"question":"Coffee?","location":"Athens","count":3}' \
  -w "\napi POST:    %{http_code}\n" "$BASE/api/suggest"                  # 401 (no auth token)
```

The `api POST` check now returns **401** — the endpoint requires a Firebase Auth
ID token, so `curl` without one is correctly rejected (that's the point). To smoke
the full suggestions path, sign in on the live site and use the in-app "✨ Suggest
options" panel; the browser attaches the `Authorization: Bearer …` token.

---

## Pitfalls (symptom → cause → fix)

1. **"Site Not Found" / everything 404s after deploy.**
   `frontend/dist/` was empty/missing at deploy time, or the deploy aborted before
   Hosting was released. → Always `(cd frontend && npm run build)` first; then
   `firebase deploy --only hosting` to publish the site independently of functions.

2. **`firebase deploy` fails on the functions step → Hosting also doesn't update.**
   On a first deploy, a functions failure can abort the whole run. → Deploy the two
   products separately (`--only hosting`, then `--only functions`) so one can't
   block the other. Read the CLI output — it states exactly why functions failed.

3. **`Error: ... Blaze plan` on functions deploy.** Project is on the free Spark
   plan. → Upgrade to Blaze (pitfall-free; the free tier still covers this app).

4. **Function returns 500 / "Could not generate suggestions" in prod, but works
   locally.** The **deployed** secret differs from `backend/.secret.local`. They
   are separate: the emulator reads the file; the deployed function reads the
   secret set via `firebase functions:secrets:set`. → Re-set the secret **and
   redeploy the function** (a new secret version only takes effect on redeploy):
   ```bash
   firebase functions:secrets:set GEMINI_API_KEY
   firebase deploy --only functions
   ```

5. **`firebase login` / `functions:secrets:set` "cannot run in non-interactive
   mode".** These need a real terminal (browser/prompt). → Run them in your own
   terminal, not through a piped/embedded shell.

6. **`Cannot find module 'firebase-admin'` / suggestions 401 even when signed in.**
   `firebase-admin` is now a **real dependency** — the function uses it to verify
   the caller's Auth ID token. → `cd backend && npm install` (it's in
   `backend/package.json`). If a signed-in user still gets 401 locally, you started
   the functions emulator **without** auth (`--only functions`): use
   `--only auth,functions` so `FIREBASE_AUTH_EMULATOR_HOST` is wired and the
   function trusts emulator tokens.

7. **`node: command not found` in a script.** nvm only loads in interactive
   shells. → Prefix: `export NVM_DIR=$HOME/.nvm && . "$NVM_DIR/nvm.sh"`.

8. **Gemini "model not found" error.** The model id in `backend/suggest.js`
   (`MODEL = 'gemini-flash-lite-latest'`) doesn't match an available model. → Pick
   a valid id from https://ai.google.dev/gemini-api/docs/models and edit that one
   line; redeploy the function.

9. **Function returns 403 "Origin not allowed" after adding a custom domain.** The
   allowlist in `backend/index.js` (`ALLOWED_ORIGINS`) only lists the `.web.app` /
   `.firebaseapp.com` domains + localhost. → Add the new origin and redeploy.

10. **Region is hard-coded in three files** — `firebase.json` (rewrite),
    `backend/index.js` (`region`), and `frontend/vite.config.js` (proxy path):
    all `us-central1`. → If you ever move the function, change all three together.

11. **`npm run build` fails / wrong output location.** You ran it from the repo
    root. → `cd frontend` first. The build writes to `frontend/dist/`, which is
    what `firebase.json` `hosting.public` points at.

12. **Reads/writes silently denied around Aug 2026.** The RTDB test-mode rules
    expire ~2026-08-21 (`"now < 1787284800000"`). → Tighten/renew the rules in
    Realtime Database → Rules before then.

13. **`@firebase/database: ... credentials ... are invalid` + writes hang (room
    stuck on "Creating…") after signing in locally.** The Auth *emulator* token
    was riding on Realtime Database requests, but the DB is the real
    (non-emulated) prod RTDB, which can't verify an emulator token. → Fixed in
    `src/firebase.js`: Auth runs on a **separate** Firebase app instance so its
    token never attaches to DB writes (voting is account-free). If you see this
    again, make sure nothing calls `getAuth()` on the same app as `getDatabase()`.

---

## Costs & abuse

- **Gemini** calls bill to your Google AI Studio credits; flash-lite is cheap and
  each suggestion is one grounded call.
- The `/api/suggest` endpoint now **requires a verified-email Firebase Auth token**
  (`backend/index.js`), so anonymous scripts can't burn quota — that's the primary
  abuse control. Still deferred: **per-account/IP rate limiting** (one scripted
  account can loop) — see `CLAUDE.md` → Extending and
  `~/.claude/plans/vivid-baking-babbage.md`.
