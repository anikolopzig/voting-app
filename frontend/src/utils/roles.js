// Room roles + modes — pure logic, no React (matches the src/utils/ convention).
//
// ROLES are ordered by increasing power; each role includes every power below
// it. Kept deliberately open: to add a role, insert it into ROLES at the right
// rank, give it a ROLE_META entry, and teach the can* helpers its extra power —
// storage (the `status` dict) and the roster UI adapt automatically.
//
//   voter     — can vote.
//   minister  — voter + edit the room's options.
//   president — minister + end the vote, assign VIPs, change the room mode,
//               and promote others (incl. to president). Cannot be demoted.
export const ROLES = ['voter', 'minister', 'president'];
export const DEFAULT_ROLE = 'voter';

export const ROLE_META = {
  voter: { label: 'Voter', emoji: '' },
  minister: { label: 'Minister', emoji: '' },
  president: { label: 'President', emoji: '👑' },
};

// Room modes. A room is created in one of these; a president can flip it live.
// The mode only sets the DEFAULT role of non-presidents (see roleOf below):
//   conversation -> minister (everyone can edit options together)
//   vote         -> voter    (options locked to ministers+)
export const ROOM_MODES = ['conversation', 'vote'];
// New rooms default to 'vote' (options locked to ministers+). The mode-picker UI
// is currently hidden behind ROOM_MODE_UI_ENABLED (see utils/flags.js), so this
// default is effectively the mode for every new room until that flag is flipped.
export const DEFAULT_ROOM_MODE = 'vote';

export const MODE_META = {
  conversation: {
    label: 'Conversation',
    blurb: 'Everyone can edit the options together — anyone who joins is a Minister.',
  },
  vote: {
    label: 'Vote',
    blurb: 'Options are locked. Everyone except Presidents is a Voter.',
  },
};

export function rankOf(role) {
  const i = ROLES.indexOf(role);
  return i === -1 ? 0 : i;
}

// The room's mode, tolerating old rooms with no `mode` field. Those predate the
// feature and had fixed options, so they read as 'vote' (options locked).
export function getMode(room) {
  return room?.mode === 'conversation' ? 'conversation' : 'vote';
}

// The default role for anyone without an explicit entry in `status`, given the
// current mode. This is what makes a mode switch "revert everyone" for free —
// people without an override just follow the mode.
export function defaultRoleForMode(mode) {
  return mode === 'conversation' ? 'minister' : 'voter';
}

// Effective role of `name`. An explicit `status` entry wins; otherwise the
// creator is president and everyone else follows the mode default. Works for
// old rooms (no `status`): creator -> president, others -> mode default.
export function roleOf(room, name) {
  if (!room || !name) return DEFAULT_ROLE;
  const stored = room.status?.[name];
  if (stored && ROLES.includes(stored)) return stored;
  if (name === room.creatorName) return 'president';
  return defaultRoleForMode(getMode(room));
}

export function isPresident(room, name) {
  return roleOf(room, name) === 'president';
}

// Ministers and presidents may edit the shared option list.
export function canEditOptions(room, name) {
  return rankOf(roleOf(room, name)) >= rankOf('minister');
}

// President-only powers: end the vote, assign VIPs, change the mode, manage roles.
export function canManageRoom(room, name) {
  return isPresident(room, name);
}

// Whether `actor` may change `target`'s role at all. Presidents manage everyone
// but themselves and other presidents (presidents can't be demoted).
export function canChangeRole(room, actor, target) {
  return isPresident(room, actor) && actor !== target && !isPresident(room, target);
}
