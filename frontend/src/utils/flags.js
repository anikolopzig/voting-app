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

// AI suggestions require a signed-in account (voting never does). When true, that
// account must also have a VERIFIED email before the suggestions UI unlocks — so
// "sign up" proves the user controls a real inbox. When false, any signed-in user
// qualifies. ⚠️ Must match EMAIL_VERIFICATION_REQUIRED in backend/index.js: the
// function enforces the same rule server-side (this flag only gates the UI).
export const REQUIRE_EMAIL_VERIFICATION = true;
