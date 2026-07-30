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
● frontend/src/components/Join [correctn — Name-uniqueness check only looks at room.votes + creatorName, never room.participants, so a name already claimed by a joined-but-not-yet-voted person is treated as free.
● frontend/src/components/Create [correctne — Free-text option labels are used directly as Firebase keys (optionAuthors[label], and scores[label] on every vote), but RTDB keys may not contain . # $ [ ] / — so such labels make the write throw.
● frontend/src/components/CreateRoo [correctne — Participant/creator names are lowercased but not sanitized before being used as Firebase keys (status/{name}, votes/{name}, participants/{name}); a name containing '.' (or # $ [ ] /) is an invalid key.
● frontend/src/components/VotingS [correctne — handleClick assumes onSubmit throws on failure, but Room.jsx's submitVotes catches its own error and resolves; so setEditing(false) runs even when the write failed, showing the ballot as saved.
● frontend/src/pages/Room [correctne — VotingSection is keyed on room.options.join('|'); a concurrent option edit by a minister changes room.options, flipping the key and forcing a remount that re-seeds ballot state from the last saved vote, discarding a voter's unsaved in-progress ratings.
● frontend/src/utils/roo [correctne — getParticipantNames unconditionally re-adds room.creatorName, which defeats Room.jsx leaveRoom() for the creator: deleting participants/creator and votes/creator cannot remove them from the roster or the denominator.
● frontend/src/components/VotingS [correctne — Ranked-choice drop handler feeds Number(dataTransfer 'text/plain') into moveCard; a non-numeric payload yields NaN, which passes the `from == null` guard (NaN == null is false) and reaches next.splice(NaN, 1), where splice coerces NaN to index 0.
● frontend/src/pages/Room [correctne — Room.removeSuggestion refuses (with only an error banner) when removing would drop below 2 options, but SuggestOptions.reject has already marked the suggestion 'rejected' and does not roll that back, so a rejected AI option can remain live on the ballot (same root cause in SuggestOptions.jsx:58).
● frontend/src/pages/Room. [correctne — leaveRoom() only nulls participants/{name} and votes/{name}; it never clears the departing member's status/{name} role override or the room-level vip pointer, so those references dangle after they leave — a later joiner reusing the freed name silently inherits them.
● frontend/src/components/ResultsS [correctn — The `ended` gate that suppressed the winner/tie label until the poll closed was removed; the leading option is now badged "Top pick" during live voting. (This is the intended redesign behavior, but CLAUDE.md still documents 'label only when ended', so the docs are out of sync — convention 15.)
● frontend/src/pages/Room [correctne — VotingSection is remounted via key={room.options.join('|')} (and OptionsEditor tracks changes via the same join('|') signature at lines 18/20); '|' is a legal character in an option label, so two distinct option sets can join to the identical string and the key/signature does not change when it should.
● frontend/src/utils/scorin [correctnes — geomean compute does scores.reduce((a,b)=>a+Math.log(b)); Math.log(0) is -Infinity, so a single 0 score makes the sum -Infinity and Math.exp(-Infinity)=0, collapsing the option's value.
● frontend/src/components/SuggestO [correctn — AI suggestion results are rendered with key={s.label} and decisions are keyed by s.label, but parseSuggestions() does not deduplicate labels, so two suggestions sharing a label collide.
● frontend/src/components/Options [correctn — Editable option rows use the array index as React key (key={i}) here and in CreateRoom.jsx:167; on removal of a non-last row React reconciles inputs by position, not identity.
● frontend/src/pages/Room. [correctne — remainingMs = Math.max(0, room.expiresAt - now); the 0-floor does not guard NaN — Math.max(0, NaN) returns NaN — so a missing/non-numeric expiresAt propagates NaN into the countdown.
---

