// Shared room helpers used by both Home (join validation) and Room (live state).

// A room is "closed" if the creator closed it OR its 15-minute TTL elapsed.
// Expiry is enforced purely client-side against expiresAt — there is no server
// cleanup. `now` is passed in so callers can drive it off a ticking clock.
export function isRoomClosed(room, now = Date.now()) {
  if (!room) return false;
  if (room.closedAt != null) return true;
  const expires = Number(room.expiresAt);
  if (!Number.isFinite(expires)) return true; // malformed room → treat as closed
  return now > expires;
}

// Everyone "in the room", deduped (names are lowercase). The single source of
// truth for both the participants roster and the "X of Y have voted" count:
// the creator, anyone who registered presence on entry, and anyone with a vote
// entry — so people are counted the moment they join, before they vote.
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

// The set of VIP names (their votes count double, see ResultsSection). Rooms may
// have several VIPs, stored as a `vips` map { lowercasename: true }. Old rooms
// stored a single `vip: string` — folded in here so they keep working. Returns a
// Set for cheap membership checks; empty when nobody is a VIP.
export function getVipNames(room) {
  const names = new Set();
  if (room?.vips) {
    for (const [name, on] of Object.entries(room.vips)) if (on) names.add(name);
  }
  if (room?.vip) names.add(room.vip); // legacy single-VIP field
  return names;
}

// Current options a vote has no numeric score for. A non-empty result means the
// ballot is STALE: options were added or renamed after it was submitted, so it
// no longer covers the full set. Drives the voter's "options changed" nudge.
// (Orphaned scores for labels no longer in `options` are ignored — resubmitting
// with set() prunes them, since it writes only the current options.)
export function unratedOptions(vote, options = []) {
  const scores = vote?.scores || {};
  return options.filter((opt) => typeof scores[opt] !== 'number');
}

// The creator's window before they may close the poll (3 min after creation).
export const CLOSE_UNLOCK_MS = 3 * 60 * 1000;

// Room time-to-live (15 minutes).
export const ROOM_TTL_MS = 15 * 60 * 1000;

// Format a millisecond duration as mm:ss (clamped at 00:00).
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}
