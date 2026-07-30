# CLAUDE.md — GroupVote

Guidance for Claude Code (and humans) working in this repo. This file is loaded
automatically every session, so keep it **current, factual, and concise**. When
you change how the project works, update the relevant section here in the same
change.

> Deeper narrative context lives in `HANDOFF.md`. This file is the short,
> living source of truth; `HANDOFF.md` is a one-time context dump.

---

## What this is

A **real-time group score-voting app**. A user creates a "voting room" with a
question and options, gets a 6-char code, and shares it. Friends join with the
code, rate every option **1–10**, and everyone sees **live-updating** results.
The app computes the best group outcome under one of **three evaluator methods**
(see [Evaluator methods](#evaluator-methods)).

Nearly everything runs in the browser against Firebase. The one server-side
exception is a small Firebase Cloud Function for work that needs a secret the
browser can't hold — namely the Google Gemini API key for LLM option suggestions.

## Commands

The repo is split into **`frontend/`** (the Vite app — run `npm` here) and
**`backend/`** (the Cloud Function). `firebase` always runs from the **repo root**
(where `firebase.json` lives).

| Command | Run in | What it does |
|---------|--------|--------------|
| `npm run dev` | `frontend/` | Vite dev server → http://localhost:5173 (HMR) |
| `npm run build` | `frontend/` | Production build; outputs `frontend/dist/` |
| `npm run preview` | `frontend/` | Serve the built `frontend/dist/` locally |
| `firebase emulators:start --only functions` | root | Local `/api/suggest` function; run alongside `npm run dev` (Vite proxies to it) |
| `firebase deploy` | root | Deploy Hosting (`frontend/dist/`) + the Cloud Function together |

**Node:** v20.15.1 via **nvm**. ⚠️ nvm only loads in interactive/login shells, so
a non-interactive `bash -c 'node ...'` may not find `node`. Prefix commands with:

```bash
export NVM_DIR=$HOME/.nvm && . "$NVM_DIR/nvm.sh"
```

A healthy build currently reports **69 modules, no errors** — keep it clean.

**Slash commands** (`.claude/commands/`, checked in) wrap the two everyday
workflows so they run the same way every time:

| Command | Does |
|---------|------|
| `/launch-local` | Starts the functions emulator + Vite dev server in the background → http://localhost:5173. Skips the emulator (with a warning) if `backend/.secret.local` is missing. |
| `/build-deploy` | Builds `frontend/`, then `firebase deploy` (Hosting + function), then smoke-tests the live site. **Stops without deploying if the build fails** — deploy publishes whatever is in `frontend/dist/`. |

Both defer to `RUNBOOK.md` for the underlying steps and its symptom→cause→fix
pitfall list. If you change how the app is run or deployed, update `RUNBOOK.md`
and these two command files together.

## Tech stack (non-negotiable — set by the original spec)

- **React 18 + Vite** — **JavaScript, not TypeScript**
- **Firebase Realtime Database** (NOT Firestore), modular v9+ SDK
- **react-router-dom**
- **Plain CSS** — one global stylesheet (`src/styles/global.css`), no
  Tailwind / UI libraries
- **Minimal backend** — browser-only against Firebase, with **one** allowed
  exception: a Firebase Cloud Function for work that needs a server-held secret
  (the Gemini API key). Don't add a general application backend beyond that.

---

## Architecture

Two core ideas: **one live `onValue` subscription drives all state**, and **pure
logic lives in `frontend/src/utils/`** (no React, easy to reason about/test).

The app is split into `frontend/` (Vite client) and `backend/` (the Cloud
Function); `firebase.json`/`.firebaserc` sit at the repo root.

```
frontend/src/              (frontend/ also has index.html, vite.config.js, package.json)
  main.jsx                 React root + BrowserRouter + global.css
  App.jsx                  Routes: "/" Home (Landing), "/create" Create,
                           "/room/:code" Room, "*" -> "/"
  firebase.js              initializeApp + getDatabase(db) from VITE_ env vars
  pages/
    Home.jsx               Landing (design 2a): join-focused. Brand + <JoinRoom>
                           card + an "or" divider + a "Start a new vote" button →
                           /create (carries any leave-room name). No Create panel.
    Create.jsx             /create screen (design 3a): back link + "New vote"
                           heading + <CreateRoom>. Split out of Home so the app has
                           the design's 3 distinct screens (Landing/Create/Room).
    Room.jsx               THE hub. One onValue listener = all live state.
                           Holds: room, now (1s tick), copied, methodId (local).
                           Writes: submitVotes/editVotes (set votes/{name}),
                           closePoll (update closedAt), setMode/setRole/setVip
                           (roles, president-gated), saveOptions +
                           acceptSuggestions/removeSuggestion (write options +
                           optionAuthors via authorsFor()), leaveRoom (drop
                           presence+vote → home). Also hosts <SuggestOptions> for
                           ministers+ (iCanEditOptions). Presence written
                           once on load + removed on unmount/onDisconnect.
                           Redirects if no identity. Layout: single main
                           column; the roster is the pinned <MemberStack>
                           (top-right), not an always-on sidebar.
  components/
    CreateRoom.jsx         Create form; validation; collision-checked code; set().
                           Dropdown picks inputMode (the room-mode picker is
                           hidden behind ROOM_MODE_UI_ENABLED — mode still seeded
                           from DEFAULT_ROOM_MODE); seeds
                           status:{creator:'president'} + optionAuthors (all seed
                           options credited to the creator). Hosts <SuggestOptions>;
                           acceptSuggestions() fills blank option rows first, then
                           appends (never overwrites); removeSuggestion() undoes a
                           rejected one (keeps the 2-row min). initialName pre-fills on leave.
                           Rendered by the Create page (no own title); option rows
                           carry a numbered .option-num badge.
    ModeToggle.jsx         Header segmented control for room mode (conversation/
                           vote). President-only: Room.jsx renders it only for
                           presidents (and only while active) — hidden for everyone
                           else, not shown read-only. CURRENTLY hidden entirely
                           behind ROOM_MODE_UI_ENABLED (utils/flags.js) — the
                           component + setMode logic are intact, just not rendered.
    OptionsEditor.jsx      Live options editor (shown when canEditOptions); writes
                           the whole options array. Keyed on the option set.
    SuggestOptions.jsx     Collapsible "suggest options with AI" panel (location
                           + hint + count). Calls requestSuggestions(); NOTHING is
                           auto-added — each result gets a ✓ accept / ✕ reject
                           control (green/red outline). Accept → onAccept([label]);
                           rejecting an accepted one → onRemove(label). Used in the
                           create form AND in the room (ministers+); the host wires
                           onAccept/onRemove to local state or Firebase.
    JoinRoom.jsx           Join form; 4 error cases; case-insensitive lookup
    VotingSection.jsx      Input depends on room.inputMode: 1–10 slider (step 1
                           or 0.1), or ranked-choice drag cards (+ ▲▼ buttons,
                           since drag is mouse-only and this IS the vote).
                           Slider modes show a round .score-bubble + a filled
                           track (inline gradient by value) + 1↔10 hints.
                           Each option carries a corner "sticker" (.option-adder,
                           a VoterDot) of whoever added it, from optionAuthors.
                           Submit<->Edit cycle; remounted via `key` when the
                           option set changes. STALE-BALLOT NUDGE: if options were
                           added/renamed after this voter submitted (unratedOptions
                           non-empty), it auto-unlocks into editing, shows an amber
                           .voting-stale-note, and flags each unrated row (.option-
                           new-flag + --unrated ring). Their old scores keep
                           counting until they resubmit; resubmit (set()) prunes
                           orphaned labels. Self-clears once every option is rated.
    ResultsSection.jsx     Submitted-only averages; ranks via selected method;
                           bars, winner/tie highlight (label only when ended).
                           Per-voter dots on each bar at that person's score.
                           Coverage caveat: an option rated by fewer submitted
                           voters than voted overall (count < submittedCount) shows
                           "rated by N of M voters" in amber (.result-row__count--
                           partial) — flag only, ranking/winner unchanged.
    VoterDot.jsx           One person's identity chip (colored dot + initial).
                           Used BOTH as a bar marker and as the roster legend.
                           Rings: me→ink, vip→gold, voted→sage (voted only passed
                           from roster/stack, never on the bars where all voted).
    Countdown.jsx          Pure mm:ss display; red/urgent under 60s.
    EvaluatorToggle.jsx    3-button segmented control + per-button tooltips.
    MemberStack.jsx        Google-Docs-style presence pin (position:fixed, top-
                           right): up to 3 enlarged VoterDots side by side (no
                           overlap) + a "+N" chip (4th circle, only when >3
                           people, N = count-3) + caret. Click any / the caret →
                           opens ParticipantsList in a popover (click-outside/Esc
                           to close). Forwards all props EXCEPT onLeave to the
                           roster; hosts its own red "Leave room" pill beside the
                           stack. Local `open` only. Replaces the old sidebar.
    ParticipantsList.jsx   Roster (rendered inside the MemberStack popover):
                           everyone in the room + status tag
                           (Deciding · Editing · Voted) + role chip.
                           President-only: draggable VIP badge (drop on a name →
                           room.vip), click chip to toggle voter⇄minister, 👑 to
                           promote. (Leave room button lives in MemberStack now.)
    ErrorBanner.jsx        Dismissible error banner (Firebase failures).
  utils/
    roomCode.js            generateRoomCode() — 6 chars, safe alphabet
    storage.js             identity map {ROOMCODE: lowercasename}, session-first +
                           localStorage fallback. save/get/clearIdentity.
    room.js                isRoomClosed(), formatDuration(), ROOM_TTL_MS,
                           CLOSE_UNLOCK_MS (=3min), getParticipantNames(),
                           unratedOptions(vote, options) → current options the
                           vote has no numeric score for (stale-ballot detection)
    roles.js               ROLES/ROOM_MODES + roleOf(), getMode(), canEditOptions/
                           canManageRoom/canChangeRole. The role/mode rules.
                           DEFAULT_ROOM_MODE = 'vote'.
    flags.js               Feature flags. ROOM_MODE_UI_ENABLED (=false) hides the
                           room-mode UI (ModeToggle + create-form picker) without
                           removing the mode logic; flip to true to restore it.
    scoring.js             METHODS[] + getMethod() + DEFAULT_METHOD_ID
    inputModes.js          INPUT_MODES[] + getInputMode() + scoreForRank()
                           + DEFAULT_INPUT_MODE_ID
    participantColor.js    PARTICIPANT_COLORS + colorForName() + initialFor()
    suggestions.js         requestSuggestions() — POSTs /api/suggest, returns
                           [{label, why}] or throws a user-readable Error.
  styles/global.css        One stylesheet. Light "Organic" theme (warm cream),
                           mobile-first, CSS vars. Accent = terracotta --accent
                           (#c67139); secondary = sage --sage. Fonts via Google
                           Fonts @import: Caprasimo (headings) + Figtree (body).
                           (.suggest* = AI panel.) The design's scattered "sticker"
                           background + ballot mascot were intentionally omitted.

backend/                   The ONLY server-side code. Firebase Cloud Function (v2,
                           Node 20, ESM). Exists to hold the Gemini API key
                           server-side; no voting logic here, no DB access.
  package.json             deps: @google/genai, firebase-functions.
  index.js                 onRequest handler `suggestOptions`: Origin allowlist,
                           request validation, error → HTTP mapping. Key via
                           defineSecret('GEMINI_API_KEY').
  suggest.js               Pure buildPrompt() + callGemini() (no firebase import;
                           runnable as `node suggest.js "..."`). Model + Google
                           Search grounding details live here.
firebase.json              Hosting (public frontend/dist/) + rewrites: /api/** →
                           function BEFORE the ** SPA catch-all (order matters).
                           functions.source = backend/.
.firebaserc                Pins the default project (groupvote-12796).
```

**Live-update flow:** any write to `rooms/{code}` (a vote, a close, anything) is
pushed by Firebase to every client through the single `onValue` in `Room.jsx`,
which calls `setRoom(snap.val())` and re-renders. **No polling anywhere.**

## Data model (Realtime Database)

```
rooms/
  {roomCode}/                         // 6 chars, A–Z + 2–9, excludes 0 O 1 I L
    question:    string
    options:     string[]             // e.g. ["Sushi", "Pizza"]
    optionAuthors/                    // who added each option (for its sticker)
      {optionLabel}: lowercasename    // keyed by the exact option label, like
                                      // scores. Absent on old rooms -> no sticker.
                                      // Creator seeds theirs; ministers+ get
                                      // credited when they add/AI-suggest one.
    creatorName: string               // stored LOWERCASE (reserved name)
    createdAt:   number               // Date.now() at creation
    expiresAt:   number               // createdAt + 15*60*1000
    closedAt:    number | null        // set when creator closes early
    inputMode:   'score'|'precise'|'rank'  // how people vote; set at creation,
                                      // absent on old rooms -> 'score'
    mode:        'conversation'|'vote'  // conversation = everyone edits options;
                                      // vote = options locked. Absent on old
                                      // rooms -> 'vote'. A president flips it live.
    vip:         string | null        // lowercase name; president-set. That
                                      // voter's score counts DOUBLE in results.
    status/                           // role per person (absent = mode default)
      {lowercaseName}: 'voter'|'minister'|'president'
    participants/                     // presence roster (written on room entry)
      {lowercaseName}: true           // everyone who opened the room, even if
                                      // they never voted → shown in the roster
    votes/
      {lowercaseName}/
        scores:    { [optionName]: number }   // 1–10 per option
        submitted: boolean            // only submitted votes count in results
```

- A room is **closed** when `closedAt != null` OR `Date.now() > expiresAt`.
- Expiry is enforced **purely client-side** (a 1s clock drives the countdown and
  the flip to "ended"). There is **no server cleanup**.
- There is **no `method` field** — the evaluator choice is per-viewer local
  state, not stored. (See [Extending](#extending-the-project) to make it synced.)
- `mode` + `status` drive the **roles system** (see [Roles & room modes](#roles--room-modes)).
  Both are room-wide, written to Firebase, and reach everyone via the one
  `onValue`. `status` is sparse — only presidents and explicit overrides are
  stored; everyone else follows the mode default via `roleOf`.

## Evaluator methods

Three ways to judge the "best outcome," chosen per-viewer via `EvaluatorToggle`
rendered inside `ResultsSection`, right under the "Results" heading (it sits with
the bars it re-ranks, not up in the room header). Defined in `src/utils/scoring.js` as `METHODS[]`; each
`compute(scoresForOneOption[])` returns a value on the **same 1–10 scale**, so
bars and labels stay comparable. `ResultsSection` uses the selected method for
ranking, the winner/tie set, bar widths, and the caption blurb.

| id        | Button label     | Formula                          | Meaning |
|-----------|------------------|----------------------------------|---------|
| `mean`    | Most happiness   | arithmetic mean                  | max total group satisfaction (**default**) |
| `geomean` | Everyone content | geometric mean = exp(mean(ln x)) | one low score tanks it → penalizes "great for most, hated by one" |
| `min`     | No dealbreakers  | minimum score                    | maximin / best worst-case |

- The choice is **per-viewer local** (`useState methodId` in `Room.jsx`) — NOT
  written to Firebase, no schema change. Each person explores independently.
- Winner/tie comparison rounds to **3 decimals** so float dust in a geomean
  can't split a genuine tie.
- Each toggle button has a **tooltip** (its `blurb`) shown on hover / keyboard
  focus; the same `blurb` is shown inline for the active method in
  `ResultsSection`. Keep `blurb` the single source of truth — don't duplicate the
  text elsewhere.
- **VIP weighting:** if `room.vip` is set (**president-only**, via the draggable
  badge in the roster), that voter's score is pushed into the per-option array
  **twice** in `computeResults`, doubling its weight for `mean`/`geomean`. `min`
  is unaffected by design (a worst-case ignores multiplicity). The displayed voter
  `count` stays unweighted.

---

## Roles & room modes

Two coupled ideas, both room-wide (in Firebase, synced by the one `onValue`).
All logic is pure in **`src/utils/roles.js`**; capability checks (`canEditOptions`,
`canManageRoom`, `canChangeRole`) are the single source of truth — call them, don't
re-derive role rules in components.

**Roles** (`status/{name}`), in increasing power — each includes the ones below:

| Role | Adds the power to… |
|------|--------------------|
| `voter` | vote (baseline) |
| `minister` | + edit the room's options |
| `president` | + end the vote, assign VIPs, change the mode, and promote others (incl. to president) |

- The **creator starts as president**. Presidents **cannot be demoted** — this
  guarantees a room always has ≥1 manager and can't lock itself out.
- `status` is **sparse**: only presidents + explicit overrides are stored.
  `roleOf(room, name)` resolves a role as: explicit `status` entry → else creator
  is `president` → else the **mode default**. So old rooms (no `status`) still
  work: creator manages, everyone else is a voter.

**Modes** (`mode`) just set the *default role* of everyone without an override:

| Mode | Non-president default | Effect |
|------|-----------------------|--------|
| `conversation` | `minister` | everyone can edit options together |
| `vote` (**new-room default** + old-room fallback) | `voter` | options locked to ministers+ |

- **The mode-picker UI is currently hidden behind `ROOM_MODE_UI_ENABLED`**
  (`utils/flags.js`, default `false`): the `ModeToggle` bar and the create-form
  Room-mode selector are not rendered, and `DEFAULT_ROOM_MODE` is `'vote'`, so
  every new room is locked (only ministers+ edit options). None of the mode logic
  was removed — flip the flag to `true` to bring both controls back.
- Because conversation⇒minister and vote⇒voter, **"can edit options" = role ≥
  minister** — the mode drives the default role and editing follows the role.
- A president flips the mode via `ModeToggle` in the header (everyone sees it
  read-only). Switching **clears every non-president `status` override** (one
  atomic multi-path `update` setting them to `null`), so everyone "reverts" to the
  new mode default; presidents are untouched. A president can still override an
  individual afterward (e.g. make one person a minister during vote mode).
- **Role management UI** (`ParticipantsList`, presidents only): clicking a
  person's role chip toggles the reversible pair **voter ⇄ minister**; a separate
  **👑 button promotes to president** and is **confirmed** because it's
  irreversible. President chips render locked. `canChangeRole` gates the writes.
- **Option editing:** `OptionsEditor` (shown when `canEditOptions`) writes the
  whole `options` array. `VotingSection` remounts on `key={room.options.join('|')}`
  to re-seed ballots. The editor must **NOT** reuse that key — two siblings with
  the same key collide and React duplicates/drops them — so it re-seeds its draft
  from props via a `useEffect` instead. Stale scores for removed options are
  simply ignored by `ResultsSection`.
- **Editing options mid-vote leaves prior submissions incomplete — this is
  surfaced, not silently dropped.** Option writes (`saveOptions`,
  `acceptSuggestions`, `removeSuggestion`) touch only `options`/`optionAuthors`,
  never `votes`. So adding/renaming an option after people voted means their
  submitted ballots have no score for the new label. Two safeguards, both
  read-time (no vote invalidation, no migration): (1) `VotingSection` uses
  `unratedOptions()` to detect the stale ballot, auto-unlocks it, and nudges the
  voter to rate + resubmit (see its file-map note); (2) `ResultsSection` caveats
  any option whose `count < submittedCount` ("rated by N of M"). Ranking/winner
  math is deliberately left unchanged — the fix is awareness, not re-weighting.

## Conventions & gotchas

- **Don't show people controls they can't use.** If a member lacks the capability
  to act on something, **hide it** — don't render it disabled, greyed-out, or
  read-only. Gate the *rendering* on the same capability check that gates the
  write (`canEditOptions`, `canManageRoom`, `canChangeRole`, `isPresident`, …), so
  a non-president never sees the close-poll button, the VIP badge, role chips they
  can't change, and the like. When you add any role-gated feature, apply this: the
  UI a member sees should be exactly the set of things they can interact with.
- **Names are lowercase everywhere** (creator + voters) so they double as safe
  Firebase keys and give case-insensitive uniqueness for free.
- **Identity is stored per-tab, with a durable fallback** (`src/utils/storage.js`,
  key `groupvote.identities`, a MAP `{ ROOMCODE: lowercasename }`):
  `sessionStorage` holds **this tab's** identity (so two tabs of the same browser
  can be two different voters, and it survives an in-tab refresh); `localStorage`
  is the cross-tab/cross-session fallback so reopening a room in a fresh tab still
  restores your name. Reads prefer `sessionStorage`; writes go to both.
- All evaluator values live in **[1, 10]**, so bar width = `value / 10 * 100%`
  works for every method. The per-voter dots reuse that same mapping (a score of
  7 sits exactly where a 7.0 fill would end).
- **Every input mode must emit a score in [1, 10]** — never 0. `geomean` takes
  `ln(score)`, so a 0 yields `-Infinity` and destroys the results. Ranked choice
  therefore maps ranks onto the scale (`scoreForRank`: best 10 → worst 1) and
  stores the *derived score*, not the rank. That map is strictly decreasing, so
  sorting a stored vote by score desc restores the voter's exact order — which is
  why the ranking needs no extra field in the DB.
- **Participant color is hashed from the NAME, never an array index**
  (`participantColor.js`). Index-based assignment would reshuffle everyone's
  color whenever someone joins, and two clients could disagree. Trade-off: with
  10 colors, two people can share one — that's why the **initial is drawn inside
  the dot**, and why the roster shows the same dot as a legend. Don't "fix" this
  by assigning colors positionally.
- Dots render for **submitted votes only**, consistent with the tally (someone
  editing counts as "hasn't voted", so their dots disappear until they resubmit).
- **Reuse existing CSS** (`.card`, `.btn`, `.field`, `.section-note`,
  `.result-row`, `.method-toggle`, `.method-btn`, …) and the `--accent` var
  before adding new rules. Styles are light "Organic" (warm cream), mobile-first,
  CSS-variable driven — match that.
- Home tagline is method-neutral ("See the best outcome for the group, live.")
  since there are 3 lenses — don't revert it to "Highest average wins."
- Firebase writes are **guarded** (try/catch → dismissible `ErrorBanner`, never
  crash). Keep new writes in the same pattern.

## Firebase

- **Project ID:** `groupvote-12796`
- **Database URL:** `https://groupvote-12796-default-rtdb.firebaseio.com`
- **`.env`** (gitignored) holds the real web-app config; **`.env.example`**
  documents every required `VITE_FIREBASE_*` var. To recreate `.env`, copy values
  from Firebase console → Project settings → Your apps (the `databaseURL` is the
  one people forget).
- ⚠️ **Test-mode security rules expire ~2026-08-21** (`.read`/`.write` are
  `"now < 1787284800000"`). After that, reads/writes are denied until the rules
  are edited (Realtime Database → Rules). The DB is currently world
  readable/writable to anyone with the URL — fine for a demo, not production.
- **Cloud Functions require the Blaze plan.** The `suggestOptions` function (AI
  suggestions) needs Blaze; the free tier covers this app's volume. The Gemini
  key is a **Firebase secret** (`firebase functions:secrets:set GEMINI_API_KEY`),
  NOT a `VITE_` var — never expose it to the browser. Emulator reads it from
  `backend/.secret.local` (gitignored).

## Testing & verification

No test runner is set up. Verify manually:

```bash
npm run build          # must stay clean
npm run dev            # http://localhost:5173
```

Create a room, open a 2nd tab to Join **as a different name**, submit votes,
toggle the 3 method buttons, watch results re-rank live, and confirm the browser
console is error-free. Identity is per-tab (`sessionStorage`), so two tabs in the
same browser are now two independent voters — re-join in each tab after changing
identity code.

Alternatively, add a **second voter** by writing to the DB directly — replace
`{CODE}`:

```bash
curl -s -X PUT -H "Content-Type: application/json" \
  -d '{"scores":{"Steakhouse":2,"Salad bar":5},"submitted":true}' \
  "https://groupvote-12796-default-rtdb.firebaseio.com/rooms/{CODE}/votes/sam.json"
```

---

## Extending the project

Add new decisions and how-tos here as the project grows.

### Make the evaluator method room-wide (synced) instead of per-viewer

We deliberately chose per-viewer local. To make everyone share one method:

1. **Schema:** add one field — `method: "mean" | "geomean" | "min"` at the room
   level (sibling of `closedAt`).
2. `CreateRoom.jsx` `set()` payload: add `method: DEFAULT_METHOD_ID` (import it).
3. `Room.jsx`: delete `const [methodId, setMethodId] = useState(...)`; derive
   `const methodId = room.method || DEFAULT_METHOD_ID;` (fallback keeps old rooms
   working). Add a handler that writes it and pass it as `onMethodChange` to
   `<ResultsSection>` (which forwards it to `<EvaluatorToggle onChange=…>`):
   ```js
   async function changeMethod(id) {
     try { await update(ref(db, `rooms/${roomCode}`), { method: id }); }
     catch (err) { setError(err.message || 'Failed to change ranking method.'); }
   }
   ```
   The existing `onValue` listener already syncs it to everyone — no new listener.
   Optionally gate `changeMethod` behind `isCreator`, and note test-mode rules
   must permit writes to `method`.

### Add a new evaluator method

Add an entry to `METHODS[]` in `src/utils/scoring.js` with `id`, `label`,
`blurb`, and `compute(scores) → value in [1,10]`. Everything else (toggle
buttons, tooltips, ranking, bars) picks it up automatically.

### Add a new role

In `src/utils/roles.js`: insert the id into `ROLES` at its rank (order = power),
add a `ROLE_META` entry (`label`, `emoji`), and grant its extra power in the
relevant `can*` helper. The roster chip and `roleOf` fallback adapt automatically;
decide whether any mode should make it a default (`defaultRoleForMode`) and how
the roster's click-cycle should treat it (today the cycle is voter⇄minister, with
president promotion separate + confirmed because it's irreversible).

### AI option suggestions (the `backend/` Cloud Function)

Endpoint `/api/suggest` → the `suggestOptions` function in `backend/`. Suggestions
resolve to plain strings that land in `options: string[]`. The `SuggestOptions`
panel is used in **two** places with the same `onAccept`/`onRemove` contract:
- **Create form** (`CreateRoom.jsx`) — accept/remove mutate the local `options`
  React state; nothing hits Firebase until the room is created.
- **Room page** (`Room.jsx`, shown to ministers+ via `iCanEditOptions`) —
  accept/remove `update()` the live room: `options` **and** the `optionAuthors`
  map (crediting the accepter). The single `onValue` pushes the new option to
  everyone; no new listener.

The suggestion strings themselves need no schema; the **author sticker** feature
adds the `optionAuthors` map (see the data model), written wherever options are.

Provider: **Google Gemini** via the `@google/genai` SDK, a flash-lite model
(cheap; runs on Google AI Studio credits). Constraints baked into
`backend/suggest.js`:

- **Grounding is `tools: [{ googleSearch: {} }]`** (Google Search). This is what
  lets suggestions name real venues near a location; it's also the whole reason
  for the added latency.
- **We do NOT use Gemini JSON mode** (`responseMimeType: 'application/json'` +
  `responseSchema`): it's incompatible with the `googleSearch` tool — you can't
  force a schema and ground in the same call. We instruct the JSON shape in the
  system prompt and parse defensively instead (`parseSuggestions`). If you ever
  drop grounding, JSON mode would remove the parse step — verify empirically.
- **Model id is a guess-and-verify constant.** `MODEL` in `suggest.js` defaults to
  the `gemini-flash-lite-latest` alias; confirm the exact id against
  <https://ai.google.dev/gemini-api/docs/models>. A model-not-found error is a
  one-line fix there.

To change the model, edit `MODEL` in `suggest.js`. Follow-up worth doing:
**Firebase App Check** to stop randoms from spending your Gemini quota via the
public `/api/suggest` endpoint (today it only has an Origin allowlist).

### Other open ideas

- **Tighten Firebase rules** before the test-mode window closes (~2026-08-21).
- **Smoke test for `scoring.js`** — a tiny node script asserting mean/geomean/min
  on a known vector (no test runner exists yet).

---

## How to keep this file useful

- Update the section you touched **in the same change** (file map, data model,
  conventions).
- Prefer **facts and rules** over narration. Drop anything that's only true for
  one session (e.g. "the dev server is running").
- New durable "why we did it this way" decisions → add a short note under
  [Extending](#extending-the-project) or the relevant section.
