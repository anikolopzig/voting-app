# FIXPLAN — correctness bugs from the code review

Implementation-ready plan for the **15 correctness findings** recorded under
"Code review" in `TODO.md`. Each entry gives the exact file/line, the root cause,
a **copy-paste-ready** change (current → replacement), the other files it ripples
into, edge cases / residual risk, and how to verify it. The goal: enough detail
that applying the fix is mechanical.

> Scope: these 15 are all the `correctness` findings. The review also produced 4
> cleanup items (efficiency/simplification — `getIdentity` re-reads, duplicated
> roster sort, duplicated option validation, dead `ModeToggle` code) and 1 refuted
> item (suggestion-dedup loop). Those are **out of scope here** — this plan is
> correctness only.

No commits are made by this plan (the repo has no commits; nothing should be
committed unless the user asks). After finishing, re-run the code review's
`ReportFindings` with a per-finding `outcome`.

---

## Shared prep (do these first — several fixes reuse them)

### New file: `frontend/src/utils/keys.js`  (needed by #2, #3)

Realtime Database keys may not contain `. # $ [ ] /` and may not be empty. We use
free-text option labels and lowercase names **directly** as keys, so validate at
every input boundary.

```js
// Firebase Realtime Database forbids these characters in a key, and keys can't be
// empty. We use option labels and lowercase names directly as keys
// (optionAuthors[label], scores[label], votes/{name}, status/{name}), so a value
// containing one of these would make the write throw. Validate at input time.
const FORBIDDEN_RE = /[.#$\[\]\/]/;

export const FORBIDDEN_KEY_HINT = '. # $ [ ] /';

export function isValidKey(str) {
  return typeof str === 'string' && str.length > 0 && !FORBIDDEN_RE.test(str);
}
```

### Recommended implementation order (low-risk first; shared infra grouped)

1. **#15** countdown NaN guard — tiny, isolated
2. **#12** clamp scores to [1,10] — tiny, isolated
3. **#1** join name-uniqueness — tiny
4. **#2 + #3** invalid-key validation (add `keys.js`) — small, grouped
5. **#7** ranked-drop NaN guard — small
6. **#13** dedup AI suggestions — small
7. **#9 + #6** leave clears status/vip; roster stops forcing creator — small, grouped
8. **#4** honest submit/edit failure — small
9. **#8** rejected-suggestion rollback — small/medium
10. **#10** Top-pick label — **decision** (default: doc-only)
11. **#11 (+ #5)** option-set signature + no data-loss remount — **highest risk, do last with testing**
12. **#14** stable keys on editable rows — cosmetic, optional/last

---

## #1 — Join lets an already-present name be claimed twice
`frontend/src/components/JoinRoom.jsx:42` · CONFIRMED

**Root cause.** Uniqueness only checks `room.votes` + `creatorName`; a person who
joined (wrote presence) but hasn't voted yet isn't in `votes`, so a second person
can claim the same name. Both share identity and overwrite each other's votes.

**Fix.** Check the full roster via `getParticipantNames` (creator + participants +
votes), which is already the single source of truth.

Current (lines 39–45):
```js
      const lowerName = trimmedName.toLowerCase();
      const voterNames = Object.keys(room.votes || {});
      // The creator's name is reserved even before they cast a vote.
      if (lowerName === room.creatorName || voterNames.includes(lowerName)) {
        setBusy(false);
        return setLocalError('That name is already taken in this room.');
      }
```
Replacement:
```js
      const lowerName = trimmedName.toLowerCase();
      // Reserve any name already in the room — creator, present-but-not-voted, or
      // voted — not just names that already have a vote entry.
      if (getParticipantNames(room).includes(lowerName)) {
        setBusy(false);
        return setLocalError('That name is already taken in this room.');
      }
```
Import change (line 6):
```js
import { isRoomClosed, getParticipantNames } from '../utils/room.js';
```

**Residual.** Two people racing to join the same name both read before either
writes presence → TOCTOU still theoretically possible. A hard fix needs a
transaction; not worth it for a demo on world-writable rules. This closes the
common case (join, then someone else tries the same name).

**Verify.** Tab A joins as "sam" (don't vote). Tab B tries to join room as "Sam" →
"already taken". Before the fix, Tab B was allowed in.

---

## #2 — Option labels used as Firebase keys can crash the write
`frontend/src/components/CreateRoom.jsx:115` (also `Room.jsx:177`, `OptionsEditor`) · CONFIRMED

**Root cause.** Labels are used as keys in `optionAuthors[label]` and each vote's
`scores[label]`. A label like `Bar/Grill`, `$5 menu`, or `7.5/10 spot` contains a
forbidden char → `set()`/`update()` throws.

**Fix.** Reject option labels that aren't valid keys, at every place options are
entered. Uses `keys.js` from Shared prep.

**a) `CreateRoom.jsx` — `handleSubmit`.** After the uniqueness check (after line
104), before `setBusy(true)`:
```js
    const badOption = trimmedOptions.find((o) => !isValidKey(o));
    if (badOption) {
      return setLocalError(`Options can’t contain any of these characters: ${FORBIDDEN_KEY_HINT}`);
    }
```
Import (add near line 8):
```js
import { isValidKey, FORBIDDEN_KEY_HINT } from '../utils/keys.js';
```

**b) `OptionsEditor.jsx` — `save`.** After the uniqueness check (after line 49):
```js
    const badOption = trimmed.find((o) => !isValidKey(o));
    if (badOption) {
      return setLocalError(`Options can’t contain any of these characters: ${FORBIDDEN_KEY_HINT}`);
    }
```
Import at top of `OptionsEditor.jsx`:
```js
import { isValidKey, FORBIDDEN_KEY_HINT } from '../utils/keys.js';
```

**c) AI accept paths (defense in depth).** In `CreateRoom.acceptSuggestions`
(line 54) and `Room.acceptSuggestions` (line 204), also require a valid key so an
AI label like `Bar/Grill` is skipped rather than written:
```js
        if (label && isValidKey(label) && !present.has(key)) {
```
(Add the same import to `Room.jsx`.)

**Edge cases.** maxLength on labels is 60, so length isn't a concern. Existing
rooms can't already contain bad keys (they'd never have been created).

**Verify.** Create a room with an option `Bar/Grill` → inline error, no crash. In
a room, open the editor, rename an option to `A.B` → inline error.

---

## #3 — Participant/creator names used as keys aren't validated
`frontend/src/components/CreateRoom.jsx:110` and `JoinRoom.jsx` · CONFIRMED

**Root cause.** Names are lowercased but not char-validated before use as keys
(`status/{name}`, `votes/{name}`, `participants/{name}`). `Mr. T` → `mr. t`
(has `.`) → invalid key → create fails, or in-room presence/vote writes throw.

**Fix.** Validate the lowercased name at both entry points, using `keys.js`.

**a) `CreateRoom.jsx` — `handleSubmit`.** Near the other validations (after line
96, `if (!trimmedName) …`):
```js
    if (!isValidKey(trimmedName.toLowerCase())) {
      return setLocalError(`Your name can’t contain any of these characters: ${FORBIDDEN_KEY_HINT}`);
    }
```
(Import already added in #2.)

**b) `JoinRoom.jsx` — `handleSubmit`.** Right where `lowerName` is derived (from
#1's replacement block):
```js
      const lowerName = trimmedName.toLowerCase();
      if (!isValidKey(lowerName)) {
        setBusy(false);
        return setLocalError(`Your name can’t contain any of these characters: ${FORBIDDEN_KEY_HINT}`);
      }
```
Import in `JoinRoom.jsx`:
```js
import { isValidKey, FORBIDDEN_KEY_HINT } from '../utils/keys.js';
```

**Alternative (bigger, not recommended now).** Decouple display name from key:
store a sanitized key + a separate display name. That's a schema change touching
every name read; the validate-and-reject approach above is the pragmatic fix.

**Verify.** Create as `Mr. T` → inline error. Join as `a/b` → inline error.

---

## #4 — Ballot shows "saved" even when the write failed
`frontend/src/components/VotingSection.jsx:117` (+ `Room.jsx:92,99`) · CONFIRMED

**Root cause.** `Room.submitVotes`/`editVotes` catch their own error and **resolve**,
so `VotingSection.handleClick`'s `await onSubmit(...)` never rejects and
`setEditing(false)` runs regardless — the UI claims the ballot was saved.

**Fix (two coordinated edits).**

**a) `Room.jsx` — rethrow after showing the banner** (lines 92–106):
```js
  async function submitVotes(scores) {
    try {
      await set(ref(db, `rooms/${roomCode}/votes/${identity}`), { scores, submitted: true });
    } catch (err) {
      setError(err.message || 'Failed to submit your votes.');
      throw err; // let VotingSection keep the ballot editable so the user can retry
    }
  }
  async function editVotes(scores) {
    try {
      await set(ref(db, `rooms/${roomCode}/votes/${identity}`), { scores, submitted: false });
    } catch (err) {
      setError(err.message || 'Failed to update your votes.');
      throw err;
    }
  }
```

**b) `VotingSection.jsx` — don't flip state on failure** (lines 111–125):
```js
  async function handleClick() {
    setBusy(true);
    try {
      const payload = currentScores();
      if (editing) {
        await onSubmit(payload); // writes { scores, submitted: true }
        setEditing(false);
      } else {
        await onEdit(payload); // writes submitted: false so it stops counting
        setEditing(true);
      }
    } catch {
      // Write failed (Room already surfaced the banner). Stay in the current
      // mode so the user can retry — never falsely mark the ballot as saved.
    } finally {
      setBusy(false);
    }
  }
```
Both edits are required together: rethrow alone → unhandled rejection; the `catch`
alone catches nothing because the write currently resolves.

**Verify.** Temporarily point the DB write at an invalid path (or go offline),
click Submit → banner shows AND the button stays "Submit Votes" (not "Edit Votes").

---

## #5 — Concurrent option edit discards a voter's unsaved ratings
`frontend/src/pages/Room.jsx:376` (the `key`) · CONFIRMED · **do with #11**

**Root cause.** `<VotingSection key={room.options.join('|')}>` remounts whenever
the option set changes. A minister editing options mid-vote flips the key → remount
→ `VotingSection` re-seeds from the last **saved** vote, throwing away the voter's
in-progress (unsaved) slider/rank changes.

**Fix.** Stop remounting; reconcile option changes **in place** so surviving
options keep their current in-progress values. This shares the collision-free
signature from #11 — implement the two together.

**a) `Room.jsx`** — remove the remount key (line 376). Update the nearby comment
(lines 374 and the file-map note) since the key no longer exists:
```js
          {/* VotingSection reconciles option-set changes internally (no remount),
              so a concurrent edit never discards a voter's unsaved ratings. */}
          <VotingSection
            options={room.options}
```

**b) `VotingSection.jsx`** — add a reconcile effect. Imports (line 1):
```js
import { useEffect, useRef, useState } from 'react';
```
Add after the existing `useState` declarations (after line 72), replacing the
mount-once assumption:
```js
  // Reconcile when the shared option set changes (a minister edited it) WITHOUT a
  // remount: keep the voter's current in-progress score for surviving options,
  // default new ones, drop removed ones. JSON.stringify (not join('|')) so labels
  // containing '|' can't collide into the same signature — see #11.
  const optionSig = JSON.stringify(options);
  const seededSig = useRef(optionSig);
  useEffect(() => {
    if (optionSig === seededSig.current) return;
    seededSig.current = optionSig;
    setScores((prev) => {
      const out = {};
      for (const opt of options) {
        out[opt] =
          typeof prev[opt] === 'number'
            ? prev[opt]
            : typeof myVote?.scores?.[opt] === 'number'
            ? myVote.scores[opt]
            : DEFAULT_SCORE;
      }
      return out;
    });
    setOrder((prev) => {
      const survivors = prev.filter((o) => options.includes(o));
      const added = options.filter((o) => !prev.includes(o));
      return [...survivors, ...added];
    });
    // If the change made an already-submitted ballot stale, re-open editing so the
    // voter can rate the new option(s) — the remount used to do this implicitly.
    if (hasSubmitted && unratedOptions(myVote, options).length > 0) setEditing(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionSig]);
```
`unratedOptions`, `DEFAULT_SCORE`, `hasSubmitted`, `myVote`, `options` are already
in scope. The initial `useState` seeding still handles first mount; `stale`,
`unrated`, `unratedSet` are derived from props every render, so they keep working.

**Risk.** This is the largest behavioral change. Test the two-tab concurrent case
carefully (below).

**Verify.** Tab A (voter): move a slider but DON'T submit. Tab B (minister): add an
option. Tab A: the in-progress slider value is preserved, the new option appears at
default 5, and (if A had already submitted) editing re-opens with the stale nudge.
Before the fix, A's unsaved change was lost.

---

## #6 — Creator can't actually leave the roster
`frontend/src/utils/room.js:19` · CONFIRMED · **do with #9**

**Root cause.** `getParticipantNames` unconditionally re-adds `room.creatorName`.
So `leaveRoom()` (which nulls `participants/creator` + `votes/creator`) can't remove
the creator from the roster or the "N of M" denominator — they're re-added every
render.

**Fix.** Rely on presence + votes (both written on room entry, for everyone
including the creator) instead of force-including the creator.

Current (lines 15–24):
```js
export function getParticipantNames(room) {
  if (!room) return [];
  return Array.from(
    new Set([
      room.creatorName,
      ...Object.keys(room.participants || {}),
      ...Object.keys(room.votes || {}),
    ])
  ).filter(Boolean);
}
```
Replacement:
```js
export function getParticipantNames(room) {
  if (!room) return [];
  // Presence is written on room entry (Room.jsx) and a submitted vote persists, so
  // the creator is covered like everyone else — do NOT force-add creatorName, or
  // they can never leave the roster/denominator.
  return Array.from(
    new Set([
      ...Object.keys(room.participants || {}),
      ...Object.keys(room.votes || {}),
    ])
  ).filter(Boolean);
}
```
Also update the function's doc comment (lines 11–14) to drop "the creator" from
the enumerated sources.

**Residual.** `roleOf` still returns `president` for `creatorName` via the creator
fallback (`roles.js:64`). So if the creator leaves and someone later joins under
the creator's freed name, they'd become president. That's inherent to the
"creator is always president" design and separate from this fix — flag it; a real
fix would require a stored "creator left" marker. #9 clears explicit overrides but
not this fallback.

**Verify.** Creator opens the room, clicks Leave → in a watching second tab the
creator disappears from the roster and the denominator drops. Before the fix, the
creator lingered.

---

## #7 — Ranked-choice drop can corrupt the order with NaN
`frontend/src/components/VotingSection.jsx:162` · CONFIRMED

**Root cause.** `onDrop` runs `moveCard(Number(dataTransfer 'text/plain'), i)`. A
non-numeric payload (dragging the VIP `★` badge, whose data is `'vip'`, or dropping
selected text) → `Number(...)` = NaN. `moveCard`'s guard `from == null` is false
for NaN, and `splice(NaN, 1)` coerces to index 0 — removing/reinserting the first
card and scrambling the ranking.

**Fix.** Harden both the guard and the drop parse.

`moveCard` (lines 90–98):
```js
  function moveCard(from, to) {
    setOrder((prev) => {
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from === to ||
        from < 0 ||
        from >= prev.length ||
        to < 0 ||
        to >= prev.length
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }
```
`onDrop` (lines 160–164):
```js
                onDrop={(e) => {
                  e.preventDefault();
                  const from = Number.parseInt(e.dataTransfer.getData('text/plain'), 10);
                  if (Number.isInteger(from)) moveCard(from, i);
                  setDragIndex(null);
                }}
```
The ▲▼ buttons pass real indices, still valid; the tightened guard also blocks the
existing `i - 1 = -1` case cleanly.

**Verify.** In rank mode, drag the `★ VIP` badge (as president) onto a rank card →
order is unchanged (before the fix, the first card jumped). Normal drag-reorder
still works.

---

## #8 — Rejecting an accepted AI option can leave it live
`frontend/src/pages/Room.jsx:226` + `SuggestOptions.jsx:58` · CONFIRMED

**Root cause.** In-room, `SuggestOptions.reject` marks the decision `'rejected'`
and calls `onRemove(label)`. But `Room.removeSuggestion` refuses (banner only) when
removal would drop below 2 options — with no rollback in `SuggestOptions`, so the
option stays on the ballot while the UI shows it rejected. (`CreateRoom.removeSuggestion`
never refuses — it pads to 2 — so this only bites in-room.)

**Fix.** Make `onRemove` report success and only mark rejected when it actually
removed.

**a) `Room.jsx` — `removeSuggestion` returns a boolean** (lines 220–238):
```js
  async function removeSuggestion(label) {
    if (!canEditOptions(room, identity)) return false;
    const key = (label || '').trim().toLowerCase();
    const current = room.options || [];
    const next = current.filter((o) => o.trim().toLowerCase() !== key);
    if (next.length === current.length) return false; // wasn't in the list
    if (next.length < 2) {
      setError('A room needs at least 2 options.');
      return false;
    }
    try {
      await update(ref(db, `rooms/${roomCode}`), {
        options: next,
        optionAuthors: authorsFor(next),
      });
      return true;
    } catch (err) {
      setError(err.message || 'Failed to remove the option.');
      return false;
    }
  }
```

**b) `CreateRoom.jsx` — `removeSuggestion` returns true** (add a `return true;` at
the end of the function, lines 78–86) so both hosts share the contract.

**c) `SuggestOptions.jsx` — `reject` awaits and only marks on success** (lines
58–62):
```js
  async function reject(label) {
    if (decisions[label] === 'rejected') return;
    if (decisions[label] === 'accepted') {
      const ok = await onRemove?.(label);
      if (ok === false) return; // couldn't remove (e.g. would drop below 2) — keep it accepted
    }
    setDecisions((d) => ({ ...d, [label]: 'rejected' }));
  }
```
`await undefined` (no `onRemove`) yields `undefined`, which is not `=== false`, so
undecided/accepted-in-create flows still mark rejected.

**Verify.** In a room with exactly 2 options, accept an AI suggestion (now 3), then
reject it → it's removed and shows rejected. Now bring it back to 2 options and try
rejecting one of the 2 accepted ones → banner appears AND the item stays shown as
accepted (not falsely rejected).

---

## #9 — Leaving leaves dangling role/VIP that a new joiner inherits
`frontend/src/pages/Room.jsx:245` · CONFIRMED (privilege escalation) · **do with #6**

**Root cause.** `leaveRoom()` nulls only `participants/{name}` and `votes/{name}`.
It never clears the leaver's `status/{name}` role override or the room `vip`
pointer if it was them. A later joiner reusing the freed name silently inherits
president/minister powers and/or the double-weight VIP.

**Fix.** Clear the role override and VIP in the same multi-path update (lines
244–248):
```js
    try {
      const updates = {
        [`participants/${identity}`]: null,
        [`votes/${identity}`]: null,
        [`status/${identity}`]: null, // drop any role override so a reused name doesn't inherit it
      };
      if (room.vip === identity) updates.vip = null; // clear dangling VIP pointer
      await update(ref(db, `rooms/${roomCode}`), updates);
    } catch {
      // Non-fatal — go home regardless.
    }
```

**Residual.** For the creator, `status/{creator}` = null removes the explicit
override, but `roleOf` still treats `creatorName` as president via its fallback
(see #6 residual). Strictly better regardless: clears overrides for everyone and
clears a dangling VIP.

**Verify.** President promotes "sam" to minister, makes "sam" VIP. "sam" leaves.
A new tab joins as "sam" → they are a plain voter and are not VIP. Before the fix,
they inherited both.

---

## #10 — "Top pick" shows during live voting (docs out of sync)
`frontend/src/components/ResultsSection.jsx:127` · CONFIRMED · **decision required**

**Root cause / status.** The `ended` gate that hid the winner label until close was
removed; the leader is now badged **"Top pick"** during live voting. Per the
review this is the **intended redesign behavior** — but `CLAUDE.md` still says
"winner/tie highlight (label only when ended)", so the docs are out of sync.

**Default fix (recommended): update the docs to match the code.**
- In `CLAUDE.md`, the `ResultsSection.jsx` file-map line currently reads:
  `bars, winner/tie highlight (label only when ended).`
  Change to something like:
  `bars, winner/tie highlight; the leader is badged "Top pick" live and "Winner"/"Tie" once ended.`
- Grep for any other "only when ended" wording and reconcile:
  `grep -rn "when ended" CLAUDE.md`

**Alternative (only if you want to suppress the live winner label):** re-add the
gate in `ResultsSection.jsx` — render the badge only when `ended`:
```js
                  {isWinner && ended && (
                    <span className="badge">{isTie ? 'Tie' : 'Winner'}</span>
                  )}
```
This reduces bandwagon pressure when few have voted but changes the intended UX.

**This is the one finding where the code may be correct as-is.** Confirm with the
user which they want; default to the doc update.

---

## #11 — Two different option sets can share the same signature
`frontend/src/pages/Room.jsx:376` and `OptionsEditor.jsx:18,21` · CONFIRMED · **do with #5**

**Root cause.** `'|'` is a legal option-label char, so `['A|B','C'].join('|')`
=== `['A','B|C'].join('|')` === `'A|B|C'`. The join signature is used as
`VotingSection`'s remount key AND as `OptionsEditor`'s re-seed signature — so a
genuine change that keeps the same joined string produces no remount/re-seed, and
editor & ballots silently diverge.

**Fix.** Use `JSON.stringify(options)` (arrays of strings serialize distinctly)
everywhere the option set is signed.

- **`VotingSection.jsx`** — already handled by #5's reconcile effect (it uses
  `JSON.stringify(options)` as the signature; the remount key in `Room.jsx` is
  removed there).
- **`OptionsEditor.jsx`** — replace both `options.join('|')` occurrences:
  - line 18: `const seededSig = useRef(JSON.stringify(options));`
  - lines 19–25:
    ```js
      useEffect(() => {
        const sig = JSON.stringify(options);
        if (sig !== seededSig.current) {
          seededSig.current = sig;
          setDraft([...options]);
        }
      }, [options]);
    ```

**Minimal alternative if you decline #5's refactor.** Keep the remount but make the
key collision-free: `key={JSON.stringify(room.options)}` in `Room.jsx:376`. This
fixes #11 but leaves #5's unsaved-edit loss in place. Prefer the combined fix.

**Verify.** Create a room, rename options so `['A|B','C']` becomes `['A','B|C']`
(same join, different sets). The editor and each ballot re-seed to the new labels.
Before the fix, they didn't update.

---

## #12 — A 0 (or out-of-range) score breaks geomean / bars
`frontend/src/utils/scoring.js:26` · PLAUSIBLE

**Root cause.** `geomean` does `reduce((a,b)=>a+Math.log(b))`; `Math.log(0)` is
`-Infinity` → `exp(-Infinity)` = 0, collapsing the option. Input modes guarantee
[1,10], so this is only reachable via direct DB writes (world-writable test-mode
rules / the documented `curl`) — but it's cheap to defend, and it also keeps bars
in range.

**Fix (at the data boundary, covers all three methods + bars + dots).** In
`ResultsSection.jsx` `computeResults`, clamp each score into [1,10] and skip NaN
(lines 21–36):
```js
    for (const [name, v] of submitted) {
      const raw = v.scores?.[opt];
      if (typeof raw !== 'number' || Number.isNaN(raw)) continue;
      const s = Math.min(10, Math.max(1, raw)); // defend the [1,10] invariant
      count += 1;
      weighted.push(s);
      if (name === vip) weighted.push(s); // VIP vote counts double
      const bucket = Math.round(s * 4) / 4;
      const members = byBucket.get(bucket);
      if (members) members.push({ name, score: s });
      else byBucket.set(bucket, [{ name, score: s }]);
    }
```
(Only the first three lines change: `s` → `raw`, add the NaN skip and the clamp;
the rest reuses `s`.)

**Alternative.** Clamp inside each `compute` in `scoring.js`, e.g.
`Math.log(Math.max(1, b))`. The `computeResults` clamp is preferred — it also fixes
bar width and dot position for bad data, not just geomean.

**Verify.** Write a score of 0 via the documented `curl` PUT, submit another normal
vote, view results with the "Everyone content" method → the option shows a finite
value and an in-range bar (before: it collapsed to 0 / off-scale).

---

## #13 — Duplicate AI suggestion labels collide
`frontend/src/components/SuggestOptions.jsx:148` · PLAUSIBLE

**Root cause.** Results render `key={s.label}` and decisions are keyed by
`s.label`, but suggestions aren't deduped — two same-label results cause a React
key collision, and accept/reject on one marks both.

**Fix.** Dedup case-insensitively when results arrive, in `handleSuggest` (lines
36–41):
```js
      // Dedup by label (case-insensitive) so identical suggestions can't collide
      // on the React key or share an accept/reject decision.
      const seen = new Set();
      const unique = suggestions.filter((s) => {
        const k = (s.label || '').trim().toLowerCase();
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      setDecisions({});
      if (!unique.length) {
        setResults(null);
        setError('No suggestions came back — try adding a location or a hint.');
      } else {
        setResults(unique);
      }
```
Optional belt-and-suspenders: also dedup in `parseSuggestions` (`utils/suggestions.js`)
so the server response is clean at the source.

**Verify.** Hard to trigger naturally; simulate by temporarily returning two
identical labels from `requestSuggestions` — only one row renders and accept/reject
affects only it. No React "duplicate key" console warning.

---

## #14 — Index-as-key on editable option rows (focus glitch)
`frontend/src/components/OptionsEditor.jsx:66` and `CreateRoom.jsx:167` · PLAUSIBLE · **lowest priority (cosmetic)**

**Root cause.** Removable, controlled inputs use `key={i}`. Removing a non-last row
makes React reconcile inputs by position, not identity → focus/cursor lands on the
wrong field. No data loss (values are index-mapped consistently); purely a focus
glitch. This is the only non-data finding — safe to defer.

**Fix.** Give each row a stable id. Full recipe for `OptionsEditor.jsx` (draft
becomes `[{id, value}]`):
```js
import { useEffect, useRef, useState } from 'react';

export default function OptionsEditor({ options, onSave }) {
  const seq = useRef(0);
  const makeRow = (value = '') => ({ id: (seq.current += 1), value });
  const [draft, setDraft] = useState(() => options.map((o) => makeRow(o)));
  // ...
  const seededSig = useRef(JSON.stringify(options)); // (also #11)
  useEffect(() => {
    const sig = JSON.stringify(options);
    if (sig !== seededSig.current) {
      seededSig.current = sig;
      setDraft(options.map((o) => makeRow(o)));
    }
  }, [options]);

  function update(i, value) {
    setDraft((d) => d.map((row, idx) => (idx === i ? { ...row, value } : row)));
  }
  function add() { setDraft((d) => [...d, makeRow()]); }
  function remove(i) {
    setDraft((d) => (d.length <= 2 ? d : d.filter((_, idx) => idx !== i)));
  }

  const trimmed = draft.map((r) => r.value.trim()).filter(Boolean);
  const lowered = trimmed.map((o) => o.toLowerCase());
  const unchanged =
    trimmed.length === options.length && trimmed.every((o, i) => o === options[i]);
  // ...render: draft.map((row, i) => <div className="option-row" key={row.id}> ...
  //   value={row.value} onChange={(e) => update(i, e.target.value)} ... />
}
```
`save()` still calls `onSave(trimmed)` — the string-array contract to Firebase is
unchanged.

**`CreateRoom.jsx` ripple (larger).** `options` state feeds `SuggestOptions`
(`existing`), `acceptSuggestions`/`removeSuggestion`, and `handleSubmit`, all of
which map over strings. Converting to `[{id,value}]` touches all of them. Given the
low severity, either (a) apply the same object refactor consistently in CreateRoom,
or (b) leave CreateRoom's `key={i}` as-is and fix only OptionsEditor. Recommend
doing this fix **last**, or skipping CreateRoom if time-constrained — note whichever
you choose so it's not mistaken for "fully fixed".

**Verify.** In the editor with rows [A, B, C], focus row B's input, remove row A →
focus/caret stays sensible (before: it jumped). No functional change to saved
options.

---

## #15 — Missing/NaN `expiresAt` makes the countdown NaN and the room never ends
`frontend/src/pages/Room.jsx:295` (+ `room.js:6`) · PLAUSIBLE

**Root cause.** `remainingMs = Math.max(0, room.expiresAt - now)` — `Math.max(0, NaN)`
is `NaN`, so a missing/non-numeric `expiresAt` yields a NaN countdown, and
`isRoomClosed`'s `now > room.expiresAt` is `now > NaN` = false, so the room never
flips to "ended".

**Fix (two spots).**

**a) `room.js` — `isRoomClosed`** (lines 6–9), fail safe on malformed expiry:
```js
export function isRoomClosed(room, now = Date.now()) {
  if (!room) return false;
  if (room.closedAt != null) return true;
  const expires = Number(room.expiresAt);
  if (!Number.isFinite(expires)) return true; // malformed room → treat as closed
  return now > expires;
}
```

**b) `Room.jsx` — `remainingMs`** (line 295):
```js
  const expiresAt = Number(room.expiresAt);
  const remainingMs = Number.isFinite(expiresAt) ? Math.max(0, expiresAt - now) : 0;
```
With (a) making `ended` true for a malformed room, the header renders "Ended" and
`remainingMs` is a harmless 0.

**Verify.** Write a room with `expiresAt` removed (or set to a string) via the DB;
open it → it reads as "Ended" rather than a NaN countdown that never closes. A
normal room still counts down and ends at expiry.

---

## Global verification (after applying fixes)

```bash
export NVM_DIR=$HOME/.nvm && . "$NVM_DIR/nvm.sh"
cd frontend && npm run build      # must stay clean (~68 modules, no errors)
npm run dev                       # http://localhost:5173
```
Then walk the per-bug "Verify" steps above with two tabs joined as different names
(identity is per-tab). Confirm the browser console is error-free.

**Docs to update in the same change** (project rule — keep `CLAUDE.md` current):
- New `utils/keys.js` → add to the `utils/` file map (#2/#3).
- `getParticipantNames` no longer force-includes the creator (#6) → data-model /
  file-map note.
- `VotingSection` reconciles option changes in place instead of remounting
  (#5/#11) → update the `VotingSection`/`Room.jsx` notes that mention
  `key={options.join('|')}`.
- The "Top pick" behavior / "label only when ended" line (#10).
- `leaveRoom` now clears `status` + `vip` (#9).

After fixes land, re-run the review's `ReportFindings` with a per-finding
`outcome` (`fixed` / `no_change_needed` / `skipped`) — note #10 is likely
`no_change_needed` (doc-only) and #14 may be `skipped` if deferred.
