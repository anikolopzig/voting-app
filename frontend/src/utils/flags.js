// Feature flags — flip a single boolean to show/hide a feature WITHOUT deleting
// its code. Everything the flag gates stays wired up and reversible.

// The "Room mode" UI: the ModeToggle bar in the room header AND the Room-mode
// selector in the create form. When false, both are hidden and every room just
// uses DEFAULT_ROOM_MODE (see utils/roles.js). The mode data model, roleOf
// resolution, and setMode handler are all untouched — set this back to true to
// bring the whole feature back.
export const ROOM_MODE_UI_ENABLED = false;

// The "Everyone content" (geomean) evaluator method. When false, its button is
// hidden from the EvaluatorToggle bar so viewers can only pick "Most happiness"
// or "No dealbreakers". The method itself stays in METHODS[] (utils/scoring.js)
// with its compute intact — nothing is deleted, and getMethod still resolves it
// — so flipping this back to true restores the button immediately.
export const GEOMEAN_METHOD_ENABLED = false;

// AI option details ("Expand with AI"): the ✨ Add details buttons, the ⓘ toggles
// on the ballot / results / options editor, and the detail rows themselves. When
// false none of that renders, but the optionMeta data and the /api/expand
// endpoint stay intact — this is a kill switch, not a delete.
export const OPTION_DETAILS_ENABLED = true;

// There are two ways to reach the same /api/expand call, and they overlap a lot:
//   • "✨ Add details to these" — inside the AI suggestions panel, researches the
//     suggestions you're already looking at, before you accept any.
//   • "✨ Add details to all"   — the standalone panel, researches whatever is in
//     the option rows right now.
// This flag hides ONLY the standalone panel, leaving the in-suggestions button.
// The one thing lost when it's false: options TYPED BY HAND can no longer be
// researched, since the suggestions panel only ever sees its own results. Set it
// false if the extra button isn't earning its space. Ignored entirely when
// OPTION_DETAILS_ENABLED is false.
export const STANDALONE_EXPAND_ENABLED = true;

// AI suggestions require a signed-in account (voting never does). When true, that
// account must also have a VERIFIED email before the suggestions UI unlocks — so
// "sign up" proves the user controls a real inbox. When false, any signed-in user
// qualifies. ⚠️ Must match EMAIL_VERIFICATION_REQUIRED in backend/index.js: the
// function enforces the same rule server-side (this flag only gates the UI).
export const REQUIRE_EMAIL_VERIFICATION = true;
