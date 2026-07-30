// Feature flags — flip a single boolean to show/hide a feature WITHOUT deleting
// its code. Everything the flag gates stays wired up and reversible.

// The "Room mode" UI: the ModeToggle bar in the room header AND the Room-mode
// selector in the create form. When false, both are hidden and every room just
// uses DEFAULT_ROOM_MODE (see utils/roles.js). The mode data model, roleOf
// resolution, and setMode handler are all untouched — set this back to true to
// bring the whole feature back.
export const ROOM_MODE_UI_ENABLED = false;
