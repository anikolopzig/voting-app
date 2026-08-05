# TODO — GroupVote

Running list of notes and ideas for the app. Newest thinking at the top of each
item; check things off rather than deleting them, so the reasoning survives.

---

## Notes on app

### 1) Status as an emoji on the member circle

Turn the per-person status (**Deciding · Voted · Editing**) into a small emoji
badge on the **bottom-right of each member circle**, the way Instagram shows the
"typing" indicator on an avatar.

- Today the status is text-only, and only inside the roster
  (`ParticipantsList.jsx`).
- Target: it rides on the `VoterDot` itself, so it's visible in the pinned
  `MemberStack` (top-right) without opening the popover.
- Decide: which emoji per state, and whether the badge also shows on the
  per-voter dots drawn on the result bars (probably not — everyone there has
  voted by definition).

### 2) Changing options → changing votes → incomplete ballots

Figure out what should happen when the option set changes **after** people have
already voted.

- Ministers+ can edit options live, so a submitted ballot can end up missing a
  score for a newly added option (an "incomplete ballot").
- Today: stale scores for removed options are ignored by `ResultsSection`, and
  `VotingSection` remounts on the option set — but there's no defined behaviour
  for a submitted vote that no longer covers every option.
- Decide: does the ballot get invalidated (back to unsubmitted), partially
  counted, or counted with the missing options skipped? And how is that
  communicated to the voter and to everyone watching the results?

### 3) Replace the "new" with the NEW pill on the options

### Code review:  Code review(xhigh · 15 findings)

> Step-by-step fix plan for all 15 (copy-paste-ready): see [FIXPLAN.md](FIXPLAN.md).
>
> **Status (2026-07-30):** 10 fixed, 5 deferred by request (#5, #11, #14, #6, #9).
> Fixed items verified via a clean `npm run build` (70 modules) + a node logic
> suite (`scratchpad/verify.mjs`, 9 checks). Deferred = the VotingSection remount
> refactor (#5/#11), index-key focus glitch (#14), and the creator-leave/role-VIP
> cleanup (#6/#9) — see FIXPLAN.md for their ready-to-apply steps.

✅ FIXED (#1) frontend/src/components/JoinRoom.jsx — Name-uniqueness check only looks at room.votes + creatorName, never room.participants, so a name already claimed by a joined-but-not-yet-voted person is treated as free. → now checks the full roster via getParticipantNames(room).
✅ FIXED (#2) frontend/src/components/CreateRoom.jsx — Free-text option labels are used directly as Firebase keys (optionAuthors[label], and scores[label] on every vote), but RTDB keys may not contain . # $ [ ] / — so such labels make the write throw. → new utils/keys.js isValidKey() rejects bad labels in CreateRoom, OptionsEditor, and both AI-accept paths.
✅ FIXED (#3) frontend/src/components/CreateRoom.jsx + JoinRoom.jsx — Participant/creator names are lowercased but not sanitized before being used as Firebase keys (status/{name}, votes/{name}, participants/{name}); a name containing '.' (or # $ [ ] /) is an invalid key. → both create and join now reject names failing isValidKey().
✅ FIXED (#4) frontend/src/components/VotingSection.jsx — handleClick assumes onSubmit throws on failure, but Room.jsx's submitVotes catches its own error and resolves; so setEditing(false) runs even when the write failed, showing the ballot as saved. → Room submit/editVotes now rethrow after the banner; handleClick catches and stays in the current mode so the user can retry.
⏸️ DEFERRED (#5) frontend/src/pages/Room.jsx — VotingSection is keyed on room.options.join('|'); a concurrent option edit by a minister changes room.options, flipping the key and forcing a remount that re-seeds ballot state from the last saved vote, discarding a voter's unsaved in-progress ratings. → NOT in this batch (highest-risk remount→reconcile refactor; steps in FIXPLAN.md #5/#11).
⏸️ DEFERRED (#6) frontend/src/utils/room.js — getParticipantNames unconditionally re-adds room.creatorName, which defeats Room.jsx leaveRoom() for the creator: deleting participants/creator and votes/creator cannot remove them from the roster or the denominator. → NOT in this batch (paired with #9; residual roleOf-creator-president fallback noted in FIXPLAN.md #6).
✅ FIXED (#7) frontend/src/components/VotingSection.jsx — Ranked-choice drop handler feeds Number(dataTransfer 'text/plain') into moveCard; a non-numeric payload yields NaN, which passes the `from == null` guard (NaN == null is false) and reaches next.splice(NaN, 1), where splice coerces NaN to index 0. → moveCard now guards both indices with Number.isInteger; onDrop parses with parseInt and ignores non-integer payloads (e.g. the 'vip' badge).
✅ FIXED (#8) frontend/src/pages/Room.jsx + SuggestOptions.jsx — Room.removeSuggestion refuses (with only an error banner) when removing would drop below 2 options, but SuggestOptions.reject has already marked the suggestion 'rejected' and does not roll that back, so a rejected AI option can remain live on the ballot (same root cause in SuggestOptions.jsx:58). → removeSuggestion (both hosts) now returns a boolean; reject awaits it and only marks rejected when the removal actually succeeded.
● frontend/src/pages/Room. [correctne — leaveRoom() only nulls participants/{name} and votes/{name}; it never clears the departing member's status/{name} role override or the room-level vip pointer, so those references dangle after they leave — a later joiner reusing the freed name silently inherits them.
✅ FIXED (#10, docs) frontend/src/components/ResultsSection.jsx — The `ended` gate that suppressed the winner/tie label until the poll closed was removed; the leading option is now badged "Top pick" during live voting. (This is the intended redesign behavior, but CLAUDE.md still documents 'label only when ended', so the docs are out of sync — convention 15.) → per user, live "Top pick" IS intended; CLAUDE.md updated to document it (no code change).
⏸️ DEFERRED (#11) frontend/src/pages/Room.jsx + OptionsEditor.jsx — VotingSection is remounted via key={room.options.join('|')} (and OptionsEditor tracks changes via the same join('|') signature at lines 18/20); '|' is a legal character in an option label, so two distinct option sets can join to the identical string and the key/signature does not change when it should. → NOT in this batch (coupled with #5; JSON.stringify-signature fix in FIXPLAN.md #11).
✅ FIXED (#12) frontend/src/components/ResultsSection.jsx — geomean compute does scores.reduce((a,b)=>a+Math.log(b)); Math.log(0) is -Infinity, so a single 0 score makes the sum -Infinity and Math.exp(-Infinity)=0, collapsing the option's value. → computeResults now clamps each score into [1,10] and skips NaN at the data boundary (also keeps bars/dots in range for all methods).
✅ FIXED (#13) frontend/src/components/SuggestOptions.jsx — AI suggestion results are rendered with key={s.label} and decisions are keyed by s.label, but parseSuggestions() does not deduplicate labels, so two suggestions sharing a label collide. → handleSuggest now dedupes results case-insensitively before setResults, so keys/decisions are unique.
⏸️ DEFERRED (#14) frontend/src/components/OptionsEditor.jsx + CreateRoom.jsx:167 — Editable option rows use the array index as React key (key={i}) here and in CreateRoom.jsx:167; on removal of a non-last row React reconciles inputs by position, not identity. → NOT in this batch (cosmetic focus glitch, no data loss; stable-id refactor in FIXPLAN.md #14).
✅ FIXED (#15) frontend/src/pages/Room.jsx + utils/room.js — remainingMs = Math.max(0, room.expiresAt - now); the 0-floor does not guard NaN — Math.max(0, NaN) returns NaN — so a missing/non-numeric expiresAt propagates NaN into the countdown. → isRoomClosed treats a malformed expiresAt as closed; remainingMs guards with Number.isFinite (falls back to 0).
---

## Room page UX review (2026-08-04)

Walk-through of `/room/:code` looking for changes that make the experience
better. Grouped by priority; each item states the problem (with the code it
lives in), why it matters, and the proposed change. Nothing here is implemented
yet — these are proposals, not decisions.

Theme of the P0s: the page currently **loses work, loses time, and loses
people**.

### P0 — Real losses today

- [ ] **P0-1 · A shared room link dead-ends.** `Room.jsx:44-46` — opening
  `/room/ABC123` without an identity does `navigate('/', { replace: true })`,
  which drops the code. The invited person lands on an empty join form and has
  to ask for the code again. Compounding it, `copyCode` (`Room.jsx:282`) copies
  only the 6 characters, so sharing is manual either way.
  → Copy an **invite link** (`/room/CODE`) instead of / alongside the bare code,
  and make the no-identity redirect **carry the code to Home** so `JoinRoom`
  pre-fills it and only the name is left to type. **Effort: S.** Biggest funnel
  leak on the page.

- [ ] **P0-2 · Editing options wipes everyone's in-progress ballot.**
  `Room.jsx:406` remounts `VotingSection` via `key={room.options.join('|')}`,
  and the component seeds its state once at mount (`VotingSection.jsx:63-64`)
  from `myVote` — which is `null` for anyone who hasn't submitted yet. So the
  moment any minister adds or renames an option, every voter mid-slide snaps
  back to the default 5s, silently. The stale-ballot nudge covers people who
  *had* submitted; this is the opposite case and is uncovered.
  → Drop the remount key and **reconcile in a `useEffect`**: keep existing local
  scores, seed only newly added labels, drop removed ones. **Effort: M.**
  NOTE: this is the same refactor as deferred code-review findings **#5 and
  #11** — ready-to-apply steps already written up in
  [FIXPLAN.md](FIXPLAN.md) (#11 also fixes the `'|'`-in-a-label signature
  collision, so do them together).

- [ ] **P0-3 · "Leave room" is irreversible and unconfirmed.** `leaveRoom`
  (`Room.jsx:263`) deletes presence **and the person's submitted vote**, then
  clears their identity — one click, no confirmation, from a red pill sitting
  right next to the roster caret in the pinned topbar. `closePoll` and
  `promoteToPresident` both confirm, and this is more destructive than either.
  → Add a confirm that names the consequence ("your vote will be removed").
  **Effort: S.** (Related: deferred #6/#9 — leaving also leaves a dangling
  `status/{name}` override and VIP pointer behind.)

### P1 — The 15-minute clock

- [ ] **P1-4 · The countdown scrolls away.** It lives in `.room-header`
  (`Room.jsx:374`) while the topbar is the thing that's pinned — so the most
  time-critical fact on the page is the first to disappear. Same for the code
  chip: sharing with a late joiner means scrolling back up.
  → Move a compact **countdown + "3/5 voted" + code chip** into the pinned
  `.room-topbar`. **Effort: M** (mostly CSS). Side benefit: the topbar starts
  carrying room context instead of only presence.

- [ ] **P1-5 · No warning, then a hard stop.** Expiry flips `VotingSection`
  straight to "🔒 Voting has ended" (`VotingSection.jsx:74`), and `Countdown`
  only turns red under 60s (`Countdown.jsx:6`). Anyone still editing loses an
  unsubmitted ballot with no notice.
  → Warn at **T-2min**, and make it *specific* for people whose ballot isn't
  submitted ("your votes aren't counted yet"). **Effort: S.**

- [ ] **P1-6 · No way to extend the room.** `expiresAt` is only ever read
  client-side (`room.js:6-12`), so nothing stops a president writing a later
  value.
  → President-only **"+5 minutes"** beside Close Poll. **Effort: S.** Today a
  group that hits the buzzer mid-discussion has to abandon the room and retype
  the whole question + option set.

- [ ] **P1-7 · Close Poll is locked for 3 minutes even when everyone is done.**
  `Room.jsx:320-321` is a pure time gate (`CLOSE_UNLOCK_MS`).
  → Unlock early once **every participant has submitted** (keep the 3-min floor
  otherwise), and surface an "everyone's voted" moment so the room has a natural
  point of closure. **Effort: S.**

### P2 — Hierarchy and the ending

- [ ] **P2-8 · Ministers/presidents get the ballot pushed below the fold.**
  `OptionsEditor` and `SuggestOptions` both render expanded, above
  `VotingSection` (`Room.jsx:391-402`). On mobile a president scrolls past two
  editing cards to reach the thing the room exists for.
  → Collapse `OptionsEditor` behind a disclosure, matching how `SuggestOptions`
  already behaves. **Effort: S.**

- [ ] **P2-9 · The room ends with nowhere to go.** Once ended there's no summary
  framing and no next step — to run another round the group must leave, create a
  room, and retype the question and every option.
  → An ended banner that states the outcome, plus **"Run this vote again"**
  pre-filling `/create` with the same question + options (Home→Create already
  hands off state this way). **Effort: M.**

### Deliberately NOT changing

Per-viewer evaluator method (not synced), the live "Top pick" badge,
caveat-only partial coverage (flag it, don't re-rank), name-hashed participant
colors, lowercase-everywhere keys, and guarded writes → `ErrorBanner`. All are
existing intentional decisions — see CLAUDE.md.

### Suggested order

P0-1 → P0-3 → P0-2 (roughly half the value; only P0-2 is non-trivial, and it
retires two deferred findings), then P1-4…P1-7 as one "clock" batch, then P2.
Each item is independently shippable. CLAUDE.md gets updated in the same change,
per the repo's own rule.

---

## Auth sign-up / sign-in feedback — silent rejections (2026-08-04)

Observed while testing the AI-suggestions sign-in gate: creating an account and
signing in gave **no visible success or failure** — the AI panel just stayed
locked with no message, so a failed attempt, a successful-but-unverified one, and
a plain no-op all looked identical. (Root cause of the "no email ever arrives"
part was separately the Auth *emulator*, which only logs verification links — see
`RUNBOOK.md` pitfall #13 and the dev-verify tooling below.)

**Addressed this session** (`AuthForm.jsx` / `AuthPill.jsx`):
- All `auth/*` errors now surface via `messageFor()` (wrong password, email in
  use, weak password, invalid email, network, too-many-requests).
- The signed-in-but-unverified state is now an explicit "You're signed in as X —
  one more step" verify card instead of a silent locked panel.
- "I've verified — refresh" now reports back when you're *still* unverified
  instead of doing nothing.
- Dev-mode note + "⚡ Verify now (dev)" so the emulator's no-real-email behavior
  isn't mistaken for a failure.

**Still open (residual silent / ambiguous paths):**
- [ ] **Sign-up success is implicit.** On success `createUserWithEmailAndPassword`
  immediately signs the user in, so the form re-renders into the verify card
  before the "Account created" notice is guaranteed to show — positive
  confirmation rides on the card swap, which a user may not read as "it worked."
  Want a persistent, unmissable success state.
- [ ] **create-succeeds / verify-send-fails edge.** If the create call succeeds
  but the following `sendEmailVerification` throws (rate limit / network), the
  account exists and the user is signed in, yet an *error* is shown — mixed
  signals. Decide: retry the send, or show "account created, but we couldn't send
  the link — Resend."
- [ ] **Prod verification-email non-delivery is unsurfaced.** Live (not the
  emulator), a real email can be spam-filtered or dropped; the UI just waits with
  no delivery confirmation and no "didn't get it?" guidance beyond Resend.
- [ ] **No client-side pre-checks.** Obvious rejections (password < 6 chars,
  malformed email) round-trip to Firebase instead of showing instantly. Cheap
  inline validation would make the rejection feel immediate rather than "silent
  then a beat later."

---

