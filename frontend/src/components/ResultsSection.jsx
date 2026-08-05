import { Fragment, useMemo } from 'react';
import { getMethod } from '../utils/scoring.js';
import { getParticipantNames } from '../utils/room.js';
import VoterDot from './VoterDot.jsx';
import EvaluatorToggle from './EvaluatorToggle.jsx';
import OptionDetails, { useOpenDetails, ShowAllDetails } from './OptionDetails.jsx';

// Compute a per-option value with the chosen method, over ONLY submitted votes,
// sorted descending. All methods return a 1–10 value so bars stay comparable.
//
// A VIP's vote counts double: their score is added to the array TWICE, which
// doubles its weight for mean and geomean (and, correctly, doesn't change min —
// a worst-case is a worst-case regardless of weight). `count` stays the real
// number of voters, so the displayed "N voters" isn't inflated by the weighting.
// `vips` is a Set of names — a room can have several.
function computeResults(options, votes, method, vips) {
  const submitted = Object.entries(votes).filter(([, v]) => v?.submitted === true);

  const rows = options.map((opt) => {
    const weighted = [];
    const byBucket = new Map(); // bucketed score -> [{name, score}] for the dots
    let count = 0;
    for (const [name, v] of submitted) {
      const raw = v.scores?.[opt];
      if (typeof raw !== 'number' || Number.isNaN(raw)) continue;
      const s = Math.min(10, Math.max(1, raw)); // defend the [1,10] invariant (geomean uses ln)
      count += 1;
      weighted.push(s);
      if (vips.has(name)) weighted.push(s); // VIP vote counts double
      // Decimal scores can land two people ~1% apart on the bar, where they'd
      // overlap invisibly instead of forming a fannable cluster. Bucket to the
      // nearest 0.25 so near-identical scores share one. Whole numbers are
      // unaffected; ranked-choice values shift by at most 0.05 (~0.5% of the
      // bar), which is far below the ~3% a dot already covers.
      const bucket = Math.round(s * 4) / 4;
      const members = byBucket.get(bucket);
      if (members) members.push({ name, score: s });
      else byBucket.set(bucket, [{ name, score: s }]);
    }
    const value = weighted.length ? method.compute(weighted) : 0;
    // One cluster per bucket. Members sorted by name (and clusters by position)
    // so dot order is deterministic across re-renders and across clients.
    const clusters = Array.from(byBucket, ([pos, members]) => ({
      pos,
      members: members.sort((a, b) => a.name.localeCompare(b.name)),
    })).sort((a, b) => a.pos - b.pos);
    return { opt, value, count, clusters };
  });

  // Sort by value desc; stable tie-break by name keeps order deterministic.
  rows.sort((a, b) => b.value - a.value || a.opt.localeCompare(b.opt));
  return { rows, submittedCount: submitted.length };
}

export default function ResultsSection({
  options,
  votes,
  participants,
  creatorName,
  ended,
  methodId,
  onMethodChange,
  vips,
  me,
  highlightName,
  optionMeta,
}) {
  const method = getMethod(methodId);
  // Expanded details here — independent of the ballot's own toggles, so opening
  // one section doesn't shift the other under you.
  const details = useOpenDetails();
  const detailed = (options || []).filter((opt) => optionMeta?.[opt]);
  const { rows, submittedCount } = useMemo(
    () => computeResults(options, votes, method, vips),
    [options, votes, method, vips]
  );

  // Count everyone in the room (present the moment they join), not just people
  // who already have a vote entry. The numerator (submittedCount) still counts
  // only submitted votes, so someone editing reads as "hasn't voted".
  const totalParticipants = getParticipantNames({ creatorName, participants, votes }).length;
  const creatorVoted = votes?.[creatorName]?.submitted === true;
  // Sorted for a stable, deterministic listing in the note.
  const vipNames = [...vips].sort();

  // Top value defines the winner set (only meaningful once someone has voted).
  // Round to avoid float dust (e.g. geometric means) splitting a real tie.
  const round3 = (n) => Math.round(n * 1000) / 1000;
  const topValue = rows.length ? round3(rows[0].value) : 0;
  const winnerOpts = new Set(
    submittedCount > 0
      ? rows.filter((r) => round3(r.value) === topValue && r.count > 0).map((r) => r.opt)
      : []
  );
  const isTie = winnerOpts.size > 1;

  return (
    <section className="card results">
      <div className="results__head">
        <h2 className="section-title">Results</h2>
        <span className="results__meta">
          {submittedCount} of {totalParticipants}{' '}
          {totalParticipants === 1 ? 'participant has' : 'participants have'} voted
          {!creatorVoted && ' · creator hasn’t voted yet'}
        </span>
      </div>
      {/* Each viewer picks how "best outcome" is judged — local only, re-ranks
          just this viewer's bars. Lives here, right under the heading, so the
          lens sits with the results it shapes (not up in the room header). */}
      <EvaluatorToggle value={methodId} onChange={onMethodChange} />
      <p className="section-note results__method-note">{method.blurb}</p>
      {vipNames.length > 0 && (
        <p className="section-note results__vip-note">
          ★{' '}
          {vipNames.map((n, i) => (
            <Fragment key={n}>
              {i > 0 && (i === vipNames.length - 1 ? ' and ' : ', ')}
              <strong>{n}</strong>
            </Fragment>
          ))}
          {vipNames.length === 1
            ? ' is a VIP — their vote counts double.'
            : ' are VIPs — their votes count double.'}
        </p>
      )}

      <ShowAllDetails labels={detailed} view={details} />

      {submittedCount === 0 ? (
        <p className="empty-note">No votes yet.</p>
      ) : (
        <ul className="result-list">
          {rows.map((r, i) => {
            const isWinner = winnerOpts.has(r.opt);
            const pct = Math.round((r.value / 10) * 100);
            return (
              <li
                className={`result-row${isWinner ? ' result-row--winner' : ''}`}
                key={r.opt}
              >
                <div className="result-row__top">
                  <span className="result-row__rank">{i + 1}</span>
                  <span className="result-row__name">{r.opt}</span>
                  {isWinner && (
                    <span className="badge">
                      {ended ? (isTie ? 'Tie' : 'Winner') : 'Top pick'}
                    </span>
                  )}
                  {optionMeta?.[r.opt] && (
                    <button
                      type="button"
                      className={`option-info${details.isOpen(r.opt) ? ' is-open' : ''}`}
                      onClick={() => details.toggle(r.opt)}
                      aria-expanded={details.isOpen(r.opt)}
                      aria-label={`${details.isOpen(r.opt) ? 'Hide' : 'Show'} details for ${r.opt}`}
                      title={details.isOpen(r.opt) ? 'Hide details' : 'Show details'}
                    >
                      ⓘ
                    </button>
                  )}
                  <span className="result-row__avg">{r.value.toFixed(1)}</span>
                </div>
                {/* Sits above the bar so the winner's website/map are the first
                    thing you reach for once the group has decided. */}
                {details.isOpen(r.opt) && <OptionDetails detail={optionMeta?.[r.opt]} />}
                <div className="bar-wrap">
                  <div className="bar-track">
                    <div
                      className={`bar-fill${isWinner ? ' bar-fill--top' : ''}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {/* One dot per submitted vote, sitting at that person's score.
                      Overlay is a sibling of .bar-track because the track clips
                      its children (overflow:hidden) to round off the fill. */}
                  <div className={`vote-marks${highlightName ? ' vote-marks--dim' : ''}`}>
                    {r.clusters.map((c) => (
                      <div
                        className="vote-cluster"
                        key={c.pos}
                        style={{ '--pos': c.pos * 10 }}
                        // Focusable only when it actually holds a stack, so
                        // keyboard users can fan it out without flooding tab order.
                        tabIndex={c.members.length > 1 ? 0 : undefined}
                      >
                        {c.members.map((m) => (
                          <VoterDot
                            key={m.name}
                            name={m.name}
                            score={m.score}
                            isMe={m.name === me}
                            isVip={vips.has(m.name)}
                            highlighted={m.name === highlightName}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
                {/* When fewer submitted voters rated this option than voted
                    overall (options were added/renamed mid-vote), flag the
                    partial coverage so a fresh option judged by one person reads
                    honestly. Caveat only — ranking/winner are unaffected. */}
                <span
                  className={`result-row__count${
                    r.count < submittedCount ? ' result-row__count--partial' : ''
                  }`}
                >
                  {r.count < submittedCount
                    ? `rated by ${r.count} of ${submittedCount} voters`
                    : `${r.count} ${r.count === 1 ? 'voter' : 'voters'}`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
