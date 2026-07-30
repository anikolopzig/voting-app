// Per-room identity persistence, resolved TAB-first.
//
// Two storage layers under the same key, so behaviour is correct whether a
// person opens the app on their own device or as a second tab on a shared one:
//   - sessionStorage: this TAB's identity. Scoped to one browser tab, so two
//     tabs of the same browser can be two DIFFERENT voters. Survives an in-tab
//     refresh (satisfies "refresh restores identity"), but not closing the tab.
//   - localStorage:   a durable, cross-tab fallback so reopening a room in a
//     fresh tab — or after closing the browser — still restores your name.
//
// Reads prefer sessionStorage (this tab wins); writes go to both. Names are
// stored lowercase to match how they're used as Firebase keys and for
// case-insensitive comparisons.
const KEY = 'groupvote.identities';

function readAll(store) {
  try {
    return JSON.parse(store.getItem(KEY)) || {};
  } catch {
    return {};
  }
}

function writeAll(store, map) {
  try {
    store.setItem(KEY, JSON.stringify(map));
  } catch {
    // storage full / disabled — non-fatal, identity just won't persist.
  }
}

export function saveIdentity(roomCode, name) {
  const code = roomCode.toUpperCase();
  const lowerName = name.toLowerCase();
  // sessionStorage marks THIS tab; localStorage is the durable fallback.
  for (const store of [sessionStorage, localStorage]) {
    const map = readAll(store);
    map[code] = lowerName;
    writeAll(store, map);
  }
}

export function getIdentity(roomCode) {
  const code = roomCode.toUpperCase();
  // This tab's own identity beats the shared/durable one.
  return readAll(sessionStorage)[code] || readAll(localStorage)[code] || null;
}

// Forget this room's identity in BOTH layers. Used when someone deliberately
// leaves a room, so revisiting its URL sends them back to the join form instead
// of silently re-joining under the old name.
export function clearIdentity(roomCode) {
  const code = roomCode.toUpperCase();
  for (const store of [sessionStorage, localStorage]) {
    const map = readAll(store);
    if (code in map) {
      delete map[code];
      writeAll(store, map);
    }
  }
}
