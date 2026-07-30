# GroupVote

A real-time group **score-voting** app. Create a room with a question and a set
of options, share the 6-character code, and everyone rates each option 1–10.
Results update live for all participants and the highest **average** score wins.

Built with **React 18 + Vite** and **Firebase Realtime Database** (modular v9 SDK).
Almost everything runs in the browser against Firebase; the only server-side code
is one Firebase Cloud Function used for AI option suggestions (see below).

## Project layout

```
frontend/     Vite + React app (the browser client). Run npm here.
backend/      Firebase Cloud Function for /api/suggest (holds the Gemini key).
firebase.json .firebaserc   Firebase config (Hosting + Functions) — run `firebase` from the repo root.
```

Commands below say which folder to run them in. `firebase …` always runs from the
**repo root**; `npm …` runs inside **`frontend/`** (or **`backend/`** for the
function's own dependencies).

---

## 1. Prerequisites

- Node.js 18+ (this project was built on Node 20).
- A free Firebase account: <https://console.firebase.google.com>

## 2. Create your Firebase project & Realtime Database

1. Go to the [Firebase console](https://console.firebase.google.com) and click
   **Add project**. Give it any name (e.g. `groupvote`) and finish the wizard.
   You can disable Google Analytics — it isn't needed.
2. In the left sidebar open **Build → Realtime Database**, then click
   **Create Database**.
   - Pick a location close to you.
   - Choose **Start in test mode** and click **Enable**.
     Test mode uses these rules (public read/write, fine for a demo):
     ```json
     {
       "rules": {
         ".read": true,
         ".write": true
       }
     }
     ```
     > ⚠️ Test-mode rules are open to anyone with your database URL and, in the
     > console, expire after ~30 days. For anything beyond a demo, tighten the
     > rules (see **Security notes** below).
3. Register a **Web app** to get your config:
   - Click the gear icon → **Project settings** → scroll to **Your apps** →
     click the **`</>`** (Web) icon.
   - Give it a nickname (e.g. `groupvote-web`), **do not** enable Hosting, click
     **Register app**.
   - Firebase shows a `firebaseConfig` object. Keep this tab open — you'll copy
     these values in the next step.

## 3. Configure environment variables

```bash
cd frontend
cp .env.example .env
```

Open `frontend/.env` and paste the values from your `firebaseConfig`:

| `.env` variable                     | `firebaseConfig` field   |
| ----------------------------------- | ------------------------ |
| `VITE_FIREBASE_API_KEY`             | `apiKey`                 |
| `VITE_FIREBASE_AUTH_DOMAIN`         | `authDomain`             |
| `VITE_FIREBASE_DATABASE_URL`        | `databaseURL`            |
| `VITE_FIREBASE_PROJECT_ID`          | `projectId`              |
| `VITE_FIREBASE_STORAGE_BUCKET`      | `storageBucket`          |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `messagingSenderId`      |
| `VITE_FIREBASE_APP_ID`              | `appId`                  |

> **`databaseURL` is required** and is sometimes missing from the snippet if you
> registered the app before enabling the database. If so, grab it from
> **Realtime Database** — it looks like
> `https://<project-id>-default-rtdb.firebaseio.com`.

`.env` is gitignored, so your keys are never committed. (Firebase web keys are
not secret — access is governed by database rules — but keeping them out of the
repo is still good hygiene.)

## 4. Install & run

```bash
cd frontend
npm install
npm run dev
```

Open the printed URL (default <http://localhost:5173>). Create a room in one tab,
copy the code, and join from another tab/browser to watch results update live.

## 5. Production build

```bash
cd frontend
npm run build     # outputs to frontend/dist/
npm run preview   # serve the built app locally to verify
```

---

## How it works

- **Data model** (Realtime Database):
  ```
  rooms/{roomCode}/
    question, options[], creatorName, createdAt, expiresAt, closedAt
    votes/{lowercaseName}/ { scores: {option: 1..10}, submitted: bool }
  ```
- **Room codes**: 6 chars from `A–Z` + `2–9`, excluding ambiguous `0 O 1 I L`.
  Codes are checked for collisions before a room is created.
- **Live updates**: the room page opens a single `onValue` listener; all state
  (votes and closure) flows through it. There is no polling anywhere.
- **Expiry** is enforced entirely client-side: a room is closed when
  `closedAt !== null` **or** `Date.now() > expiresAt` (15 min after creation).
  A 1-second clock drives both the countdown and the flip to the "ended" state.
- **Results** only count votes with `submitted === true`; entering "Edit" mode
  writes `submitted: false` so in-progress edits don't affect the tally.

### Sensible decisions made where the spec was open-ended
- **localStorage** stores a `{ roomCode: name }` map (not a single object) so one
  browser can hold identities for multiple rooms at once.
- **Names are stored lowercase** everywhere (creator + voters) so they double as
  safe Firebase keys and give case-insensitive uniqueness for free.
- The project lives in the WSL filesystem (`~/code/voting-app`) rather than
  `/mnt/c/...` for fast Vite file-watching / HMR.

---

## AI option suggestions

Instead of typing every option by hand, the create form can ask an LLM to
suggest options — extending a list you started, or generating options from
scratch given a location and a short hint. This is powered by a single **Firebase
Cloud Function** (`backend/`) that calls the **Google Gemini API** server-side,
using a Gemini flash-lite model with Google Search grounding (so it can reference
real venues).

**Why a function at all?** The Gemini API key is a real secret and must never
reach the browser. Every `VITE_*` var is inlined into the public bundle, so the
key cannot live in `.env`. It lives as a **Firebase secret** the function reads at
runtime. Requests go to `/api/suggest`, which is same-origin (no CORS) thanks to a
Hosting rewrite.

### One-time setup

1. **Upgrade the Firebase project to the Blaze (pay-as-you-go) plan.** Cloud
   Functions require it. There is a generous free tier; this app's usage is tiny.
2. **Install the CLI and log in** (once per machine):
   ```bash
   npm install -g firebase-tools
   firebase login
   ```
3. **Get a Gemini API key** from <https://aistudio.google.com/apikey> (Google AI
   Studio — this is also where your credits live).
4. **Store it as a Firebase secret** (used by the deployed function):
   ```bash
   firebase functions:secrets:set GEMINI_API_KEY
   # paste the key when prompted
   ```
5. **For the local emulator**, create `backend/.secret.local` (gitignored):
   ```bash
   echo 'GEMINI_API_KEY=...' > backend/.secret.local
   ```
6. **Install the function's dependencies:**
   ```bash
   cd backend && npm install && cd ..
   ```

### Local development (two terminals)

```bash
firebase emulators:start --only functions   # terminal 1, from repo ROOT — serves /api/suggest
cd frontend && npm run dev                   # terminal 2 — Vite proxies to it
```

`frontend/vite.config.js` proxies the client's `/api/suggest` call to the
emulator, so the app behaves the same in dev and prod.

### Deploy

```bash
(cd frontend && npm run build)   # outputs frontend/dist/
firebase deploy                  # from repo ROOT — deploys Hosting + the function together
```

After deploy, the app is served from `https://<project-id>.web.app`, deep links
like `/room/ABC123` resolve via the SPA rewrite, and `/api/suggest` reaches the
function. To deploy only one part: `firebase deploy --only hosting` or
`--only functions`.

---

## Security notes

Test-mode rules leave your database world-writable. Before sharing widely,
tighten `rooms` — for example, disallow deleting rooms and cap payload sizes, or
put the app behind Firebase Auth and scope writes to authenticated users. The
current app is designed for short-lived, low-stakes "where should we eat" polls.
