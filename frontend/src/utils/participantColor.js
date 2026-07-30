// Stable per-person visual identity (a color + an initial) used for the vote
// dots on the results bars and for the matching legend dot in the roster.
//
// The color is derived from a hash of the NAME, never from an array index —
// otherwise a new person joining would reshuffle everyone's color, and two
// clients could disagree about who is which color. Same name => same color,
// everywhere, forever.
//
// Hues are deliberately spread around the wheel and skip the accent purple
// (#7c5cff -> #a58bff) that the bar fill uses, so a dot never blends into the
// bar it sits on. All are light enough for the dark text drawn inside them.
export const PARTICIPANT_COLORS = [
  '#ff6b6b', // red
  '#ff922b', // orange
  '#ffd43b', // amber
  '#a9e34b', // lime
  '#51cf66', // green
  '#20c997', // teal
  '#22d3ee', // cyan
  '#4dabf7', // blue
  '#f783ac', // pink
  '#f06595', // rose
];

// Small deterministic string hash (same idea as Java's String.hashCode).
function hashName(name) {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colorForName(name) {
  if (!name) return PARTICIPANT_COLORS[0];
  return PARTICIPANT_COLORS[hashName(name) % PARTICIPANT_COLORS.length];
}

// First character, uppercased — drawn inside the dot so two people who hash to
// similar colors (or a colourblind viewer) can still tell them apart.
export function initialFor(name) {
  return (name || '?').trim().charAt(0).toUpperCase() || '?';
}
