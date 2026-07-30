import { Fragment } from 'react';
import { METHODS } from '../utils/scoring.js';

// Segmented control (3 buttons) letting each viewer choose how the "best
// outcome" is judged. Purely local — changing it re-ranks only this viewer's
// results; nothing is written to Firebase. Each button reveals a tooltip
// explaining its calculation on hover or keyboard focus (the blurb is the same
// text ResultsSection shows for the active method).
export default function EvaluatorToggle({ value, onChange }) {
  return (
    <div className="method-toggle" role="group" aria-label="Ranking method">
      {METHODS.map((m) => (
        <Fragment key={m.id}>
          <button
            type="button"
            className={`method-btn${value === m.id ? ' method-btn--active' : ''}`}
            onClick={() => onChange(m.id)}
            aria-pressed={value === m.id}
            aria-describedby={`method-tip-${m.id}`}
          >
            {m.label}
          </button>
          <span className="method-btn__tip" role="tooltip" id={`method-tip-${m.id}`}>
            {m.blurb}
          </span>
        </Fragment>
      ))}
    </div>
  );
}
