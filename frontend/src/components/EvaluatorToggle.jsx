import { Fragment } from 'react';
import { METHODS } from '../utils/scoring.js';
import { GEOMEAN_METHOD_ENABLED } from '../utils/flags.js';

// Segmented control letting each viewer choose how the "best outcome" is judged.
// Purely local — changing it re-ranks only this viewer's results; nothing is
// written to Firebase. Each button reveals a tooltip explaining its calculation
// on hover or keyboard focus (the blurb is the same text ResultsSection shows
// for the active method).
//
// The "Everyone content" (geomean) button is hidden while GEOMEAN_METHOD_ENABLED
// is false (utils/flags.js); the method stays defined in METHODS[], just not
// offered here. DEFAULT_METHOD_ID is 'mean', so nobody can be left on a hidden
// method.
export default function EvaluatorToggle({ value, onChange }) {
  const methods = METHODS.filter((m) => m.id !== 'geomean' || GEOMEAN_METHOD_ENABLED);
  return (
    <div className="method-toggle" role="group" aria-label="Ranking method">
      {methods.map((m) => (
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
