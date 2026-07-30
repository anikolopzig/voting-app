import { colorForName, initialFor } from '../utils/participantColor.js';

// One person's identity chip: a colored dot with their initial. Deliberately
// used in BOTH places so the roster is literally the legend for the bars:
//   - ResultsSection: one dot per submitted vote, positioned at that score
//   - ParticipantsList: the same dot next to the name
//
// `score` is omitted in the roster (there's no single score there), so the
// tooltip degrades to just the name. `voted` (roster + member stack only) adds a
// sage ring for people who've submitted; it's never passed on the result bars,
// where every dot is a submitted vote anyway.
export default function VoterDot({ name, score, isMe, isVip, voted, highlighted }) {
  const base = score == null ? name : `${name} · ${score}`;
  const label = isMe ? `${base} (you)` : base;

  return (
    <span
      className={
        'voter-dot' +
        (voted ? ' voter-dot--voted' : '') +
        (isVip ? ' voter-dot--vip' : '') + // gold ring wins over the sage "voted"
        (isMe ? ' voter-dot--me' : '') + // your ink ring wins over both
        (highlighted ? ' voter-dot--hit' : '')
      }
      style={{ '--dot-color': colorForName(name) }}
      title={label}
      aria-label={label}
    >
      {initialFor(name)}
    </span>
  );
}
