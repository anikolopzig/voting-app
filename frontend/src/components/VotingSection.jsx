import { useState } from 'react';
import { getInputMode, scoreForRank } from '../utils/inputModes.js';
import { unratedOptions } from '../utils/room.js';
import VoterDot from './VoterDot.jsx';

const DEFAULT_SCORE = 5;
const MIN = 1;
const MAX = 10;

// Corner "sticker" showing whose circle proposed this option. Absent on old
// rooms (no optionAuthors) — then it simply renders nothing.
function OptionAdder({ author, me }) {
  if (!author) return null;
  const label = `Added by ${author}${author === me ? ' (you)' : ''}`;
  return (
    <span className="option-adder" title={label}>
      <VoterDot name={author} isMe={author === me} />
    </span>
  );
}

// Build the initial slider values: restore a previous vote if present,
// otherwise default every option to 5.
function initScores(options, myVote) {
  const out = {};
  for (const opt of options) {
    const prev = myVote?.scores?.[opt];
    out[opt] = typeof prev === 'number' ? prev : DEFAULT_SCORE;
  }
  return out;
}

// Restore a previous ranking. scoreForRank is strictly decreasing, so sorting
// the options by their stored score (desc) recovers the exact order the voter
// chose — the ranking itself needs no extra storage.
function initOrder(options, myVote) {
  const stored = myVote?.scores;
  if (!stored) return [...options];
  return [...options].sort((a, b) => (stored[b] ?? 0) - (stored[a] ?? 0));
}

// `key` on the parent remounts this component if the option set ever changes,
// so we can safely seed state once from props at mount.
export default function VotingSection({
  options,
  optionAuthors,
  me,
  myVote,
  ended,
  onSubmit,
  onEdit,
  inputMode,
}) {
  const mode = getInputMode(inputMode);
  const isRank = mode.id === 'rank';
  const hasSubmitted = myVote?.submitted === true;
  // Options this already-submitted voter never rated — non-empty means options
  // were added/renamed after they voted, so their ballot is stale. (Empty for a
  // voter who hasn't submitted; they see the current options normally.)
  const unrated = unratedOptions(myVote, options);
  const stale = hasSubmitted && unrated.length > 0;
  const unratedSet = stale ? new Set(unrated) : new Set();
  const [scores, setScores] = useState(() => initScores(options, myVote));
  const [order, setOrder] = useState(() => initOrder(options, myVote));
  const [dragIndex, setDragIndex] = useState(null);
  // Editing when the user has not yet submitted; after submit we lock the input.
  // A stale ballot auto-unlocks so they can rate the new option(s) and resubmit
  // (this is local only — their existing submitted scores keep counting until
  // they actually resubmit). Re-evaluated on mount, which the parent forces via
  // `key={options.join('|')}` whenever the option set changes.
  const [editing, setEditing] = useState(!hasSubmitted || stale);
  const [busy, setBusy] = useState(false);

  if (ended) {
    return (
      <section className="card voting voting--ended">
        <p className="ended-notice">🔒 Voting has ended.</p>
      </section>
    );
  }

  const locked = !editing || busy;

  function setScore(opt, value) {
    // Round: a step-0.1 range can yield values like 7.300000000000001.
    const n = Math.round(Number(value) * 10) / 10;
    setScores((s) => ({ ...s, [opt]: n }));
  }

  function moveCard(from, to) {
    setOrder((prev) => {
      // Guard both indices: a NaN `from` (e.g. a non-numeric drag payload) passes a
      // `from == null` check but splice(NaN, …) coerces to 0 and scrambles the order.
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        from === to ||
        from < 0 ||
        from >= prev.length ||
        to < 0 ||
        to >= prev.length
      ) {
        return prev;
      }
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  // Ranked choice stores derived scores, so everything downstream (results,
  // dots, evaluators, VIP weighting) works with no special-casing.
  function currentScores() {
    if (!isRank) return scores;
    const out = {};
    order.forEach((opt, i) => {
      out[opt] = scoreForRank(i + 1, order.length);
    });
    return out;
  }

  async function handleClick() {
    setBusy(true);
    try {
      const payload = currentScores();
      if (editing) {
        await onSubmit(payload); // writes { scores, submitted: true }
        setEditing(false);
      } else {
        await onEdit(payload); // writes submitted: false so it stops counting
        setEditing(true);
      }
    } catch {
      // The write failed (Room already surfaced the banner). Stay in the current
      // mode so the user can retry — never falsely flip the ballot to "saved".
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card voting">
      <div className="voting__head">
        <h2 className="section-title">Your votes</h2>
        {stale && (
          <p className="voting-stale-note" role="status">
            ⚠️ Rate the new options so your vote counts for everything! ⚠️
          </p>
        )}
      </div>

      {isRank ? (
        <>
          <p className="section-note voting__hint">
            Drag the cards into your preferred order — best at the top.
          </p>
          <ol className="rank-list">
            {order.map((opt, i) => (
              <li
                className={`rank-card${dragIndex === i ? ' rank-card--dragging' : ''}${
                  unratedSet.has(opt) ? ' rank-card--unrated' : ''
                }`}
                key={opt}
                draggable={!locked}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(i)); // Firefox needs data
                  setDragIndex(i);
                }}
                onDragOver={(e) => {
                  e.preventDefault(); // allow dropping
                  e.dataTransfer.dropEffect = 'move';
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  // Only react to a numeric card index — ignore stray payloads like
                  // the VIP badge's 'vip' or dropped text (which would parse to NaN).
                  const from = Number.parseInt(e.dataTransfer.getData('text/plain'), 10);
                  if (Number.isInteger(from)) moveCard(from, i);
                  setDragIndex(null);
                }}
                onDragEnd={() => setDragIndex(null)}
              >
                <OptionAdder author={optionAuthors?.[opt]} me={me} />
                <span className="rank-card__pos">{i + 1}</span>
                <span className="rank-card__name">{opt}</span>
                {unratedSet.has(opt) && <span className="option-new-flag">New</span>}
                <span className="rank-card__score">
                  {scoreForRank(i + 1, order.length).toFixed(1)}
                </span>
                {/* Drag is mouse-only, and ranking IS the vote here — these keep
                    it usable on touch and by keyboard. */}
                <span className="rank-move">
                  <button
                    type="button"
                    className="rank-move__btn"
                    onClick={() => moveCard(i, i - 1)}
                    disabled={locked || i === 0}
                    aria-label={`Move ${opt} up`}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="rank-move__btn"
                    onClick={() => moveCard(i, i + 1)}
                    disabled={locked || i === order.length - 1}
                    aria-label={`Move ${opt} down`}
                  >
                    ▼
                  </button>
                </span>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <ul className="slider-list">
          {options.map((opt) => {
            const val = scores[opt];
            // Percent along the 1–10 track, used to paint the filled portion.
            const fillPct = ((val - MIN) / (MAX - MIN)) * 100;
            return (
              <li
                className={`slider-row${unratedSet.has(opt) ? ' slider-row--unrated' : ''}`}
                key={opt}
              >
                <OptionAdder author={optionAuthors?.[opt]} me={me} />
                <div className="slider-row__head">
                  <span className="slider-row__label">{opt}</span>
                  {unratedSet.has(opt) && <span className="option-new-flag">New</span>}
                  <span className="score-bubble">
                    {mode.step < 1 ? val.toFixed(1) : val}
                  </span>
                </div>
                <input
                  className="slider"
                  type="range"
                  min={MIN}
                  max={MAX}
                  step={mode.step}
                  value={val}
                  disabled={locked}
                  onChange={(e) => setScore(opt, e.target.value)}
                  aria-label={`Score for ${opt}`}
                  style={{
                    background: `linear-gradient(90deg, var(--accent) 0 ${fillPct}%, var(--card-2) ${fillPct}% 100%)`,
                  }}
                />
                <div className="slider-ends">
                  <span>1 · nope</span>
                  <span>10 · yes!</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        className="btn btn--primary btn--block"
        onClick={handleClick}
        disabled={busy}
      >
        {editing ? 'Submit Votes' : 'Edit Votes'}
      </button>
      {!editing && (
        <p className="section-note">Your votes are in and counting. Edit anytime before voting ends.</p>
      )}
    </section>
  );
}
