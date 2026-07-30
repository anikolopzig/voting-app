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

