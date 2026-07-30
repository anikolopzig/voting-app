// Evaluator methods for ranking options ("best outcome" for the group).
//
// Each `compute` takes the array of submitted scores for ONE option (one number
// per voter who submitted) and returns a value on the same 1–10 scale, so the
// results bars and one-decimal labels stay meaningful across methods. Callers
// must only pass non-empty arrays (options with zero voters are handled upstream).
//
// - mean    (Most happiness): utilitarian — maximises total group satisfaction.
// - geomean (Everyone content): Nash social welfare — one low score drags the
//   product down hard, so "great for most, hated by one" loses to "good for all".
// - min     (No dealbreakers): maximin / Rawlsian — judged purely by each
//   option's least-happy voter; picks the best worst-case.
export const METHODS = [
  {
    id: 'mean',
    label: 'Most happiness',
    blurb: 'Ranked by average score — the most total group satisfaction.',
    compute: (scores) => scores.reduce((a, b) => a + b, 0) / scores.length,
  },
  {
    id: 'geomean',
    label: 'Everyone content',
    blurb: 'Geometric mean — options a few people dislike are penalised heavily.',
    // exp(mean(log x)) is the geometric mean, computed in log-space for safety.
    compute: (scores) =>
      Math.exp(scores.reduce((a, b) => a + Math.log(b), 0) / scores.length),
  },
  {
    id: 'min',
    label: 'No dealbreakers',
    blurb: 'Ranked by each option’s lowest single score — the best worst-case.',
    compute: (scores) => Math.min(...scores),
  },
];

export const DEFAULT_METHOD_ID = 'mean';

export function getMethod(id) {
  return METHODS.find((m) => m.id === id) || METHODS[0];
}
