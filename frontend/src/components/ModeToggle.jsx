import { Fragment } from 'react';
import { ROOM_MODES, MODE_META } from '../utils/roles.js';

// Segmented control for the room MODE (conversation vs vote). Unlike the
// evaluator toggle, this is room-wide state written to Firebase: only presidents
// can change it, and the flip reaches everyone via the single onValue listener.
// Rendered ONLY for presidents (Room.jsx gates it) — non-presidents can't change
// it, so per the "don't show controls you can't use" rule the bar is hidden from
// them entirely rather than shown read-only. Reuses the .method-toggle look + tooltips.
export default function ModeToggle({ value, canChange, onChange }) {
  return (
    <div className="mode-toggle">
      <span className="mode-toggle__label">Room mode</span>
      <div className="method-toggle" role="group" aria-label="Room mode">
        {ROOM_MODES.map((id) => {
          const active = value === id;
          return (
            <Fragment key={id}>
              <button
                type="button"
                className={`method-btn${active ? ' method-btn--active' : ''}`}
                onClick={() => canChange && !active && onChange(id)}
                aria-pressed={active}
                aria-describedby={`mode-tip-${id}`}
                disabled={!canChange}
              >
                {MODE_META[id].label}
              </button>
              <span className="method-btn__tip" role="tooltip" id={`mode-tip-${id}`}>
                {MODE_META[id].blurb}
              </span>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
