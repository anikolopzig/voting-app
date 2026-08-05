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
| `firebase emulators:start --only auth,functions` | root | Local `/api/suggest` function (:5001) + Auth emulator (:9099); run alongside `npm run dev` (Vite proxies to it). Both are needed — the function verifies the caller's Auth token, and running them together auto-wires `FIREBASE_AUTH_EMULATOR_HOST`. |
| `firebase deploy` | root | Deploy Hosting (`frontend/dist/`) + the Cloud Function together |

**Node:** v20.15.1 via **nvm**. ⚠️ nvm only loads in interactive/login shells, so
a non-interactive `bash -c 'node ...'` may not find `node`. Prefix commands with:

```bash
export NVM_DIR=$HOME/.nvm && . "$NVM_DIR/nvm.sh"
```

A healthy build currently reports **76 modules, no errors** — keep it clean.

**Slash commands** (`.claude/commands/`, checked in) wrap the two everyday
workflows so they run the same way every time:

| Command | Does |
|---------|------|
| `/launch-local` | Starts the Auth + Functions emulators + Vite dev server in the background → http://localhost:5173. Skips the emulators (with a warning) if `backend/.secret.local` is missing. |
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
  main.jsx                 React root + <AuthProvider> + BrowserRouter + global.css
  App.jsx                  Routes: "/" Home (Landing), "/create" Create,
                           "/room/:code" Room, "*" -> "/"
  firebase.js              initializeApp + getDatabase(db) from VITE_ env vars.
                           getAuth(auth) runs on a SEPARATE app instance ('auth')
                           so a signed-in user's token never rides on DB writes —
                           voting is account-free and the real RTDB would reject a
                           dev Auth-emulator token ("credentials invalid"), hanging
                           every write. Keep Auth off the db app. In DEV,
                           connectAuthEmulator(:9099) on that auth app.
  auth/
    AuthProvider.jsx       React context for Firebase Auth — ONLY gates AI
                           suggestions, never voting. useAuth() exposes {user,
                           authReady, signIn/signUp/signOutUser, sendVerification,
                           refreshUser}. Reads auth.currentUser fresh per render so
                           an emailVerified change (after refreshUser) propagates.
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
                           closePoll (update closedAt), setMode/setRole +
                           addVip/removeVip (write vips/{name}, president-gated),
                           saveOptions +
                           acceptSuggestions/removeSuggestion (write options +
                           optionAuthors via authorsFor()), leaveRoom (drop
                           presence+vote → home). Also hosts <SuggestOptions> for
                           ministers+ (iCanEditOptions). Presence written
                           once on load + removed on unmount/onDisconnect.
                           Redirects if no identity. Layout: a pinned full-width
                           white bar (.room-topbar) at the top holds the
                           <MemberStack> (roster + Leave button, right-aligned);
                           below it a single main column, not an always-on sidebar.
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
                           bars + winner/tie highlight. The leader is badged
                           "Top pick" live and "Winner"/"Tie" once ended (the
                           label is NOT gated to ended — showing the live leader
                           is intended). computeResults clamps each score into
                           [1,10] and skips NaN, so bad DB writes can't break
                           geomean or push a bar off-scale.
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
    EvaluatorToggle.jsx    Segmented control + per-button tooltips. Filters out
                           geomean while GEOMEAN_METHOD_ENABLED is false (flags.js),
                           so it shows 2 buttons today (mean + min), 3 when enabled.
    MemberStack.jsx        Google-Docs-style presence pin: up to 3 enlarged
                           VoterDots side by side (no overlap) + a "+N" chip (4th
                           circle, only when >3 people, N = count-3) + caret. Click
                           any / the caret → opens ParticipantsList in a popover
                           (click-outside/Esc to close). Forwards all props EXCEPT
                           onLeave to the roster; hosts its own red "Leave room"
                           pill beside the stack. Local `open` only. In-flow
                           (position:relative) — Room.jsx renders it inside the
                           pinned .room-topbar (the fixed full-width white bar at
                           the top of the page), right-aligned. Replaces the old
                           sidebar. The <AuthPill> sits to its right (far right of
                           the bar).
    AuthPill.jsx           Far-LEFT account chip in the .room-topbar showing sign-in
                           state — "User: guest" (anonymous voter) vs "User: <email>"
                           (signed-in account), collapsed to ≤11 chars (slice(0,11)+
                           "..."; "User: guest" is exactly 11 so it shows whole).
                           Auth only gates AI suggestions, so this is the one
                           always-visible cue of who you are + the place to sign
                           in/out. Click opens a laconic Gmail-style account menu
                           (click-outside/Esc to close): avatar (initial, or a guest
                           glyph) + email + greeting, then "Sign out" when verified,
                           else the reused <AuthForm defaultOpen> (guest → sign-in
                           form; unverified → verify card). Uses useAuth().
    ParticipantsList.jsx   Roster (rendered inside the MemberStack popover):
                           everyone in the room + role chip. Voting status is a
                           small emoji badge in the avatar's bottom-right corner
                           (💭 Deciding · ✏️ Editing · ✅ Voted), the word on hover
                           — replaced the old text status pill to de-clutter rows.
                           President-only VIP (multi): a reusable ★ badge in the
                           pill drags onto a name to ADD a VIP (onAddVip → vips
                           map); each VIP's own badge drags back to the pill to
                           remove just them (onRemoveVip). Click chip to toggle
                           voter⇄minister, 👑 to promote. (Leave room button lives
                           in MemberStack now.)
    ErrorBanner.jsx        Dismissible error banner (Firebase failures).
    AuthForm.jsx           Inline sign-in / sign-up / verify-email card, shown IN
                           PLACE OF <SuggestOptions> when the viewer isn't signed
                           in (or unverified) — signing in IS the action, so we
                           offer it rather than hiding it. Collapses to a "🔒 Sign
                           in to use AI suggestions" button (pass defaultOpen to
                           start expanded, as <AuthPill>'s menu does); on success the
                           parent swaps it for the panel. Also reused inside the
                           <AuthPill> account menu. Uses useAuth(); voting never
                           routes through here.
  utils/
    roomCode.js            generateRoomCode() — 6 chars, safe alphabet
    storage.js             identity map {ROOMCODE: lowercasename}, session-first +
                           localStorage fallback. save/get/clearIdentity.
    room.js                isRoomClosed(), formatDuration(), ROOM_TTL_MS,
                           CLOSE_UNLOCK_MS (=3min), getParticipantNames(),
                           getVipNames(room) → Set of VIP names (reads the vips
                           map + legacy vip field),
                           unratedOptions(vote, options) → current options the
                           vote has no numeric score for (stale-ballot detection)
    roles.js               ROLES/ROOM_MODES + roleOf(), getMode(), canEditOptions/
                           canManageRoom/canChangeRole. The role/mode rules.
                           DEFAULT_ROOM_MODE = 'vote'.
    flags.js               Feature flags. ROOM_MODE_UI_ENABLED (=false) hides the
                           room-mode UI (ModeToggle + create-form picker) without
                           removing the mode logic. GEOMEAN_METHOD_ENABLED (=false)
                           hides the "Everyone content" (geomean) button from the
                           EvaluatorToggle bar; the method stays in METHODS[].
                           REQUIRE_EMAIL_VERIFICATION (=true) makes AI suggestions
                           require a VERIFIED-email account (must match the same
                           const in backend/index.js). Flip any to true/false.
    keys.js                isValidKey() + FORBIDDEN_KEY_HINT. Option labels and
                           lowercase names are used directly as Firebase keys, so
                           create/join/edit reject any containing . # $ [ ] /
                           (RTDB-forbidden) before the write.
    scoring.js             METHODS[] + getMethod() + DEFAULT_METHOD_ID
    inputModes.js          INPUT_MODES[] + getInputMode() + scoreForRank()
                           + DEFAULT_INPUT_MODE_ID
    participantColor.js    PARTICIPANT_COLORS + colorForName() + initialFor()
    suggestions.js         requestSuggestions({..., idToken}) — POSTs /api/suggest
                           with an `Authorization: Bearer <idToken>` header (the
                           endpoint requires a Firebase Auth token); returns
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
  package.json             deps: @google/genai, firebase-admin, firebase-functions.
  index.js                 onRequest handler `suggestOptions`: Origin allowlist,
                           then **Firebase Auth ID-token verification** (Bearer
                           header → firebase-admin getAuth().verifyIdToken; 401 if
                           missing/invalid, 403 if EMAIL_VERIFICATION_REQUIRED and
                           the email isn't verified — its own try/catch, before the
                           Gemini one), request validation, error → HTTP mapping.
                           Key via defineSecret('GEMINI_API_KEY'); no secret needed
                           for auth (Admin SDK uses the service account / the auth
                           emulator).
  suggest.js               Pure buildPrompt() + callGemini() (no firebase import;
                           runnable as `node suggest.js "..."`). Model + Google
                           Search grounding details live here. PROMPT-INJECTION
                           HARDENING: every untrusted field is sanitized
                           (sanitizeField: strips control chars/<>/backticks,
                           single-lines, clamps) and fenced in a <tag>, with a
                           system "treat tag/web content as untrusted data" clause
                           + a trailing re-assertion of the JSON contract;
                           parseSuggestions cleans, rejects labels that aren't
                           valid Firebase keys (FORBIDDEN_KEY_RE mirrors
                           utils/keys.js), de-dupes, and caps to count.
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
    vips/                             // president-set VIPs; each vote counts
      {lowercaseName}: true           // DOUBLE in results. A room can have many.
                                      // (Legacy: an old `vip: string` single
                                      // field is still read via getVipNames.)
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

- **`geomean` ("Everyone content") is currently hidden** behind
  `GEOMEAN_METHOD_ENABLED` (`utils/flags.js`, default `false`): `EvaluatorToggle`
  filters its button out, so viewers only pick `mean` or `min`. The method's
  `METHODS[]` entry and `compute` are untouched (and VIP weighting still names it),
  so flipping the flag to `true` brings the button back with no other change.

- The choice is **per-viewer local** (`useState methodId` in `Room.jsx`) — NOT
  written to Firebase, no schema change. Each person explores independently.
- Winner/tie comparison rounds to **3 decimals** so float dust in a geomean
  can't split a genuine tie.
- Each toggle button has a **tooltip** (its `blurb`) shown on hover / keyboard
  focus; the same `blurb` is shown inline for the active method in
  `ResultsSection`. Keep `blurb` the single source of truth — don't duplicate the
  text elsewhere.
- **VIP weighting:** a room can have **several VIPs** (`room.vips`, **president-
  only**, via the draggable badge in the roster; read through `getVipNames`, which
  also folds in the legacy single `vip` field). Each VIP's score is pushed into the
  per-option array **twice** in `computeResults`, doubling its weight for
  `mean`/`geomean`. `min` is unaffected by design (a worst-case ignores
  multiplicity). The displayed voter `count` stays unweighted.

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
- **Auth (Email/Password) gates AI suggestions only.** Enable the **Email/Password**
  provider in the console (Authentication → Sign-in method) for the live site;
  `suggestOptions` verifies the caller's ID token via `firebase-admin` (no extra
  secret — the Admin SDK uses the function's service account). Locally the **auth
  emulator** (:9099) handles sign-up; run it with `--only auth,functions` so the
  function trusts its tokens. Voting itself uses no auth (name-per-room identity in
  `utils/storage.js`).
- **Verification-email deliverability is a known weak spot.** Prod uses Firebase's
  built-in sender (`noreply@groupvote-12796.firebaseapp.com`), which is
  *best-effort*: with no custom SMTP and no domain reputation, Gmail often delays
  the mail by minutes or drops it silently — "not in spam" doesn't mean it was
  delivered. Firebase also **rate-limits OOB sends** per account/recipient; too
  many `sendEmailVerification` calls return HTTP **400 `TOO_MANY_ATTEMPTS_TRY_LATER`**
  (`auth/too-many-requests`), and the throttle can suppress delivery for ~an hour.
  Mitigations in code: `AuthForm`'s "Resend email" button has a **30s client
  cooldown** (`cooldown` state) so it can't be hammered into that throttle, plus a
  prod-only "check spam/Promotions, can take a few minutes" note. **Reliable
  delivery is not code-fixable** — it needs custom SMTP in Authentication →
  Templates, or relaxing `REQUIRE_EMAIL_VERIFICATION`/`EMAIL_VERIFICATION_REQUIRED`
  to accept any signed-in account.

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
- **Prompt-injection hardening (zero added latency).** All four user fields
  (`question`, `location`, `hint`, `existing`) are untrusted free text. `buildPrompt`
  runs each through `sanitizeField` (drop control chars / `<` `>` / backticks,
  collapse to one line, clamp) and wraps it in a `<tag>`; the system prompt marks
  tag + web-search content as *data, never instructions*; and the JSON contract is
  re-asserted as the last user line (instruction sandwiching). `parseSuggestions`
  then cleans each field to a single line, drops labels that aren't valid Firebase
  keys (`FORBIDDEN_KEY_RE`, mirroring `utils/keys.js`), de-dupes case-insensitively,
  and caps the list to `count`. This defends the *in-app* injection path; the
  *open-endpoint* abuse path is separate — see the endpoint access-control note below.
- **Model id is a guess-and-verify constant.** `MODEL` in `suggest.js` defaults to
  the `gemini-flash-lite-latest` alias; confirm the exact id against
  <https://ai.google.dev/gemini-api/docs/models>. A model-not-found error is a
  one-line fix there.

To change the model, edit `MODEL` in `suggest.js`.

**Endpoint access control (done — auth gate).** `/api/suggest` now **requires a
verified-email Firebase Auth ID token**: `backend/index.js` verifies the
`Authorization: Bearer` token with `firebase-admin` (401 missing/invalid, 403
unverified) before any work, so anonymous scripts can't spend your Gemini quota.
A signed token can't be forged the way the Origin header can — the Origin
allowlist is now just a cheap extra deterrent, not the real lock. In the UI, AI
suggestions are gated behind sign-in (`AuthForm` replaces `SuggestOptions` until
signed-in-and-verified); **voting stays account-free** and never touches auth.
Toggle the verified-email requirement via `EMAIL_VERIFICATION_REQUIRED`
(`backend/index.js`) + `REQUIRE_EMAIL_VERIFICATION` (`utils/flags.js`) — keep them
in sync. To enable this in prod, turn on the **Email/Password** provider in the
Firebase console (see `RUNBOOK.md` → One-time setup).

**Still deferred (endpoint abuse):** per-account / per-IP **rate limiting** (a
scripted verified account can still loop) and — now largely redundant given the
token — tightening the Origin gate. **Firebase App Check** is superseded for this
app by the auth requirement (keep it in mind only if an anonymous flow is ever
added). Full write-up: `~/.claude/plans/vivid-baking-babbage.md`.

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
