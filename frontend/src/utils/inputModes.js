// How voters express a preference. Chosen by the creator when the room is made
// and stored on the room, so everyone in a room uses the same input.
//
// HARD INVARIANT: every mode must produce a score in [1, 10]. The bars
// (width = value/10), the vote dots (position = score*10%) and all three
// evaluator methods depend on it — and `geomean` takes ln(score), so a 0 would
// produce -Infinity and destroy the results.
export const INPUT_MODES = [
  {
    id: 'score',
    label: 'Score 1–10',
    blurb: 'Drag a slider from 1 to 10 for each option (whole numbers).',
    step: 1,
  },
  {
    id: 'precise',
    label: 'Score 1–10 with decimals',
    blurb: 'Same slider with finer control — scores like 7.5 and 7.6 are possible.',
    step: 0.1,
  },
  {
    id: 'rank',
    label: 'Ranked choice',
    blurb: 'Drag the options into your preferred order; the ranking becomes scores.',
    step: null,
  },
];

export const DEFAULT_INPUT_MODE_ID = 'score';

// Fallback to the default keeps rooms created before this feature working.
export function getInputMode(id) {
  return INPUT_MODES.find((m) => m.id === id) || INPUT_MODES[0];
}

// Rank -> score, spread evenly over [1, 10]: best rank scores 10, worst 1.
//   2 options -> 10, 1        3 options -> 10, 5.5, 1
//   4 options -> 10, 7, 4, 1  5 options -> 10, 7.8, 5.5, 3.3, 1
// Strictly decreasing, which is what lets a stored vote be sorted back into the
// exact order the voter chose (see initOrder in VotingSection) — so the ranking
// needs no extra storage. Rounded to 1dp to match the precision shown elsewhere.
export function scoreForRank(rank, total) {
  if (total <= 1) return 10; // guard; rooms always have >= 2 options
  const raw = 10 - ((rank - 1) * 9) / (total - 1);
  return Math.round(raw * 10) / 10;
}
