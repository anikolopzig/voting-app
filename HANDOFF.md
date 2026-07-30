# GroupVote — Session Handoff

> Context dump for continuing this project in a fresh Claude Code terminal session.
> Written 2026-07-23. Read this top-to-bottom before making changes.
>
> **Tip:** if you want this auto-loaded every session, copy the "Project facts",
> "Architecture", and "Conventions & gotchas" sections into a `CLAUDE.md` at the
> project root (Claude Code reads `CLAUDE.md` automatically; it does not read
> this `HANDOFF.md` automatically).

---

## 0. How to start the new session (recommended)

This project lives in the **WSL (Ubuntu) ext4 filesystem**, not `/mnt/c/...`, for
fast Vite HMR. Launch Claude Code natively inside it:

```bash
cd ~/code/voting-app && claude
```

That makes `~/code/voting-app` the primary root — native Linux file I/O and git,
no Windows↔WSL boundary. (The previous session ran as a Windows process in a
different repo and reached this project over the `\\wsl.localhost\Ubuntu\...` UNC
path, which is why a handoff is being done.)

---

## 1. What this project is

A **real-time group score-voting app**. A user creates a "voting room" with a
question and options, gets a 6-char code, shares it. Friends join with the code,
rate every option **1–10**, and everyone sees **live-updating** results. The app
computes the best group outcome under one of **three evaluator methods** (see §6).

**Tech stack (non-negotiable, set by original spec):**
- React 18 + Vite (**JavaScript, not TypeScript**)
- **Firebase Realtime Database** (NOT Firestore), modular v9+ SDK
- react-router-dom
- Plain CSS (one global stylesheet), no Tailwind/UI libs
- No backend — everything runs in the browser against Firebase.

---

## 2. Project facts / current status

- **Location:** `~/code/voting-app` (WSL Ubuntu ext4).
- **Node:** v20.15.1 via **nvm**. ⚠️ nvm only loads in interactive/login shells.
  Non-interactive `bash -c 'node ...'` may not find node — either run commands in
  a login shell or `export NVM_DIR=$HOME/.nvm; . $NVM_DIR/nvm.sh` first. (In your
  own interactive terminal this is automatic.)
- **Commands:** `npm run dev` (Vite, http://localhost:5173) · `npm run build`
  (validates + outputs `dist/`) · `npm run preview`.
- **Build status:** clean — 57 modules, no errors.
- **git:** initialized on branch **`master`**, **no commits yet** (everything is
  staged/untracked). A first commit has NOT been made — do that early. `.env` is
  correctly gitignored and will not be committed.
- **Dev server:** not currently running.

## 2a. Firebase — fully set up and verified

- Firebase project created; Realtime Database **enabled in test mode**.
- **Project ID:** `groupvote-12796`
- **Database URL:** `https://groupvote-12796-default-rtdb.firebaseio.com`
- **`.env` exists and is populated** with the real web-app config (gitignored).
  `.env.example` documents every required `VITE_FIREBASE_*` var. If you ever need
  to recreate `.env`, get values from Firebase console → Project settings → Your
  apps; the `databaseURL` is the one people forget.
- ⚠️ **Test-mode security rules expire ~2026-08-21** (`.read`/`.write` are
  `"now < 1787284800000"`). After that, reads/writes get denied until you edit
  the rules (Realtime Database → Rules tab) or tighten them properly. The app is
  currently world-readable/writable to anyone with the DB URL — fine for a demo,
  not for production. See "Security notes" in `README.md`.
- The app has been **tested end-to-end against this live database**: create room,
  join (case-insensitive code), submit/edit votes, live results, ranking, the
  3 evaluator methods, and the creator's 3-minute close-poll lock all work.

---

## 3. Data model (Realtime Database)

```
rooms/
  {roomCode}/                         // 6 chars, A–Z + 2–9, excludes 0 O 1 I L
    question:    string
    options:     string[]             // e.g. ["Sushi", "Pizza"]
    creatorName: string               // stored LOWERCASE (reserved name)
    createdAt:   number               // Date.now() at creation
    expiresAt:   number               // createdAt + 15*60*1000
    closedAt:    number | null        // set when creator closes early
    votes/
      {lowercaseName}/
        scores:    { [optionName]: number }   // 1–10 per option
        submitted: boolean            // only submitted votes count in results
```

Room is **closed** when `closedAt != null` OR `Date.now() > expiresAt`. Expiry is
enforced **purely client-side** (a 1s clock drives both the countdown and the flip
to "ended"); there is NO server cleanup.

There is **no `method` field** — the evaluator choice is per-viewer local state,
not stored. (See §7 for the exact schema+code if you ever want it room-wide.)

---

## 4. Architecture / file map

Two ideas: a live `onValue` subscription drives everything, and pure logic is
split into `src/utils/`.

```
src/
  main.jsx                 React root + BrowserRouter + global.css
  App.jsx                  Routes: "/" Home, "/room/:code" Room, "*" -> "/"
  firebase.js              initializeApp + getDatabase(db) from VITE_ env vars
  pages/
    Home.jsx               Two panels (Create / Join) + shared error banner
    Room.jsx               THE hub. One onValue listener = all live state.
                           Holds: room, now (1s tick), copied, methodId (local).
                           Writes: submitVotes/editVotes (set votes/{name}),
                           closePoll (update closedAt). Redirects if no identity.
  components/
    CreateRoom.jsx         Create form; validation; collision-checked code; set()
    JoinRoom.jsx           Join form; 4 error cases; case-insensitive lookup
    VotingSection.jsx      Sliders 1–10 (default 5); Submit<->Edit cycle.
                           Remounted via key when option set changes.
    ResultsSection.jsx     Submitted-only averages; ranks via selected method;
                           bars, winner/tie highlight (label only when ended).
    Countdown.jsx          Pure mm:ss display; red/urgent under 60s.
    EvaluatorToggle.jsx    3-button segmented control (the evaluator methods).
    ErrorBanner.jsx        Dismissible error banner (Firebase failures).
  utils/
    roomCode.js            generateRoomCode() — 6 chars, safe alphabet
    storage.js             localStorage identity map {ROOMCODE: lowercasename}
    room.js                isRoomClosed(), formatDuration(), ROOM_TTL_MS,
                           CLOSE_UNLOCK_MS (=3min)
    scoring.js             METHODS[] + getMethod() + DEFAULT_METHOD_ID (evaluators)
  styles/global.css        One stylesheet. Dark theme, mobile-first, CSS vars.
                           Accent = --accent (#7c5cff).
```

**Live-update flow:** any write to `rooms/{code}` (a vote, a close, anything) is
pushed by Firebase to every client through the single `onValue` in `Room.jsx`,
which calls `setRoom(snap.val())` and re-renders. No polling anywhere.

---

## 5. Spec behaviors already implemented (don't regress these)

- **Create:** trims fields, rejects empty / <2 options / case-insensitive dup
  options; generates a code and checks it doesn't exist (regenerates on clash);
  writes room; stores identity in localStorage; navigates to `/room/{code}`.
- **Join:** uppercases code (case-insensitive lookup); errors: "Room not found.",
  "This room has closed." (expired or closed), "That name is already taken in this
  room." (matches an existing voter OR the reserved `creatorName`).
- **Room load:** no localStorage identity for this code → redirect to "/". Missing
  room → "Room not found" with a home link.
- **Header:** question, code chip with Copy button, live mm:ss countdown (urgent
  red under 60s).
- **Voting:** one slider row/option (default 5, current value shown). Button:
  "Submit Votes" → writes `{scores, submitted:true}`, sliders lock, button becomes
  "Edit Votes"; clicking it writes `submitted:false` (stops counting) and unlocks.
  Section is replaced by "Voting has ended" when closed/expired.
- **Results (always visible):** submitted-only. Per option: value to 1 decimal,
  voter count, proportional bar. Sorted desc. Winner highlighted always; "Winner"
  / "Tie" label only once closed. "X of Y participants have voted" + note if the
  creator hasn't voted. "No votes yet." when empty.
- **Creator controls:** if identity === creatorName, a "Close Poll" button,
  DISABLED with a live countdown until 3 min after createdAt, then enabled; asks
  `window.confirm` before setting `closedAt`.
- **Edge cases handled:** refresh restores identity + votes + submitted state;
  unsubmitted slider changes don't count; creator is also a voter; concurrent
  submitters write different keys; direct room URL without joining → redirect;
  Firebase errors → dismissible banner, no crash.

---

## 6. Evaluator methods feature (most recent work)

Three ways to judge the "best outcome," chosen per-viewer via `EvaluatorToggle`
in the room header. Defined in `src/utils/scoring.js` as `METHODS[]`; each
`compute(scoresForOneOption[])` returns a value on the **same 1–10 scale** so bars
and labels stay comparable. `ResultsSection` uses the selected method for ranking,
the winner/tie set, bar widths, and the caption blurb.

| id        | Button label     | Formula                         | Meaning |
|-----------|------------------|---------------------------------|---------|
| `mean`    | Most happiness   | arithmetic mean                 | max total group satisfaction (default) |
| `geomean` | Everyone happy   | geometric mean = exp(mean(ln x))| one low score tanks it → penalizes "great for most, hated by one" |
| `min`     | No dealbreakers  | minimum score                   | maximin / best worst-case |

**Design decision:** the choice is **per-viewer local** (`useState` `methodId` in
`Room.jsx`) — NOT written to Firebase, no schema change. Each person explores
independently. Winner/tie comparison rounds to 3 decimals so float dust in a
geomean can't split a genuine tie.

**Verified divergence** (votes: Steakhouse [10,2], Salad bar [5,5]): Most
happiness → Steakhouse (6.0); Everyone happy → Salad bar (5.0 vs 4.5); No
dealbreakers → Salad bar (5 vs 2). Exactly the intended fairness behavior.

---

## 7. Deferred / possible next steps

### (a) Make the evaluator method room-wide (synced) instead of local
We deliberately chose local. If you ever want everyone to share one method:
1. **Schema:** add one field — `method: "mean" | "geomean" | "min"` at the room
   level (sibling of `closedAt`).
2. `CreateRoom.jsx` `set()` payload: add `method: DEFAULT_METHOD_ID` (import it).
3. `Room.jsx`: delete `const [methodId, setMethodId] = useState(...)`; derive
   `const methodId = room.method || DEFAULT_METHOD_ID;` (fallback keeps old rooms
   working). Add a handler that writes it:
   ```js
   async function changeMethod(id) {
     try { await update(ref(db, `rooms/${roomCode}`), { method: id }); }
     catch (err) { setError(err.message || 'Failed to change ranking method.'); }
   }
   ```
   and pass `onChange={changeMethod}` to `<EvaluatorToggle>`.
   The existing `onValue` listener already syncs it to everyone — no new listener.
   Optionally gate `changeMethod` behind `isCreator` for creator-only control, and
   remember test-mode rules must permit writes to `method`.

### (b) Other open ideas
- **First git commit** (none exists yet). Then optionally push to GitHub.
- **Smoke test for `scoring.js`** was offered but not written — a tiny node script
  asserting mean/geomean/min on a known vector. (No test runner is set up.)
- **Deploy to Vercel** — steps are in `README.md` (framework preset Vite; add all
  `VITE_FIREBASE_*` env vars in the Vercel dashboard — it won't read local `.env`;
  add a `vercel.json` SPA rewrite so `/room/CODE` deep links don't 404).
- **Tighten Firebase rules** before the test-mode window closes (~2026-08-21).

---

## 8. Conventions & gotchas

- **Names are lowercase everywhere** (creator + voters) so they double as safe
  Firebase keys and give case-insensitive uniqueness for free.
- **localStorage** stores a MAP `{ ROOMCODE: lowercasename }` (key `groupvote.identities`),
  not a single object, so one browser can hold identities for several rooms.
- **Two tabs in the same browser share localStorage** → you cannot hold two
  distinct identities at once on one origin. To simulate a second voter during
  testing, write directly to the DB, e.g.:
  ```bash
  curl -s -X PUT -H "Content-Type: application/json" \
    -d '{"scores":{"Steakhouse":2,"Salad bar":5},"submitted":true}' \
    "https://groupvote-12796-default-rtdb.firebaseio.com/rooms/{CODE}/votes/sam.json"
  ```
  (Real users on separate devices are unaffected.)
- All evaluator values live in **[1,10]**, so bar width = `value/10*100%` works for
  every method.
- Reuse existing CSS classes (`.card`, `.btn`, `.field`, `.section-note`,
  `.result-row`, `.method-toggle`, etc.) and the `--accent` var before adding new.
- Home tagline is method-neutral ("See the best outcome for the group, live.")
  since there are now 3 lenses — don't revert it to "Highest average wins."

---

## 9. Quick verification loop

```bash
npm run build          # must stay clean (currently 57 modules, no errors)
npm run dev            # http://localhost:5173
```
Create a room, open a 2nd tab to Join (share localStorage caveat above — use curl
for a 2nd voter), submit votes, toggle the 3 method buttons, watch results re-rank
live. Check the browser console is error-free.
